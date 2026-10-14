import hljsDarkTheme from "highlight.js/styles/vs2015.css";
import hljsLightTheme from "highlight.js/styles/vs.css";
import { createMdPipeline, type Block } from "../shared/md-pipeline";
import type { TableOp } from "../shared/md-utils";
import { createHistory } from "./history";
import { attachSelectionHandlers } from "./selection";
import { attachFindbar } from "./search";
import { attachFormatbar, openMenu, cmListEnter, isMenuOpen } from "./format";
import { PROTO, createPoster } from "./protocol";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, highlightActiveLine, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { search, searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  isTableBlock,
  editTable,
  listEnterAction,
} from "../shared/md-utils";

declare function acquireVsCodeApi(): {
  postMessage(msg: any): void;
  getState(): any;
  setState(s: any): void;
};

const vscode = acquireVsCodeApi();

// Giden mesajlar tek noktadan (sürüm damgalı)
const post = createPoster((m) => vscode.postMessage(m));

// ---------- markdown-it (kurulum shared/md-pipeline içindedir, test edilir) ----------
const { renderBlockHtml, renderFullWithFm, computeBlocks } = createMdPipeline();

// ---------- state ----------
type Mode = "source" | "live" | "split" | "reading";
let mode: Mode = "live";
let currentText = "";
let isDirty = false;
// textBase: currentText'in türediği sunucu sürümü (doğru soy izleme);
// dirty: gönderilmemiş yerel yazım var mı?
let textBase = -1;
let dirty = false;
let externalPending: { text: string; version: number } | null = null;

// Yerel mutasyon noktalarından çağrılır.
function markLocalEdit(): void {
  dirty = true;
}
let wordWrap = true;
let editingIndex: number | null = null;
let blocks: Block[] = [];
let cmView: EditorView | null = null;
let cmApplyingExternal = false;
const languageCompartment = new Compartment();
const themeCompartment = new Compartment();
const lineNumCompartment = new Compartment();
let lineNumbersOn = true;
let syncingScroll = false;

const $ = (id: string) => document.getElementById(id)!;
const btnSource = $("btn-source") as HTMLButtonElement;
const btnLive = $("btn-live") as HTMLButtonElement;
const btnReading = $("btn-reading") as HTMLButtonElement;
const sourceWrap = $("source-wrap");
const liveWrap = $("live-wrap");
const readingWrap = $("reading-wrap");
const liveRoot = $("live-root");
const readingRoot = $("reading-root");
const cmHost = $("cm-host");
const btnSplit = $("btn-split") as HTMLButtonElement;
const mainRow = $("main-row");
const splitPreview = $("split-preview");
const splitRoot = $("split-root");
const dirtyEl = $("dirty");

// ---------- helpers ----------
function debounce<T extends (...a: any[]) => void>(fn: T, ms: number): T {
  let t: any;
  return ((...args: any[]) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T;
}

// (renderWikilinks / renderBlockHtml pipeline'dan gelir)

// (computeBlocks pipeline'dan gelir)

function updateWordCount() {
  dirtyEl.textContent = isDirty ? "●" : "";
}

const sendEdit = debounce((text: string) => {
  post({ type: "edit", text, base: textBase });
  dirty = false;
}, 250);

function setTextFromWebview(newText: string) {
  if (newText === currentText) {
    return;
  }
  markLocalEdit();
  currentText = newText;
  updateWordCount();
  sendEdit(newText);
}

// ---------- CodeMirror (Kaynak modu) ----------
function isDarkTheme(): boolean {
  return document.body.classList.contains("vscode-dark") || document.body.classList.contains("vscode-high-contrast");
}

function initCodeMirror() {
  const dark = isDarkTheme();
  const state = EditorState.create({
    doc: currentText,
    extensions: [
      lineNumCompartment.of(lineNumbers()),
      history(),
      highlightActiveLine(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      // Liste Enter davranışı (eşleşmezse false döner, varsayılan Enter çalışır)
      keymap.of([{ key: "Enter", run: (view) => cmListEnter(view, (f) => undoHistory.record(f)) }]),
      search({ top: true }),
      highlightSelectionMatches(),
      markdown(),
      EditorView.domEventHandlers({
        paste: (event, view) => {
          const f = getImageFromClipboard(event);
          if (!f) {
            return false;
          }
          event.preventDefault();
          readAndSendImage(f, view.state.selection.main.head);
          return true;
        },
      }),
      languageCompartment.of(wordWrap ? EditorView.lineWrapping : []),
      themeCompartment.of(dark ? oneDark : []),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !cmApplyingExternal) {
          const t = u.state.doc.toString();
          markLocalEdit();
          currentText = t;
          updateWordCount();
          sendEdit(t);
          undoHistory.record();
          // Canlı blokların kaynağını kirletmemek için render'ı ertele
          scheduleLiveRerender();
        }
      }),
    ],
  });
  cmView = new EditorView({ state, parent: cmHost });
  // Split modda senkron kaydırma: kaynak -> önizleme
  cmView.scrollDOM.addEventListener("scroll", () => {
    if (mode !== "split" || syncingScroll || !cmView) {
      return;
    }
    const el = cmView.scrollDOM;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) {
      return;
    }
    const pmax = splitPreview.scrollHeight - splitPreview.clientHeight;
    if (pmax <= 0) {
      return;
    }
    syncingScroll = true;
    splitPreview.scrollTop = (el.scrollTop / max) * pmax;
    requestAnimationFrame(() => {
      syncingScroll = false;
    });
  });
  // Split modda senkron kaydırma: önizleme -> kaynak
  splitPreview.addEventListener("scroll", () => {
    if (mode !== "split" || syncingScroll || !cmView) {
      return;
    }
    const pmax = splitPreview.scrollHeight - splitPreview.clientHeight;
    if (pmax <= 0) {
      return;
    }
    const el = cmView.scrollDOM;
    const cmMax = el.scrollHeight - el.clientHeight;
    if (cmMax <= 0) {
      return;
    }
    syncingScroll = true;
    el.scrollTop = (splitPreview.scrollTop / pmax) * cmMax;
    requestAnimationFrame(() => {
      syncingScroll = false;
    });
  });
}

