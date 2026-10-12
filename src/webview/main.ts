import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import hljs from "highlight.js";
import hljsDarkTheme from "highlight.js/styles/vs2015.css";
import hljsLightTheme from "highlight.js/styles/vs.css";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, highlightActiveLine, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";

declare function acquireVsCodeApi(): {
  postMessage(msg: any): void;
  getState(): any;
  setState(s: any): void;
};

const vscode = acquireVsCodeApi();

// ---------- markdown-it ----------
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight(str: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang }).value}</code></pre>`;
      } catch {
        /* fallthrough */
      }
    }
    const esc = md.utils.escapeHtml(str);
    return `<pre class="hljs"><code>${esc}</code></pre>`;
  },
});
md.use(taskLists as any, { enabled: true, label: true, labelAfter: true });

// ---------- state ----------
type Mode = "source" | "live" | "reading";
let mode: Mode = "live";
let currentText = "";
let isDirty = false;
let wordWrap = true;
let editingIndex: number | null = null;
let blocks: Block[] = [];
let cmView: EditorView | null = null;
let cmApplyingExternal = false;
const languageCompartment = new Compartment();

interface Block {
  startLine: number;
  endLine: number; // exclusive
  source: string;
  html: string;
}

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
const wcEl = $("wordcount");
const dirtyEl = $("dirty");

// ---------- helpers ----------
function debounce<T extends (...a: any[]) => void>(fn: T, ms: number): T {
  let t: any;
  return ((...args: any[]) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// [[Sayfa]] ve [[Sayfa|Etiket]] -> tıklanabilir wiki linki
function renderWikilinks(src: string): string {
  return src.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, p1: string, p2: string) => {
    const name = String(p1).trim();
    const label = (p2 ?? name).trim();
    const safeLabel = md.utils.escapeHtml(label);
    return `<a data-wikilink="${escapeAttr(name)}" href="#">${safeLabel}</a>`;
  });
}

function renderBlockHtml(source: string): string {
  return md.render(renderWikilinks(source));
}

function computeBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const tokens = md.parse(text, {});
  const ranges: Array<[number, number]> = [];
  for (const tok of tokens) {
    if (tok.map && tok.level === 0 && tok.type !== "inline") {
      const [s, e] = tok.map as [number, number];
      // paragraph_open + inline + paragraph_close üçlüsünü tek blok yap;
      // token stream'de *_open tokenları map taşır, close taşımaz.
      // Ardışık open tokenlar üst üste binmesin diye basit birleştirme:
      ranges.push([s, e]);
    }
  }
  // Çakışan / bitişik aralıkları birleştir
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) {
      last[1] = Math.max(last[1], r[1]);
    } else {
      merged.push([...r] as [number, number]);
    }
  }
  // Token üretmeyen boş satır aralarını da "boş blok" olarak ekle ki tıklanıp yazılabilsin
  const result: Block[] = [];
  let cursor = 0;
  const pushGap = (s: number, e: number) => {
    if (e > s) {
      const source = lines.slice(s, e).join("\n");
      // Saf boşluk satırları: her boşlukta ipucu göstermek yerine ince, tıklanabilir boşluk
      const html = source.trim() === "" ? `<div class="gap-spacer"></div>` : renderBlockHtml(source);
      result.push({ startLine: s, endLine: e, source, html });
    }
  };
  for (const [s, e] of merged) {
    pushGap(cursor, s);
    const source = lines.slice(s, e).join("\n");
    result.push({ startLine: s, endLine: e, source, html: renderBlockHtml(source) });
    cursor = e;
  }
  pushGap(cursor, lines.length);
  // Tamamen boş dosya
  if (result.length === 0) {
    result.push({ startLine: 0, endLine: 1, source: "", html: `<p class="empty-hint">Yazmak için tıklayın…</p>` });
  } else if (result.length === 1 && result[0].source.trim() === "") {
    result[0].html = `<p class="empty-hint">Yazmak için tıklayın…</p>`;
  }
  return result;
}

function updateWordCount() {
  const words = (currentText.trim().match(/\S+/g) || []).length;
  const chars = currentText.length;
  const lines = currentText === "" ? 0 : currentText.split("\n").length;
  wcEl.textContent = `${words} kelime · ${chars} karakter · ${lines} satır`;
  dirtyEl.textContent = isDirty ? "●" : "";
}

const sendEdit = debounce((text: string) => {
  vscode.postMessage({ type: "edit", text });
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
  const themeExt = dark ? oneDark : [];
  const state = EditorState.create({
    doc: currentText,
    extensions: [
      lineNumbers(),
      history(),
      highlightActiveLine(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
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
      ...(Array.isArray(themeExt) ? themeExt : [themeExt]),
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
}

const scheduleLiveRerender = debounce(() => {
  if (mode === "live" && editingIndex === null) {
    renderLive();
  } else if (mode === "reading") {
    renderReading();
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

// ---------- Canlı mod ----------
function renderLive() {
  blocks = computeBlocks(currentText);
  liveRoot.innerHTML = "";
  blocks.forEach((b, i) => {
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
  });
  postProcessImages(liveRoot);
  refreshBar();
}

function buildEditBox(b: Block, index: number): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "block editing";
  wrapper.dataset.index = String(index);
  const ta = document.createElement("textarea");
  // Sondaki boş satırları kırp ki imleç yeni satıra düşmesin, satır sonunda kalsın
  ta.value = b.source.replace(/\n+$/, "");
  ta.rows = Math.max(2, b.source.split("\n").length);
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
    e.stopPropagation();
  });
  ta.addEventListener("blur", (e) => {
    // Biçim düğmesine geçildiyse edit açık kalsın (komut hedefsiz kalmasın)
    const to = (e.relatedTarget as HTMLElement | null) || null;
    if (to && to.closest && to.closest("#formatbar")) {
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
  requestAnimationFrame(() => {
    // Ölçüm DOM'a eklendikten sonra yapılmalı, yoksa yükseklik yanlış çıkar
    autoGrow(ta);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
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
  b.source = newSource;
  // Satır numaraları kaydı — bir sonraki render'da recompute edilecek
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
        vscode.postMessage({ type: "open-wikilink", name: wiki });
        return;
      }
      const href = a.getAttribute("href") || "";
      if (href) {
        vscode.postMessage({ type: "open-link", href });
      }
    });
  });
  div.addEventListener("click", (e) => {
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

// ---------- Okuma modu ----------
function renderReading() {
  readingRoot.innerHTML = md.render(renderWikilinks(currentText));
  readingRoot.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    (cb as HTMLInputElement).disabled = false;
    cb.addEventListener("change", (e) => {
      e.stopPropagation();
      toggleTaskInFullText((cb as HTMLInputElement).checked, cb as HTMLInputElement);
    });
    cb.addEventListener("click", (e) => e.stopPropagation());
  });
  readingRoot.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const wiki = a.getAttribute("data-wikilink");
      if (wiki) {
        vscode.postMessage({ type: "open-wikilink", name: wiki });
        return;
      }
      const href = a.getAttribute("href") || "";
      if (href) {
        vscode.postMessage({ type: "open-link", href });
      }
    });
  });
  postProcessImages(readingRoot);
}

// Okuma modunda checkbox: n'inci task'ı bulup çevir (sıra tabanlı)
function toggleTaskInFullText(checked: boolean, el: HTMLInputElement) {
  const boxes = Array.from(readingRoot.querySelectorAll('input[type="checkbox"]'));
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
    vscode.postMessage({ type: "resolve-imgs", paths: missing });
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
    vscode.postMessage({ type: "error", message: "Görsel 15 MB'tan büyük, yapıştırılamadı." });
    return;
  }
  const r = new FileReader();
  r.onload = () => {
    pendingPaste = true;
    vscode.postMessage({ type: "paste-image", dataUrl: String(r.result || ""), cursor });
  };
  r.onerror = () => vscode.postMessage({ type: "error", message: "Görsel okunamadı." });
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

// ---------- Biçim çubuğu + geri al/yinele ----------
const formatbar = $("formatbar");
const fmtButtons = Array.from(formatbar.querySelectorAll("button[data-cmd]")) as HTMLButtonElement[];

type Target = { kind: "cm" } | { kind: "ta"; el: HTMLTextAreaElement; index: number } | null;

function getTarget(): Target {
  if (mode === "source" && cmView) {
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
  vscode.postMessage({ type: "edit", text: t });
  editingIndex = null;
  syncCodeMirrorFromText();
  if (mode === "live") {
    renderLive();
  } else if (mode === "reading") {
    renderReading();
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

const togglePrefix =
  (p: string) =>
  (t: string): string | null => {
    if (t.trim() === "") {
      return null;
    }
    return t.startsWith(p) ? t.slice(p.length) : p + t;
  };

function toggleTaskLine(t: string): string | null {
  if (t.trim() === "") {
    return null;
  }
  const m = t.match(/^(\s*)(- \[[ xX]\] |- )(.*)$/);
  if (!m) {
    return `- [ ] ${t}`;
  }
  if (m[2] === "- ") {
    return `${m[1]}- [ ] ${m[3]}`;
  }
  return `${m[1]}- ${m[3]}`;
}

function toggleHeadingLine(t: string): string | null {
  if (t.trim() === "") {
    return null;
  }
  const m = t.match(/^(#{1,6}\s+)/);
  if (m) {
    return t.slice(m[0].length);
  }
  return `## ${t}`;
}

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

