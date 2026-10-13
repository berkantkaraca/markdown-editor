import mermaid from "mermaid";
import hljsDarkTheme from "highlight.js/styles/vs2015.css";
import hljsLightTheme from "highlight.js/styles/vs.css";
import { createMdPipeline, type Block } from "../shared/md-pipeline";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, highlightActiveLine, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { search, searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  buildFindRegex as makeFindRegex,
  togglePrefix,
  toggleTaskLine,
  toggleHeadingLine,
  setHeadingLevel,
  isParaLike,
  joinKeptLines,
  isTableBlock,
  editTable,
} from "../shared/md-utils";

declare function acquireVsCodeApi(): {
  postMessage(msg: any): void;
  getState(): any;
  setState(s: any): void;
};

const vscode = acquireVsCodeApi();

// Webview <-> extension mesaj protokolü sürümü
const PROTO = 1;

// ---------- markdown-it (kurulum shared/md-pipeline içindedir, test edilir) ----------
const { renderBlockHtml, renderFullWithFm, computeBlocks } = createMdPipeline();

// ---------- state ----------
type Mode = "source" | "live" | "split" | "reading";
let mode: Mode = "live";
let currentText = "";
let isDirty = false;
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
  vscode.postMessage({ proto: PROTO, type: "edit", text });
}, 250);