const scheduleLiveRerender = debounce(() => {
  if (mode === "live" && editingIndex === null) {
    renderLive();
  } else if (mode === "reading") {
    renderReading();
  } else if (mode === "split") {
    renderSplit();
  }
}, 600);

function syncCodeMirrorFromText() {
  if (!cmView) {
    return;
  }
  const docText = cmView.state.doc.toString();
  if (docText === currentText) {
    return;
  }
  // İmleci koru: tam-metin değişiminde seçim başını kelepçele
  const sel = cmView.state.selection.main;
  cmApplyingExternal = true;
  cmView.dispatch({
    changes: { from: 0, to: docText.length, insert: currentText },
    selection: {
      anchor: Math.min(sel.anchor, currentText.length),
      head: Math.min(sel.head, currentText.length),
    },
  });
  cmApplyingExternal = false;
}

function applyWordWrap() {
  if (!cmView) {
    return;
  }
  cmView.dispatch({ effects: languageCompartment.reconfigure(wordWrap ? EditorView.lineWrapping : []) });
}

function applyLineNumbers() {
  if (!cmView) {
    return;
  }
  cmView.dispatch({ effects: lineNumCompartment.reconfigure(lineNumbersOn ? lineNumbers() : []) });
}

// Yeniden çizimde kaydırma oranını koru (yapıştırma sonrası üste atmayı engeller)
function renderLiveKeepScroll() {
  const max0 = liveWrap.scrollHeight - liveWrap.clientHeight;
  const frac = max0 > 0 ? liveWrap.scrollTop / max0 : 0;
  renderLive();
  const max1 = liveWrap.scrollHeight - liveWrap.clientHeight;
  if (max1 > 0) {
    liveWrap.scrollTop = frac * max1;
  }
}

// ---------- Canlı mod (artımlı render: büyük dosyalarda takılmaz) ----------
let liveRenderId = 0;
const LIVE_CHUNK = 150;

function renderLive() {
  blocks = computeBlocks(currentText);
  if (editingIndex !== null && !blocks[editingIndex]) {
    editingIndex = null;
  }
  const id = ++liveRenderId;
  liveRoot.innerHTML = "";
  const appendBlock = (i: number) => {
    const b = blocks[i];
    if (i === editingIndex) {
      liveRoot.appendChild(buildEditBox(b, i));
    } else {
      const div = document.createElement("div");
      div.className = "block";
      div.dataset.index = String(i);
      div.innerHTML = b.html;
      wireRenderedBlock(div, i);
      liveRoot.appendChild(div);
    }
  };
  const finish = () => {
    if (id !== liveRenderId) {
      return;
    }
    postProcessImages(liveRoot);
    if (findApi.isOpen()) {
      findApi.refresh();
    }
    void runMermaid(liveRoot);
    formatApi.refreshBar();
  };
  if (blocks.length <= 400) {
    for (let i = 0; i < blocks.length; i++) {
      appendBlock(i);
    }
    finish();
    return;
  }
  let i = 0;
  const step = () => {
    if (id !== liveRenderId) {
      return;
    }
    const end = Math.min(i + LIVE_CHUNK, blocks.length);
    for (; i < end; i++) {
      appendBlock(i);
    }
    if (i < blocks.length) {
      requestAnimationFrame(step);
    } else {
      finish();
    }
  };
  requestAnimationFrame(step);
}