const TABLE_TEMPLATE = "\n| Başlık 1 | Başlık 2 |\n| --- | --- |\n|  |  |\n";

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
    case "heading":
      eachLineSel(toggleHeadingLine);
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
    case "table":
      insertAtCursor(TABLE_TEMPLATE);
      break;
    case "link": {
      const label = selText() || "metin";
      const urlStart = label.length + 3;
      insertAtCursor(`[${label}](https://)`, urlStart, urlStart + 8);
      break;
    }
    case "image":
      insertAtCursor("![açıklama](görsel.png)", 2, 10);
      break;
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
    [btnReading, "reading"],
  ] as const) {
    btn.classList.toggle("active", key === m);
  }
  sourceWrap.classList.toggle("hidden", m !== "source");
  liveWrap.classList.toggle("hidden", m !== "live");
  readingWrap.classList.toggle("hidden", m !== "reading");
  if (m === "source") {
    syncCodeMirrorFromText();
    requestAnimationFrame(() => cmView?.focus());
  } else if (m === "live") {
    renderLive();
  } else {
    renderReading();
  }
  refreshBar();
}

btnSource.addEventListener("click", () => setMode("source"));
btnLive.addEventListener("click", () => setMode("live"));
btnReading.addEventListener("click", () => setMode("reading"));
readingRoot.addEventListener("dblclick", () => setMode("live"));