function setTextFromWebview(newText: string) {
  if (newText === currentText) {
    return;
  }
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
          currentText = t;
          updateWordCount();
          sendEdit(t);
          recordHist();
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
  if (docText !== currentText) {
    cmApplyingExternal = true;
    cmView.dispatch({ changes: { from: 0, to: docText.length, insert: currentText } });
    cmApplyingExternal = false;
  }
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
    if (findOpen) {
      updateFind();
    }
    void runMermaid(liveRoot);
    refreshBar();
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
    // NOT: stopPropagation YOK — Delete/Backspace ve Ctrl+F gibi tuşlar
    // document dinleyicilerine ulaşmalı (bloklar-arası silme, bulma çubuğu).
  });
  ta.addEventListener("blur", (e) => {
    // Biçim düğmesine geçildiyse edit açık kalsın (komut hedefsiz kalmasın)
    const to = (e.relatedTarget as HTMLElement | null) || null;
    if (to && to.closest && (to.closest("#formatbar") || to.closest(".kmenu"))) {
      return;
    }
    // Açılır menü açıkken (odak menüde) commit ertele — seçim 150 ms'de ölmesin
    if (openMenuEl) {
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
      recordHist(true);
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
  recordHist();
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
        vscode.postMessage({ proto: PROTO, type: "open-wikilink", name: wiki });
        return;
      }
      const href = a.getAttribute("href") || "";
      if (href) {
        vscode.postMessage({ proto: PROTO, type: "open-link", href });
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
  recordHist(true);
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
        vscode.postMessage({ proto: PROTO, type: "open-wikilink", name: wiki });
        return;
      }
      const href = a.getAttribute("href") || "";
      if (href) {
        vscode.postMessage({ proto: PROTO, type: "open-link", href });
      }
    });
  });
  postProcessImages(root);
  if (findOpen) {
    updateFind();
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
  recordHist(true);
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
      vscode.postMessage({
        proto: PROTO,
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
    vscode.postMessage({ proto: PROTO, type: "resolve-imgs", paths: missing });
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
    vscode.postMessage({ proto: PROTO, type: "error", message: "Görsel 15 MB'tan büyük, yapıştırılamadı." });
    return;
  }
  const r = new FileReader();
  r.onload = () => {
    pendingPaste = true;
    vscode.postMessage({ proto: PROTO, type: "paste-image", dataUrl: String(r.result || ""), cursor });
  };
  r.onerror = () => vscode.postMessage({ proto: PROTO, type: "error", message: "Görsel okunamadı." });
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

// ---------- Açılır menü (H seviyeleri, tablo işlemleri) ----------
let openMenuEl: HTMLElement | null = null;

function closeMenu() {
  openMenuEl?.remove();
  openMenuEl = null;
  document.removeEventListener("mousedown", menuOutside, true);
  // NOT: burada commit YOK. İşlem (it.run) kapatmadan önce çalışır ve odağı
  // editöre döndürür; menü dışı tıklamada blur zaten commit'i tetikler.
}

function menuOutside(e: MouseEvent) {
  const t = e.target as HTMLElement | null;
  if (
    openMenuEl &&
    !(t?.closest?.(".kmenu") || t?.closest?.("[data-cmd$='-menu']") || t?.closest?.(".tablebar"))
  ) {
    closeMenu();
  }
}

function openMenu(
  anchor: HTMLElement,
  items: Array<{ label: string; title?: string; run: () => void }>
) {
  closeMenu();
  const menu = document.createElement("div");
  menu.className = "kmenu";
  menu.addEventListener("mousedown", (e) => e.preventDefault());
  menu.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
    }
  });
  for (const it of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = it.label;
    if (it.title) {
      b.title = it.title;
    }
    b.addEventListener("click", (e) => {
      e.preventDefault();
      // Önce işlem (odak ve içerik yerindeyken), sonra kapat
      it.run();
      closeMenu();
    });
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(4, r.left)}px`;
  menu.style.top = `${r.bottom + 4}px`;
  openMenuEl = menu;
  document.addEventListener("mousedown", menuOutside, true);
  const first = menu.querySelector("button") as HTMLButtonElement | null;
  first?.focus();
}

// ---------- Biçim çubuğu + geri al/yinele ----------
const formatbar = $("formatbar");
const fmtButtons = Array.from(formatbar.querySelectorAll("button[data-cmd]")) as HTMLButtonElement[];

type Target = { kind: "cm" } | { kind: "ta"; el: HTMLTextAreaElement; index: number } | null;

function getTarget(): Target {
  if ((mode === "source" || mode === "split") && cmView) {
    return { kind: "cm" };
  }
  if (mode === "live" && editingIndex !== null) {
    const ta = liveRoot.querySelector("div.block.editing textarea") as HTMLTextAreaElement | null;
    if (ta) {
      return { kind: "ta", el: ta, index: editingIndex };
    }
  }
  return null;
}

// Snapshot tabanlı geri al/yinele (Kaynak ve Canlı modda ortak çalışır)
const hist: string[] = [];
let hi = -1;
let lastRecTime = 0;
function recordHist(force = false) {
  const now = Date.now();
  if (hist[hi] === currentText) {
    return;
  }
  if (!force && now - lastRecTime < 2500 && hi >= 0) {
    return;
  }
  lastRecTime = now;
  hist.length = hi + 1;
  hist.push(currentText);
  if (hist.length > 100) {
    hist.shift();
  }
  hi = hist.length - 1;
  refreshBar();
}
function applyHistText(t: string) {
  currentText = t;
  updateWordCount();
  vscode.postMessage({ proto: PROTO, type: "edit", text: t });
  editingIndex = null;
  syncCodeMirrorFromText();
  if (mode === "live") {
    renderLive();
  } else if (mode === "reading") {
    renderReading();
  } else if (mode === "split") {
    renderSplit();
  }
  refreshBar();
}
function doUndo() {
  if (hi < 0) {
    return;
  }
  if (currentText !== hist[hi]) {
    // Henüz kaydedilmemiş yazım: anlık durumu kaydet, sonra geri git
    hist.length = hi + 1;
    hist.push(currentText);
    hi = hist.length - 1;
  }
  if (hi > 0) {
    hi--;
    applyHistText(hist[hi]);
  } else {
    refreshBar();
  }
}
function doRedo() {
  if (hi < hist.length - 1) {
    hi++;
    applyHistText(hist[hi]);
  }
}

function cmWrap(before: string, after: string, placeholder: string) {
  if (!cmView) {
    return;
  }
  const r = cmView.state.selection.main;
  const sel = cmView.state.doc.sliceString(r.from, r.to) || placeholder;
  recordHist(true);
  cmView.dispatch({
    changes: { from: r.from, to: r.to, insert: before + sel + after },
    selection: { anchor: r.from + before.length, head: r.from + before.length + sel.length },
  });
  cmView.focus();
}

function cmEachLine(fn: (text: string) => string | null) {
  if (!cmView) {
    return;
  }
  const doc = cmView.state.doc;
  const r = cmView.state.selection.main;
  const l1 = doc.lineAt(r.from).number;
  const l2 = doc.lineAt(r.to).number;
  const changes: { from: number; to: number; insert: string }[] = [];
  for (let n = l1; n <= l2; n++) {
    const line = doc.line(n);
    const nt = fn(line.text);
    if (nt !== null && nt !== line.text) {
      changes.push({ from: line.from, to: line.to, insert: nt });
    }
  }
  if (changes.length === 0) {
    cmView.focus();
    return;
  }
  recordHist(true);
  cmView.dispatch({ changes });
  cmView.focus();
}

function cmInsert(text: string, selAnchor?: number, selHead?: number) {
  if (!cmView) {
    return;
  }
  const r = cmView.state.selection.main;
  recordHist(true);
  cmView.dispatch({
    changes: { from: r.from, to: r.to, insert: text },
    selection:
      selAnchor !== undefined
        ? { anchor: r.from + selAnchor, head: r.from + (selHead ?? selAnchor) }
        : undefined,
  });
  cmView.focus();
}

// (satır aç-kapa yardımcıları shared/md-utils içinden gelir)

function taWrap(before: string, after: string, placeholder: string) {
  const t = getTarget();
  if (!t || t.kind !== "ta") {
    return;
  }
  const el = t.el;
  const s = el.selectionStart ?? 0;
  const e = el.selectionEnd ?? 0;
  const sel = el.value.slice(s, e) || placeholder;
  recordHist(true);
  el.setRangeText(before + sel + after, s, e, "end");
  el.selectionStart = s + before.length;
  el.selectionEnd = s + before.length + sel.length;
  el.focus();
  autoGrow(el);
  replaceBlockSource(t.index, el.value);
}

function taEachLine(fn: (text: string) => string | null) {
  const t = getTarget();
  if (!t || t.kind !== "ta") {
    return;
  }
  const el = t.el;
  const s = el.selectionStart ?? 0;
  const e = el.selectionEnd ?? 0;
  const v = el.value;
  const ls = v.slice(0, s).split("\n").length - 1;
  const le = v.slice(0, e).split("\n").length - 1;
  const arr = v.split("\n");
  let changed = false;
  for (let i = ls; i <= le; i++) {
    const nt = fn(arr[i]);
    if (nt !== null && nt !== arr[i]) {
      arr[i] = nt;
      changed = true;
    }
  }
  if (!changed) {
    el.focus();
    return;
  }
  recordHist(true);
  el.value = arr.join("\n");
  el.focus();
  autoGrow(el);
  replaceBlockSource(t.index, el.value);
}

function taInsert(text: string, selAnchor?: number, selHead?: number) {
  const t = getTarget();
  if (!t || t.kind !== "ta") {
    return;
  }
  const el = t.el;
  const s = el.selectionStart ?? el.value.length;
  const e = el.selectionEnd ?? s;
  recordHist(true);
  el.setRangeText(text, s, e, "end");
  if (selAnchor !== undefined) {
    el.selectionStart = s + selAnchor;
    el.selectionEnd = s + (selHead ?? selAnchor);
  }
  el.focus();
  autoGrow(el);
  replaceBlockSource(t.index, el.value);
}

function selText(): string {
  const t = getTarget();
  if (!t) {
    return "";
  }
  if (t.kind === "cm") {
    if (!cmView) {
      return "";
    }
    const r = cmView.state.selection.main;
    return cmView.state.doc.sliceString(r.from, r.to);
  }
  const s = t.el.selectionStart ?? 0;
  const e = t.el.selectionEnd ?? 0;
  return t.el.value.slice(s, e);
}

function wrapSel(before: string, after: string, ph: string) {
  const t = getTarget();
  if (!t) {
    return;
  }
  if (t.kind === "cm") {
    cmWrap(before, after, ph);
  } else {
    taWrap(before, after, ph);
  }
}

function eachLineSel(fn: (text: string) => string | null) {
  const t = getTarget();
  if (!t) {
    return;
  }
  if (t.kind === "cm") {
    cmEachLine(fn);
  } else {
    taEachLine(fn);
  }
}

function insertAtCursor(text: string, selAnchor?: number, selHead?: number) {
  const t = getTarget();
  if (!t) {
    return;
  }
  if (t.kind === "cm") {
    cmInsert(text, selAnchor, selHead);
  } else {
    taInsert(text, selAnchor, selHead);
  }
}

import type { TableOp } from "../shared/md-utils";

const TABLE_TEMPLATE = "\n| Başlık 1 | Başlık 2 |\n| --- | --- |\n|  |  |\n";

function tableOp(op: TableOp) {
  const t = getTarget();
  if (!t) {
    return;
  }
  if (t.kind === "cm") {
    if (!cmView) {
      return;
    }
    const doc = cmView.state.doc;
    const cur = doc.lineAt(cmView.state.selection.main.head).number;
    let s = cur;
    let e = cur;
    const isT = (n: number) => n >= 1 && n <= doc.lines && doc.line(n).text.trim().startsWith("|");
    while (isT(s - 1)) {
      s--;
    }
    while (isT(e + 1)) {
      e++;
    }
    const src = doc.sliceString(doc.line(s).from, doc.line(e).to);
    const out = editTable(src, op);
    if (out === null) {
      return;
    }
    recordHist(true);
    cmView.dispatch({ changes: { from: doc.line(s).from, to: doc.line(e).to, insert: out } });
    cmView.focus();
    return;
  }
  const out = editTable(t.el.value, op);
  if (out === null) {
    return;
  }
  recordHist(true);
  t.el.value = out;
  t.el.focus();
  autoGrow(t.el);
  replaceBlockSource(t.index, out);
}

function runFormat(cmd: string) {
  if (cmd === "undo") {
    doUndo();
    return;
  }
  if (cmd === "redo") {
    doRedo();
    return;
  }
  if (!getTarget()) {
    return;
  }
  switch (cmd) {
    case "bold":
      wrapSel("**", "**", "metin");
      break;
    case "italic":
      wrapSel("*", "*", "metin");
      break;
    case "strike":
      wrapSel("~~", "~~", "metin");
      break;
    case "heading-menu": {
      const btn = fmtButtons.find((x) => x.dataset.cmd === "heading-menu");
      openMenu(
        btn ?? document.body,
        [1, 2, 3, 4, 5, 6]
          .map((n) => ({
            label: `H${n}`,
            title: `Başlık ${n}`,
            run: () => eachLineSel(setHeadingLevel(n)),
          }))
          .concat([{ label: "Temizle", title: "Başlığı kaldır", run: () => eachLineSel(toggleHeadingLine) }])
      );
      break;
    }
    case "table-menu": {
      const btn = fmtButtons.find((x) => x.dataset.cmd === "table-menu");
      openMenu(btn ?? document.body, [
        { label: "Tablo Ekle", run: () => insertAtCursor(TABLE_TEMPLATE) },
        { label: "+ Satır", run: () => tableOp("add-row") },
        { label: "− Satır", run: () => tableOp("del-row") },
        { label: "+ Sütun", run: () => tableOp("add-col") },
        { label: "− Sütun", run: () => tableOp("del-col") },
      ]);
      break;
    }
    case "image":
      insertAtCursor("![açıklama](görsel.png)", 2, 10);
      break;
    case "bullet":
      eachLineSel(togglePrefix("- "));
      break;
    case "numbered":
      eachLineSel(togglePrefix("1. "));
      break;
    case "task":
      eachLineSel(toggleTaskLine);
      break;
    case "quote":
      eachLineSel(togglePrefix("> "));
      break;
    case "code":
      if (selText().includes("\n")) {
        wrapSel("```\n", "\n```", "kod");
      } else {
        wrapSel("`", "`", "kod");
      }
      break;
    case "link": {
      const label = selText() || "metin";
      const urlStart = label.length + 3;
      insertAtCursor(`[${label}](https://)`, urlStart, urlStart + 8);
      break;
    }
  }
  refreshBar();
}