function buildEditBox(b: Block, index: number): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "block editing";
  wrapper.dataset.index = String(index);
  const ta = document.createElement("textarea");
  // Sondaki boş satırlar kırp ki imleç yeni satıra düşmesin, satır sonunda kalsın
  // (boşluklardan oluşan satırlar da dahil: "  \n  \n" gibi)
  ta.value = b.source.replace(/(?:\n[ \t]*)+$/, "");
  ta.rows = Math.max(1, b.source.split("\n").length);
  // Kod bloğu düzenleniyorsa mono fontta kal
  if (/^\s*```|^( {4}|\t)/m.test(ta.value)) {
    ta.classList.add("mono");
  }
  ta.setAttribute("aria-label", "Blok düzenle");
  ta.addEventListener("input", () => {
    autoGrow(ta);
    replaceBlockSource(index, ta.value);
  });
  ta.addEventListener("paste", (e) => {
    const f = getImageFromClipboard(e);
    if (!f) {
      return; // normal metin yapıştırma devam etsin
    }
    e.preventDefault();
    const inner = ta.selectionStart ?? ta.value.length;
    readAndSendImage(f, docOffsetForBlock(index, inner));
  });
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      commitEdit();
    }
    // Ctrl+Enter = bitir
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commitEdit();
    }
    // Düz Enter: liste öğesinde devam et / çık / girinti azalt
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
      const pos = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? pos;
      if (pos === end) {
        const lineStart = ta.value.lastIndexOf("\n", pos - 1) + 1;
        const nl = ta.value.indexOf("\n", pos);
        const lineEnd = nl === -1 ? ta.value.length : nl;
        const act = listEnterAction(ta.value.slice(lineStart, lineEnd));
        if (act.kind !== "none") {
          e.preventDefault();
          undoHistory.record(true);
          if (act.kind === "exit") {
            ta.setRangeText("", lineStart, lineEnd, "end");
          } else if (act.kind === "outdent") {
            const m2 = ta.value.slice(lineStart, lineEnd).match(/^(\t| {1,2})/);
            if (m2) {
              ta.setRangeText("", lineStart, lineStart + m2[0].length, "end");
            } else {
              ta.setRangeText("", lineStart, lineEnd, "end");
            }
          } else {
            ta.setRangeText("\n" + (act.marker ?? ""), pos, end, "end");
          }
          autoGrow(ta);
          replaceBlockSource(index, ta.value);
        }
      }
    }
    // NOT: stopPropagation YOK — Delete/Backspace ve Ctrl+F gibi tuşlar
    // document dinleyicilerine ulaşmalı (bloklar-arası silme, bulma çubuğu).
  });
  ta.addEventListener("blur", (e) => {
    // Biçim düğmesine/açık menüye/diyaloğa geçildiyse edit açık kalsın
    const to = (e.relatedTarget as HTMLElement | null) || null;
    if (
      to &&
      to.closest &&
      (to.closest("#formatbar") || to.closest(".kmenu") || to.closest(".kdialog"))
    ) {
      return;
    }
    if (isMenuOpen()) {
      return;
    }
    // checkbox/link tıklamasına izin vermek için microtask ertele
    setTimeout(() => {
      if (editingIndex === index) {
        commitEdit();
      }
    }, 150);
  });
  wrapper.appendChild(ta);
  // Tablo bloğunda tek düğmeyle açılır tablo menüsü
  if (isTableBlock(ta.value)) {
    const tbtn = document.createElement("button");
    tbtn.type = "button";
    tbtn.textContent = "Tablo ▾";
    tbtn.title = "Tablo işlemleri";
    tbtn.className = "tablemenu-btn";
    const applyTableEdit = (op: TableOp) => {
      const out = editTable(ta.value, op);
      if (out === null) {
        return;
      }
      undoHistory.record(true);
      ta.value = out;
      ta.focus();
      autoGrow(ta);
      replaceBlockSource(index, out);
    };
    tbtn.addEventListener("mousedown", (ev) => ev.preventDefault());
    tbtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      openMenu(tbtn, [
        { label: "+ Satır", run: () => applyTableEdit("add-row") },
        { label: "− Satır", run: () => applyTableEdit("del-row") },
        { label: "+ Sütun", run: () => applyTableEdit("add-col") },
        { label: "− Sütun", run: () => applyTableEdit("del-col") },
      ]);
    });
    const bar = document.createElement("div");
    bar.className = "tablebar";
    bar.appendChild(tbtn);
    wrapper.insertBefore(bar, ta);
  }
  requestAnimationFrame(() => {
    // Ölçüm DOM'a eklendikten sonra yapılmalı, yoksa yükseklik yanlış çıkar
    autoGrow(ta);
    ta.focus();
    // Odak sonrası seçim sıfırlanabilir — iki kez kur
    ta.setSelectionRange(ta.value.length, ta.value.length);
    requestAnimationFrame(() => {
      if (document.activeElement === ta) {
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    });
    wrapper.scrollIntoView({ block: "nearest" });
  });
  return wrapper;
}

function autoGrow(ta: HTMLTextAreaElement) {
  ta.style.height = "auto";
  ta.style.height = ta.scrollHeight + 6 + "px";
}

function replaceBlockSource(index: number, newSource: string) {
  const b = blocks[index];
  if (!b) {
    return;
  }
  const lines = currentText.split("\n");
  // endLine exclusive; boş dosya kenar durumu
  const before = lines.slice(0, b.startLine);
  const after = lines.slice(b.endLine);
  const mid = newSource.split("\n");
  const next = [...before, ...mid, ...after].join("\n");
  markLocalEdit();
  currentText = next;
  // Satır haritasını kaydır: Enter/silme ile blok satır sayısı değişince
  // sonraki blokların sınırları kayar, kaydırılmazsa içerik bozulur
  const delta = mid.length - (b.endLine - b.startLine);
  b.source = newSource;
  b.endLine = b.startLine + mid.length;
  if (delta !== 0) {
    for (let j = index + 1; j < blocks.length; j++) {
      blocks[j].startLine += delta;
      blocks[j].endLine += delta;
    }
  }
  updateWordCount();
  sendEdit(next);
  undoHistory.record();
  syncCodeMirrorFromText();
}

function commitEdit() {
  editingIndex = null;
  renderLive();
  syncCodeMirrorFromText();
}

function wireRenderedBlock(div: HTMLElement, index: number) {
  // Görev checkbox'ları: drew render sonrası input'ları yakala
  div.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    (cb as HTMLInputElement).disabled = false;
    cb.addEventListener("change", (e) => {
      e.stopPropagation();
      toggleTaskCheckbox(index, (cb as HTMLInputElement).checked);
    });
    // checkbox tıklaması blok-edit'e düşmesin
    cb.addEventListener("click", (e) => e.stopPropagation());
  });
  div.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const wiki = a.getAttribute("data-wikilink");
      if (wiki) {
        post({ type: "open-wikilink", name: wiki });
        return;
      }
      const href = a.getAttribute("href") || "";
      if (href) {
        post({ type: "open-link", href });
      }
    });
  });
  div.addEventListener("click", (e) => {
    // Sürükleyerek metin seçildiyse edit açma — seçim kalsın ki Delete ile silinebilsin
    const sel0 = window.getSelection();
    if (sel0 && !sel0.isCollapsed) {
      return;
    }
    const t = e.target as HTMLElement;
    if (t.closest("a") || t.closest('input[type="checkbox"]') || t.closest("pre")) {
      // kod bloğuna tıklayınca da düzenle, ama metin seçimine izin ver
      if (!t.closest("pre")) {
        return;
      }
    }
    if (editingIndex !== null && editingIndex !== index) {
      commitEdit();
    }
    editingIndex = index;
    renderLive();
  });
}

function toggleTaskCheckbox(blockIndex: number, checked: boolean) {
  const b = blocks[blockIndex];
  if (!b) {
    return;
  }
  // Blok içindeki ilk [ ] / [x] kalıbını çevir (basit ama etkili)
  const next = b.source.replace(/\[([ xX])\]/, checked ? "[x]" : "[ ]");
  if (next === b.source) {
    return;
  }
  undoHistory.record(true);
  replaceBlockSource(blockIndex, next);
  // Canlı görünümde checkbox durumunu anında yansıt (tam re-render gereksiz)
  b.source = next;
  b.html = renderBlockHtml(next);
  const div = liveRoot.querySelector(`div.block[data-index="${blockIndex}"]`);
  if (div) {
    div.innerHTML = b.html;
    wireRenderedBlock(div as HTMLElement, blockIndex);
  }
  if (mode === "reading") {
    renderReading();
  }
}

// ---------- Okuma + split önizlemesi ----------
function renderReading() {
  renderPreviewInto(readingRoot);
}

function renderSplit() {
  // Aynı karede geri yükle: rAF gecikmesi gidip-gelme çakması yapıyordu
  const max0 = splitPreview.scrollHeight - splitPreview.clientHeight;
  const frac = max0 > 0 ? splitPreview.scrollTop / max0 : 0;
  renderPreviewInto(splitRoot);
  const max1 = splitPreview.scrollHeight - splitPreview.clientHeight;
  if (max1 > 0) {
    syncingScroll = true;
    splitPreview.scrollTop = frac * max1;
    syncingScroll = false;
  }
}

// (renderFullWithFm pipeline'dan gelir)

// Okuma + split önizlemesi ortak render
function renderPreviewInto(root: HTMLElement) {
  root.innerHTML = renderFullWithFm(currentText);
  root.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    (cb as HTMLInputElement).disabled = false;
    cb.addEventListener("change", (e) => {
      e.stopPropagation();
      toggleTaskInFullText((cb as HTMLInputElement).checked, cb as HTMLInputElement, root);
    });
    cb.addEventListener("click", (e) => e.stopPropagation());
  });
  root.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const wiki = a.getAttribute("data-wikilink");
      if (wiki) {
        post({ type: "open-wikilink", name: wiki });
        return;
      }
      const href = a.getAttribute("href") || "";
      if (href) {
        post({ type: "open-link", href });
      }
    });
  });
  postProcessImages(root);
  if (findApi.isOpen()) {
    findApi.refresh();
  }
  void runMermaid(root);
}

// Okuma modunda checkbox: n'inci task'ı bulup çevir (sıra tabanlı)
function toggleTaskInFullText(checked: boolean, el: HTMLInputElement, root: HTMLElement = readingRoot) {
  const boxes = Array.from(root.querySelectorAll('input[type="checkbox"]'));
  const n = boxes.indexOf(el);
  if (n < 0) {
    return;
  }
  let count = -1;
  const next = currentText.replace(/\[([ xX])\]/g, (m) => {
    count++;
    if (count === n) {
      return checked ? "[x]" : "[ ]";
    }
    return m;
  });
  undoHistory.record(true);
  setTextFromWebview(next);
  syncCodeMirrorFromText();
}

// ---------- Mermaid ----------
function resetMermaid(root: HTMLElement) {
  root.querySelectorAll("div.mermaid[data-done]").forEach((node) => {
    delete (node as HTMLElement).dataset.done;
  });
}

let lastMermaidError = "";
let lastMermaidErrorTime = 0;
// Başarıyla çizilen SVG'ler kaynaktan önbelleğe alınır: her render'da
// yeniden çizmek titreme yapıyordu
const mermaidSvgCache = new Map<string, string>();

function cacheMermaidSvg(source: string, svg: string) {
  if (!mermaidSvgCache.has(source)) {
    if (mermaidSvgCache.size >= 50) {
      const first = mermaidSvgCache.keys().next();
      if (!first.done) {
        mermaidSvgCache.delete(first.value);
      }
    }
  }
  mermaidSvgCache.set(source, svg);
}

async function runMermaid(root: HTMLElement) {
  const nodes = Array.from(root.querySelectorAll("div.mermaid:not([data-done])"));
  if (nodes.length === 0) {
    return;
  }
  // Görünür olmayan kaptaki (display:none) diyagramlar atlanır:
  // getBBox gizli SVG'de patlar; görünür olunca sonraki render dener.
  const visible = nodes.filter((node) => (node as HTMLElement).offsetParent !== null);
  if (visible.length === 0) {
    return;
  }
  const fresh: HTMLElement[] = [];
  for (const node of visible) {
    const el = node as HTMLElement;
    const src = el.dataset.source ?? "";
    const hit = mermaidSvgCache.get(src);
    if (hit !== undefined) {
      el.innerHTML = hit;
      el.dataset.done = "1";
    } else {
      el.textContent = src || el.textContent || "";
      fresh.push(el);
    }
  }
  if (fresh.length === 0) {
    return;
  }
  try {
    // Mermaid ayrı chunk'tan tembel yüklenir (soğuk açılışı hafifletir).
    // NOT: statik import edilmez ki ana pakete gömülmesin.
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({
      startOnLoad: false,
      theme: isDarkTheme() ? "dark" : "default",
      securityLevel: "strict",
    });
    await mermaid.run({ nodes: fresh.map((n) => n as HTMLElement) });
    fresh.forEach((el) => {
      el.dataset.done = "1";
      cacheMermaidSvg(el.dataset.source ?? "", el.innerHTML);
    });
  } catch (err: any) {
    const raw = String((err as any)?.message ?? err);
    // getBBox vb. yerleşim hataları çevreseldir (gizli kap/async yarışı):
    // sessiz geçilir, sonraki render tekrar dener. Sentaks hataları gösterilir.
    const environmental =
      /getBBox|getComputedTextLength|NS_ERROR|not rendered|offsetParent/i.test(raw);
    const message = `Mermaid çizilemedi: ${raw}`;
    fresh.forEach((el) => {
      if (!environmental) {
        el.dataset.done = "1";
        el.classList.add("mermaid-err");
      }
    });
    if (environmental) {
      return;
    }
    const now = Date.now();
    if (message !== lastMermaidError || now - lastMermaidErrorTime > 5000) {
      lastMermaidError = message;
      lastMermaidErrorTime = now;
      post({
        type: "error",
        message,
      });
    }
  }
}

function refreshMermaidTheme() {
  // Yalnızca görünen kök çizilir: gizli kapta getBBox patlar.
  // Gizli kökler moda geçilince zaten yeniden render edilir.
  const root =
    mode === "live" ? liveRoot : mode === "reading" ? readingRoot : mode === "split" ? splitRoot : null;
  if (root && root.querySelector("div.mermaid")) {
    resetMermaid(root);
    void runMermaid(root);
  }
}

// ---------- Görseller ----------
function postProcessImages(root: HTMLElement) {
  const missing: string[] = [];
  root.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") || "";
    if (/^(https?:|data:|blob:|vscode-)/i.test(src) || src.startsWith("#") || src === "") {
      return;
    }
    const hit = imgUriCache.get(src);
    if (hit) {
      img.setAttribute("src", hit);
      img.title = "";
      return;
    }
    img.title = `Göreli görsel: ${src}`;
    img.alt = img.alt || src;
    if (!missing.includes(src)) {
      missing.push(src);
    }
  });
  if (missing.length > 0) {
    post({ type: "resolve-imgs", paths: missing });
  }
}

// ---------- Panodan görsel yapıştırma + göreli görsel çözümleme ----------
let pendingPaste = false;
const imgUriCache = new Map<string, string>();

function getImageFromClipboard(e: ClipboardEvent): File | null {
  const items = e.clipboardData?.items;
  if (!items) {
    return null;
  }
  for (const it of Array.from(items)) {
    if (it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) {
        return f;
      }
    }
  }
  return null;
}

function readAndSendImage(file: File, cursor: number) {
  if (file.size > 15 * 1024 * 1024) {
    post({ type: "error", message: "Görsel 15 MB'tan büyük, yapıştırılamadı." });
    return;
  }
  const r = new FileReader();
  r.onload = () => {
    pendingPaste = true;
    post({ type: "paste-image", dataUrl: String(r.result || ""), cursor });
  };
  r.onerror = () => post({ type: "error", message: "Görsel okunamadı." });
  r.readAsDataURL(file);
}

// Blok-içi offset'i doküman offset'ine çevir
function docOffsetForBlock(index: number, inner: number): number {
  const b = blocks[index];
  if (!b) {
    return inner;
  }
  const head = currentText.split("\n").slice(0, b.startLine).join("\n");
  return head.length + (b.startLine > 0 ? 1 : 0) + inner;
}


// Geri al/yinele zinciri history.ts içindedir (imleç çapalı anlık görüntüler).
const undoHistory = createHistory({
  getText: () => currentText,
  getAnchor: () => currentAnchor(),
  apply: (t, a) => applyHistText(t, a),
  changed: () => formatApi.refreshBar(),
});

// Alan denetleyiciler modüllerine bağlıdır (selection/search/format)
const formatApi = attachFormatbar({
  getMode: () => mode,
  getEditingIndex: () => editingIndex,
  setEditingIndex: (i) => {
    editingIndex = i;
  },
  getBlocks: () => blocks,
  liveRoot,
  getCmView: () => cmView,
  record: (force) => undoHistory.record(force),
  replaceBlock: (index, text) => replaceBlockSource(index, text),
  undoState: () => ({ canUndo: undoHistory.canUndo, canRedo: undoHistory.canRedo }),
  undoRedo: (cmd) => {
    if (cmd === "undo") {
      undoHistory.undo();
    } else {
      undoHistory.redo();
    }
  },
});

attachSelectionHandlers({
  getMode: () => mode,
  getEditingIndex: () => editingIndex,
  setEditingIndex: (i) => {
    editingIndex = i;
  },
  getBlocks: () => blocks,
  liveRoot,
  getText: () => currentText,
  applyDeleteResult: (text) => {
    markLocalEdit();
    currentText = text;
    updateWordCount();
    sendEdit(text);
    syncCodeMirrorFromText();
  },
  commit: () => commitEdit(),
  render: () => renderLive(),
  record: (force) => undoHistory.record(force),
});

const findApi = attachFindbar({
  getMode: () => mode,
  getText: () => currentText,
  record: (force) => undoHistory.record(force),
  applyFullText: (t) => applyHistText(t),
  roots: { live: liveRoot, reading: readingRoot, split: splitRoot },
});

// O anki imleç konumu (doküman offset'i)
function currentAnchor(): number | null {
  if ((mode === "source" || mode === "split") && cmView) {
    return cmView.state.selection.main.head;
  }
  if (mode === "live") {
    const ei = editingIndex;
    if (ei !== null && blocks[ei]) {
      const ta = liveRoot.querySelector("div.block.editing textarea") as HTMLTextAreaElement | null;
      if (ta) {
        const head = currentText.split("\n").slice(0, blocks[ei].startLine).join("\n");
        return head.length + (blocks[ei].startLine > 0 ? 1 : 0) + (ta.selectionStart ?? 0);
      }
    }
  }
  return null;
}

function applyHistText(t: string, anchor: number | null = null) {
  markLocalEdit();
  currentText = t;
  updateWordCount();
  post({ type: "edit", text: t, base: textBase });
  dirty = false;
  editingIndex = null;
  syncCodeMirrorFromText();
  if (anchor !== null && cmView && (mode === "source" || mode === "split")) {
    const pos = Math.max(0, Math.min(anchor, cmView.state.doc.length));
    cmView.dispatch({ selection: { anchor: pos } });
    cmView.focus();
  }
  if (mode === "live") {
    renderLive();
  } else if (mode === "reading") {
    renderReading();
  } else if (mode === "split") {
    renderSplit();
  }
  formatApi.refreshBar();
}


// ---------- Kod teması (highlight.js renkleri) ----------
let hljsStyleEl: HTMLStyleElement | null = null;
function applyHljsTheme() {
  const css = isDarkTheme() ? hljsDarkTheme : hljsLightTheme;
  if (!hljsStyleEl) {
    hljsStyleEl = document.createElement("style");
    hljsStyleEl.id = "hljs-theme";
    document.head.appendChild(hljsStyleEl);
  }
  if (hljsStyleEl.textContent !== css) {
    hljsStyleEl.textContent = css;
  }
}




// ---------- Mod yönetimi ----------
function setMode(m: Mode) {
  if (editingIndex !== null && m !== "live") {
    editingIndex = null;
  }
  mode = m;
  vscode.setState({ ...((vscode.getState() as any) || {}), mode: m });
  for (const [btn, key] of [
    [btnSource, "source"],
    [btnLive, "live"],
    [btnSplit, "split"],
    [btnReading, "reading"],
  ] as const) {
    btn.classList.toggle("active", key === m);
  }
  mainRow.classList.toggle("hidden", m !== "source" && m !== "split");
  sourceWrap.classList.toggle("hidden", m !== "source" && m !== "split");
  splitPreview.classList.toggle("hidden", m !== "split");
  liveWrap.classList.toggle("hidden", m !== "live");
  readingWrap.classList.toggle("hidden", m !== "reading");
  if (m === "source" && findApi.isOpen()) {
    // Kaynak modda CodeMirror paneli devralır
    findApi.closeFind();
  }
  if (m === "source" || m === "split") {
    syncCodeMirrorFromText();
    if (m === "split") {
      renderSplit();
    }
    requestAnimationFrame(() => cmView?.focus());
  } else if (m === "live") {
    renderLive();
  } else {
    renderReading();
  }
  if (findApi.isOpen()) {
    findApi.refresh();
  }
  formatApi.refreshBar();
}

btnSource.addEventListener("click", () => setMode("source"));
btnLive.addEventListener("click", () => setMode("live"));
btnSplit.addEventListener("click", () => setMode("split"));
btnReading.addEventListener("click", () => setMode("reading"));
readingRoot.addEventListener("dblclick", () => setMode("live"));

// Klavye: Ctrl+F bul (mod sekmeleri fareyle değişir)
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
    // CodeMirror paneli açıldıysa (Kaynak/Split-odak) ona bırak
    if (e.defaultPrevented) {
      return;
    }
    const cmHandles = mode === "source" || (mode === "split" && !!cmView?.hasFocus);
    if (!cmHandles) {
      e.preventDefault();
      findApi.openFind();
    }
    return;
  }
});

// Tema değişimini izle (CodeMirror koyu/açık)
new MutationObserver(
  debounce(() => {
    applyHljsTheme();
    refreshMermaidTheme();
    if (cmView) {
      cmView.dispatch({
        effects: themeCompartment.reconfigure(isDarkTheme() ? oneDark : []),
      });
    }
    document.documentElement.dataset.theme = isDarkTheme() ? "dark" : "light";
  }, 200)
).observe(document.body, { attributes: true, attributeFilter: ["class"] });

// Satıra kaydır + vurgula (outline / wikilink# navigasyonu)
function flashLine(line: number) {
  if (mode === "live") {
    let idx = blocks.findIndex((b) => line >= b.startLine && line < b.endLine);
    if (idx < 0) {
      idx = blocks.length - 1;
    }
    const div = liveRoot.querySelector(`div.block[data-index="${idx}"]`);
    if (div) {
      div.scrollIntoView({ block: "center" });
      div.classList.remove("flash");
      void (div as HTMLElement).offsetWidth;
      div.classList.add("flash");
      setTimeout(() => div.classList.remove("flash"), 1600);
    }
    return;
  }
  const host = mode === "reading" ? readingWrap : mode === "split" ? splitPreview : null;
  if (host) {
    const total = currentText === "" ? 1 : currentText.split("\n").length;
    const max = host.scrollHeight - host.clientHeight;
    if (max > 0) {
      host.scrollTop = (Math.min(line, total - 1) / Math.max(1, total - 1)) * max;
    }
  }
}

// ---------- Extension mesajları ----------
window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg?.proto !== undefined && msg.proto !== PROTO) {
    return; // bilinmeyen protokol sürümü
  }
  switch (msg?.type) {
    case "update": {
      const text: string = msg.text ?? "";
      isDirty = !!msg.isDirty;
      const incomingVersion: number =
        typeof msg.version === "number" ? msg.version : textBase;
      if (text === currentText) {
        // Yankı: sunucu yazımızı işledi
        textBase = incomingVersion;
        dirty = false;
        externalPending = null;
        updateWordCount();
        break;
      }
      const pasted = pendingPaste;
      if (pasted) {
        // Yapıştırılan görsel dokümana işlendi: edit kutusunu kapatıp yeniden renderla
        pendingPaste = false;
        editingIndex = null;
      }
      const wasEditing = editingIndex !== null;
      const cmTyping =
        cmView !== null && cmView.hasFocus && (mode === "source" || mode === "split");
      if (wasEditing || cmTyping || dirty) {
        // Gönderilmemiş yerel yazım var: üzerine yazma; sonraki gönderi
        // doğru tabanla (textBase) birleştirilir. Harita da bozulmaz.
        externalPending = { text, version: incomingVersion };
        updateWordCount();
        break;
      }
      currentText = text;
      textBase = incomingVersion;
      dirty = false;
      externalPending = null;
      // Geri-al zincirinin başlangıç noktası
      undoHistory.seed(text);
      updateWordCount();
      if (!cmView) {
        initCodeMirror();
      } else {
        // Kaynak/Split modda kullanıcı yazarken imleci ve kaydırmayı bozma
        if (!cmTyping) {
          syncCodeMirrorFromText();
        }
      }
      if (mode === "live") {
        if (pasted) {
          renderLiveKeepScroll();
        } else if (!wasEditing) {
          renderLive();
        }
        // düzenlerken: metin güncellendi ama render blur'da yapılacak
      } else if (mode === "reading") {
        renderReading();
      } else if (mode === "split") {
        renderSplit();
      } else if (!cmView?.hasFocus) {
        syncCodeMirrorFromText();
      }
      break;
    }
    case "conflict": {
      // Sunucu tabanı tutmadı: diskteki metin korunur, görünüm ona geçer
      const text: string = msg.text ?? currentText;
      const version: number = typeof msg.version === "number" ? msg.version : textBase;
      currentText = text;
      textBase = version;
      dirty = false;
      externalPending = null;
      editingIndex = null;
      updateWordCount();
      syncCodeMirrorFromText();
      if (mode === "live") {
        renderLive();
      } else if (mode === "reading") {
        renderReading();
      } else if (mode === "split") {
        renderSplit();
      }
      formatApi.refreshBar();
      break;
    }
    case "reveal-line": {
      flashLine(Math.max(0, Number(msg.line) || 0));
      break;
    }
    case "img-uris": {      const map = (msg.map ?? {}) as Record<string, string>;
      let changed = false;
      for (const k of Object.keys(map)) {
        if (imgUriCache.get(k) !== map[k]) {
          imgUriCache.set(k, map[k]);
          changed = true;
        }
      }
      if (changed) {
        document.querySelectorAll("#live-root img, #reading-root img, #split-root img").forEach((node) => {
          const el = node as HTMLImageElement;
          const src = el.getAttribute("src") || "";
          const hit = imgUriCache.get(src);
          if (hit && el.src !== hit) {
            el.src = hit;
            el.title = "";
          }
        });
      }
      break;
    }
    case "config": {
      const def = (msg.defaultMode as Mode) || "live";
      wordWrap = msg.wordWrap !== false;
      lineNumbersOn = (msg as any).lineNumbers !== false;
      applyWordWrap();
      applyLineNumbers();
      const saved = (vscode.getState() as any)?.mode as Mode | undefined;
      const initial = saved || (window as any).__karacaInitialMode || def;
      setMode(
        initial === "source" || initial === "reading" || initial === "split" || initial === "live"
          ? initial
          : def
      );
      break;
    }
  }
});

// ---------- boot ----------
(function boot() {
  const saved = (vscode.getState() as any)?.mode as Mode | undefined;
  mode = saved || "live";
  currentText = "";
  initCodeMirror();
  applyHljsTheme();
  setMode(mode);
  updateWordCount();
  post({ type: "ready" });
})();
