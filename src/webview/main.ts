import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import hljs from "highlight.js";
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
      languageCompartment.of(wordWrap ? EditorView.lineWrapping : []),
      ...(Array.isArray(themeExt) ? themeExt : [themeExt]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !cmApplyingExternal) {
          const t = u.state.doc.toString();
          currentText = t;
          updateWordCount();
          sendEdit(t);
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
}

function buildEditBox(b: Block, index: number): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "block editing";
  wrapper.dataset.index = String(index);
  const ta = document.createElement("textarea");
  ta.value = b.source;
  ta.rows = Math.max(1, b.source.split("\n").length);
  ta.setAttribute("aria-label", "Blok düzenle");
  autoGrow(ta);
  ta.addEventListener("input", () => {
    autoGrow(ta);
    replaceBlockSource(index, ta.value);
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
  ta.addEventListener("blur", () => {
    // checkbox/link tıklamasına izin vermek için microtask ertele
    setTimeout(() => {
      if (editingIndex === index) {
        commitEdit();
      }
    }, 150);
  });
  wrapper.appendChild(ta);
  requestAnimationFrame(() => {
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  });
  return wrapper;
}

function autoGrow(ta: HTMLTextAreaElement) {
  ta.style.height = "auto";
  ta.style.height = ta.scrollHeight + "px";
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
  setTextFromWebview(next);
  syncCodeMirrorFromText();
}

// ---------- Görseller ----------
function postProcessImages(root: HTMLElement) {
  // http/data zaten çalışır; göreli yollar için başlık ekle (V2'de webview-uri çözümleme gelecek)
  root.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") || "";
    if (/^(https?:|data:|blob:|vscode-)/i.test(src) || src.startsWith("#")) {
      return;
    }
    img.title = `Göreli görsel: ${src} (aynı klasörde olmalı)`;
    img.alt = img.alt || src;
  });
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
      const wasEditing = editingIndex !== null;
      currentText = text;
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
  setMode(mode);
  updateWordCount();
  vscode.postMessage({ type: "ready" });
})();