function refreshBar() {
  const show = mode !== "reading";
  formatbar.classList.toggle("hidden", !show);
  if (!show) {
    return;
  }
  const t = getTarget();
  const canUndo = hi > 0 || (hi >= 0 && currentText !== hist[hi]);
  const canRedo = hi < hist.length - 1;
  for (const b of fmtButtons) {
    const cmd = b.dataset.cmd || "";
    if (cmd === "undo") {
      b.disabled = !canUndo;
    } else if (cmd === "redo") {
      b.disabled = !canRedo;
    } else {
      b.disabled = t === null;
    }
  }
}

fmtButtons.forEach((b) => {
  // mousedown'da odağı çalma: canlı blok editi kapanmasın, komut hedefsiz kalmasın
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", (e) => {
    e.preventDefault();
    runFormat(b.dataset.cmd || "");
  });
});

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

// ---------- Canlı modda bloklar-arası toplu silme ----------
// Not: document seviyesinde dinlenir — sürükle-seç sonrası odak body'de olur,
// liveRoot'a bağlı olsaydı tuş olayı hiç ulaşmazdı
document.addEventListener("keydown", (e) => {
  if (mode !== "live") {
    return; // okuma salt okunur, split'te kaynak panelden silinir
  }
  if (e.key !== "Delete" && e.key !== "Backspace") {
    return;
  }
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
    return;
  }
  const inEditBox = (n: Node | null): boolean =>
    !!(n && n.parentElement?.closest?.("div.block.editing"));
  // Seçim açık edit kutusunun içindeyse textarea'ya bırak (native)
  if (inEditBox(sel.anchorNode) || inEditBox(sel.focusNode)) {
    return;
  }
  if (!liveRoot.contains(sel.anchorNode) || !liveRoot.contains(sel.focusNode)) {
    return;
  }
  // Odak yabancı bir girdideyse (bulma kutusu vb.) karışma.
  // Açık edit kutusu sorun değil: aşağıda önce commit'lenir.
  const ae = document.activeElement as HTMLElement | null;
  if (
    ae &&
    (ae.tagName === "INPUT" ||
      ae.tagName === "BUTTON" ||
      ae.isContentEditable ||
      (ae.closest && ae.closest("#cm-host, #toolbar, #formatbar, #findbar")))
  ) {
    return;
  }
  const range = sel.getRangeAt(0);
  const victims: number[] = [];
  liveRoot.querySelectorAll("div.block:not(.editing)").forEach((node) => {
    const div = node as HTMLElement;
    const idx = Number(div.dataset.index);
    if (Number.isNaN(idx) || !blocks[idx]) {
      return;
    }
    try {
      const r2 = document.createRange();
      r2.selectNodeContents(div);
      if (
        range.compareBoundaryPoints(Range.START_TO_START, r2) <= 0 &&
        range.compareBoundaryPoints(Range.END_TO_END, r2) >= 0
      ) {
        victims.push(idx);
      }
    } catch {
      /* seçim blok dışına taştıysa yoksay */
    }
  });
  if (victims.length === 0) {
    // Kısmi seçim: çapa bloğu düzenlemeye aç (ikinci Delete içeride çalışır)
    const anchorEl = sel.anchorNode?.parentElement;
    const host = anchorEl?.closest?.("div.block[data-index]") as HTMLElement | null;
    const idx = host ? Number(host.dataset.index) : NaN;
    if (host && !Number.isNaN(idx) && blocks[idx] && editingIndex !== idx) {
      e.preventDefault();
      if (editingIndex !== null) {
        commitEdit();
      }
      editingIndex = idx;
      renderLive();
      // Bayat seçimi temizle: düğümler yıkıldı, ikinci Delete TA içinde çalışsın
      sel.removeAllRanges();
    }
    return;
  }
  e.preventDefault();
  // Seçim varken açık edit varsa önce kapat (metin zaten senkron, harita tazelenir)
  if (editingIndex !== null) {
    commitEdit();
  }
  recordHist(true);
  const spans = victims
    .map((i) => blocks[i])
    .filter((b) => !!b)
    .map((b) => [b.startLine, b.endLine] as [number, number]);
  const lines = currentText.split("\n");
  const removed = new Array<boolean>(lines.length).fill(false);
  for (const [s, en] of spans) {
    for (let i = Math.max(0, s); i < Math.min(en, lines.length); i++) {
      removed[i] = true;
    }
  }
  currentText = joinKeptLines(lines, removed);
  updateWordCount();
  sendEdit(currentText);
  syncCodeMirrorFromText();
  sel.removeAllRanges();
  renderLive();
});