// Klavye kısayolları: Ctrl+1/2/3 mod değiştir
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && ["1", "2", "3"].includes(e.key)) {
    e.preventDefault();
    setMode(e.key === "1" ? "source" : e.key === "2" ? "live" : "reading");
  }
});

// Tema değişimini izle (CodeMirror koyu/açık)
new MutationObserver(
  debounce(() => {
    applyHljsTheme();
    if (!cmView) {
      return;
    }
    const dark = isDarkTheme();
    cmView.dispatch({ effects: [] }); // no-op, tema V2'de dinamik değişecek
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, 200)
).observe(document.body, { attributes: true, attributeFilter: ["class"] });

// ---------- Extension mesajları ----------
window.addEventListener("message", (event) => {
  const msg = event.data;
  switch (msg?.type) {
    case "update": {
      const text: string = msg.text ?? "";
      isDirty = !!msg.isDirty;
      if (text === currentText) {
        updateWordCount();
        break;
      }
      if (pendingPaste) {
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
        // Kaynak modda kullanıcı yazarken imleci bozma
        const focused = cmView.hasFocus;
        if (!(mode === "source" && focused)) {
          syncCodeMirrorFromText();
        }
      }
      if (mode === "live") {
        if (!wasEditing) {
          renderLive();
        }
        // düzenlerken: metin güncellendi ama render blur'da yapılacak
      } else if (mode === "reading") {
        renderReading();
      } else if (!cmView?.hasFocus) {
        syncCodeMirrorFromText();
      }
      break;
    }
    case "img-uris": {
      const map = (msg.map ?? {}) as Record<string, string>;
      let changed = false;
      for (const k of Object.keys(map)) {
        if (imgUriCache.get(k) !== map[k]) {
          imgUriCache.set(k, map[k]);
          changed = true;
        }
      }
      if (changed) {
        document.querySelectorAll("#live-root img, #reading-root img").forEach((node) => {
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
      applyWordWrap();
      const saved = (vscode.getState() as any)?.mode as Mode | undefined;
      const initial = saved || (window as any).__karacaInitialMode || def;
      setMode(initial === "source" || initial === "reading" || initial === "live" ? initial : def);
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
  vscode.postMessage({ type: "ready" });
})();