// (joinKeptLines / isParaLike shared/md-utils içinden gelir)

// ---------- Bulma çubuğu (Canlı/Okuma/Split önizleme) ----------
const findbar = $("findbar");
const findInput = $("find-input") as HTMLInputElement;
const findCount = $("find-count");
const replaceRow = $("replace-row");
const replaceInput = $("replace-input") as HTMLInputElement;
let findOpen = false;
let findMarks: HTMLElement[] = [];
let findIdx = -1;
let findCase = false;
let findWord = false;
let findRegex = false;
let replaceOpen = false;

function currentPreviewRoot(): HTMLElement | null {
  if (mode === "live") {
    return liveRoot;
  }
  if (mode === "reading") {
    return readingRoot;
  }
  if (mode === "split") {
    return splitRoot;
  }
  return null;
}

function openFind() {
  findOpen = true;
  findbar.classList.remove("hidden");
  findInput.focus();
  findInput.select();
  updateFind();
}

function closeFind() {
  findOpen = false;
  findbar.classList.add("hidden");
  clearFindMarks();
}

function clearFindMarks() {
  document.querySelectorAll("mark.find-hit").forEach((node) => {
    const m = node as HTMLElement;
    const parent = m.parentNode;
    if (!parent) {
      return;
    }
    parent.replaceChild(document.createTextNode(m.textContent || ""), m);
    parent.normalize();
  });
  findMarks = [];
  findIdx = -1;
  updateFindCount();
}

function buildFindRegex(): RegExp | null {
  return makeFindRegex(findInput.value, {
    caseSensitive: findCase,
    wholeWord: findWord,
    regex: findRegex,
  });
}

function updateFind() {
  clearFindMarks();
  const q = findInput.value;
  if (!q) {
    return;
  }
  const root = currentPreviewRoot();
  if (!root) {
    return;
  }
  const re = buildFindRegex();
  if (!re) {
    findCount.textContent = "hatalı ifade";
    return;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) {
    nodes.push(n as Text);
  }
  for (const node of nodes) {
    const text = node.textContent || "";
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let i = 0;
    let found = false;
    const frag = document.createDocumentFragment();
    while ((m = re.exec(text))) {
      found = true;
      frag.appendChild(document.createTextNode(text.slice(i, m.index)));
      const mark = document.createElement("mark");
      mark.className = "find-hit";
      mark.textContent = m[0].length > 0 ? m[0] : text.slice(m.index, m.index + 1) || " ";
      frag.appendChild(mark);
      findMarks.push(mark);
      i = m.index + (m[0].length || 1);
      if (m[0].length === 0) {
        re.lastIndex = i;
      }
    }
    if (!found) {
      continue;
    }
    frag.appendChild(document.createTextNode(text.slice(i)));
    node.parentNode?.replaceChild(frag, node);
  }
  if (findMarks.length > 0) {
    findIdx = 0;
    showFindMark(0);
  }
  updateFindCount();
}

// Doküman üzerindeki eşleşmeler (Değiştir işlemleri için, kaynak offset'li)
function docMatches(): Array<[number, number]> {
  const re = buildFindRegex();
  if (!re) {
    return [];
  }
  re.lastIndex = 0;
  const out: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(currentText))) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

function applyReplaceAll() {
  const re = buildFindRegex();
  if (!re) {
    return;
  }
  recordHist(true);
  // String.replace $1, $& gibi desenleri kendi genişletir
  applyHistText(currentText.replace(re, replaceInput.value));
}

function applyReplaceOne() {
  const all = docMatches();
  if (all.length === 0) {
    return;
  }
  const re = buildFindRegex();
  if (!re) {
    return;
  }
  const [s, e] = all[((findIdx % all.length) + all.length) % all.length];
  const single = new RegExp(`^(?:${re.source})$`, re.flags.replace("g", ""));
  const rep = currentText.slice(s, e).replace(single, replaceInput.value);
  recordHist(true);
  applyHistText(currentText.slice(0, s) + rep + currentText.slice(e));
}

function refreshFindButtons() {
  findbar.querySelectorAll("button[data-ffind]").forEach((node) => {
    const b = node as HTMLButtonElement;
    const cmd = b.dataset.ffind || "";
    b.classList.toggle(
      "on",
      (cmd === "case" && findCase) || (cmd === "word" && findWord) || (cmd === "regex" && findRegex)
    );
  });
}

function updateFindCount() {
  if (!findInput.value) {
    findCount.textContent = "";
    return;
  }
  findCount.textContent =
    findMarks.length === 0 ? "bulunamadı" : `${findIdx + 1} / ${findMarks.length}`;
}

function showFindMark(i: number) {
  findMarks.forEach((m, j) => m.classList.toggle("current", i === j));
  const el = findMarks[i];
  if (el) {
    el.scrollIntoView({ block: "center" });
  }
}

function stepFind(dir: 1 | -1) {
  if (findMarks.length === 0) {
    return;
  }
  findIdx = (findIdx + dir + findMarks.length) % findMarks.length;
  showFindMark(findIdx);
  updateFindCount();
}

findInput.addEventListener(
  "input",
  debounce(() => updateFind(), 150)
);
findInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    stepFind(e.shiftKey ? -1 : 1);
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeFind();
  }
  e.stopPropagation();
});
findbar.querySelectorAll("button[data-ffind]").forEach((node) => {
  const b = node as HTMLButtonElement;
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", (e) => {
    e.preventDefault();
    const cmd = b.dataset.ffind || "";
    if (cmd === "close") {
      closeFind();
    } else if (cmd === "prev") {
      stepFind(-1);
    } else if (cmd === "next") {
      stepFind(1);
    } else if (cmd === "case") {
      findCase = !findCase;
      refreshFindButtons();
      updateFind();
    } else if (cmd === "word") {
      findWord = !findWord;
      refreshFindButtons();
      updateFind();
    } else if (cmd === "regex") {
      findRegex = !findRegex;
      refreshFindButtons();
      updateFind();
    } else if (cmd === "toggle-replace") {
      replaceOpen = !replaceOpen;
      replaceRow.classList.toggle("hidden", !replaceOpen);
      if (replaceOpen) {
        replaceInput.focus();
      } else {
        findInput.focus();
      }
    } else if (cmd === "replace") {
      applyReplaceOne();
    } else if (cmd === "replace-all") {
      applyReplaceAll();
    }
  });
});

// ---------- Markdown olarak kopyalama (canlı önizleme) ----------
document.addEventListener("copy", (e) => {
  // Açık edit kutusu varsa native kopya zaten markdown'dır
  if (editingIndex !== null) {
    return;
  }
  if (mode !== "live") {
    return;
  }
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
    return;
  }
  const ae = document.activeElement as HTMLElement | null;
  if (
    ae &&
    (ae.tagName === "INPUT" ||
      ae.tagName === "TEXTAREA" ||
      (ae.closest && ae.closest("#cm-host")))
  ) {
    return;
  }
  if (!liveRoot.contains(sel.anchorNode) || !liveRoot.contains(sel.focusNode)) {
    return;
  }
  const range = sel.getRangeAt(0);
  const victims: number[] = [];
  liveRoot.querySelectorAll("div.block:not(.editing)").forEach((node) => {
    const div = node as HTMLElement;
    const idx = Number(div.dataset.index);
    if (Number.isNaN(idx) || !blocks[idx]) {
      return;
    }
    try {
      const r2 = document.createRange();
      r2.selectNodeContents(div);
      if (
        range.compareBoundaryPoints(Range.START_TO_START, r2) <= 0 &&
        range.compareBoundaryPoints(Range.END_TO_END, r2) >= 0
      ) {
        victims.push(idx);
      }
    } catch {
      /* yoksay */
    }
  });
  if (victims.length === 0) {
    // Tek blok tam metin seçimi mi? (örn. başlığa üç kez tıklandı)
    const anchorEl = sel.anchorNode?.parentElement;
    const host = anchorEl?.closest?.("div.block[data-index]:not(.editing)") as HTMLElement | null;
    if (host && host.contains(sel.focusNode)) {
      const idx = Number(host.dataset.index);
      const b = blocks[idx];
      const norm = (s: string) => s.replace(/\s+/g, " ").trim();
      if (b && norm(sel.toString()) === norm(host.textContent || "") && norm(host.textContent || "") !== "") {
        victims.push(idx);
      }
    }
  }
  if (victims.length === 0 || !e.clipboardData) {
    return;
  }
  e.preventDefault();
  const parts = victims
    .map((i) => blocks[i].source.replace(/(?:\n[ \t]*)+$/, "").trim())
    .filter((s) => s !== "");
  e.clipboardData.setData("text/plain", parts.join("\n\n").replace(/\n{3,}/g, "\n\n"));
  try {
    const tmp = document.createElement("div");
    tmp.appendChild(range.cloneContents());
    e.clipboardData.setData("text/html", tmp.innerHTML);
  } catch {
    /* html olmazsa düz metin yeter */
  }
});

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
  if (m === "source" && findOpen) {
    // Kaynak modda CodeMirror paneli devralır
    closeFind();
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
  if (findOpen) {
    updateFind();
  }
  refreshBar();
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
      openFind();
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
      if (text === currentText) {
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
      currentText = text;
      // Geri-al zincirinin başlangıç noktası
      if (hist.length === 0) {
        hist.push(text);
        hi = 0;
      }
      updateWordCount();
      if (!cmView) {
        initCodeMirror();
      } else {
        // Kaynak/Split modda kullanıcı yazarken imleci ve kaydırmayı bozma
        const cmTyping = cmView.hasFocus && (mode === "source" || mode === "split");
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
  vscode.postMessage({ proto: PROTO, type: "ready" });
})();
