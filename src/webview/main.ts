import codeTheme from "./code-theme.css";
import { DocumentEditor } from "./document-editor";
import { SourceEditor } from "./source-editor";
import { DocumentSync } from "./document-sync";
import { renderPreview, runMermaid, refreshDiagrams } from "./preview";
import { attachFormatbar } from "./format";
import { attachFindbar } from "./search";
import { createPoster, PROTO } from "./protocol";
import { parseHeadings } from "../shared/md-utils";

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): { mode?: Mode; recoveryDraft?: string } | undefined;
  setState(state: unknown): void;
};
type Mode = "live" | "source" | "split" | "reading";
const vscode = acquireVsCodeApi();
const post = createPoster((message) => vscode.postMessage(message));
const $ = (id: string) => document.getElementById(id)!;
const validMode = (value: unknown): value is Mode => ["live", "source", "split", "reading"].includes(String(value));
let mode: Mode = validMode(vscode.getState()?.mode) ? vscode.getState()!.mode! : "live";
let configured = false;
let wrap = true, numbers = true;
let syncingScroll = false;
let previewTimer: ReturnType<typeof setTimeout>;
let imageSequence = 0;
const images = new Map<string, string>();
const pendingImages = new Map<string, "live" | "source">();
const liveRoot = $("live-root"), readingRoot = $("reading-root"), splitRoot = $("split-root");
let toolbar: ReturnType<typeof attachFormatbar> | undefined;
let find: ReturnType<typeof attachFindbar> | undefined;

const sync = new DocumentSync({
  send: post,
  changed: (text, external) => {
    if (external) { rich.load(text); source.load(text); }
    else if (mode === "live") source.load(text);
    schedulePreview();
    toolbar?.refreshBar();
  },
  status: (dirty) => { $("dirty").textContent = dirty ? "●" : ""; },
  recover: (draft) => {
    vscode.setState({ ...vscode.getState(), recoveryDraft: draft });
    showRecovery(draft);
    post({ type: "error", message: "Dış değişiklikle çakışan yerel taslak korundu. Üstteki Taslağı geri yükle düğmesiyle açabilirsiniz." });
  },
});
const rich = new DocumentEditor({
  element: liveRoot,
  changed: (text) => {
    sync.edit(text);
    source.load(text);
    resolveImages(liveRoot);
    toolbar?.refreshBar();
    if (find?.isOpen()) find.refresh();
  },
  selectionChanged: () => toolbar?.refreshBar(),
  pasteImage: (file) => saveImage(file, "live"),
  openLink: (href, wiki) => post(wiki ? { type: "open-wikilink", name: wiki } : { type: "open-link", href }),
});
const source = new SourceEditor($("cm-host"), (text) => { sync.edit(text); toolbar?.refreshBar(); },
  (file) => saveImage(file, "source"));
toolbar = attachFormatbar({
  getMode: () => mode, getEditor: () => rich.editor, getSource: () => source.view,
  undo: () => { if (mode === "live") rich.editor.commands.undo(); else source.undo(); toolbar?.refreshBar(); },
  redo: () => { if (mode === "live") rich.editor.commands.redo(); else source.redo(); toolbar?.refreshBar(); },
  history: () => mode === "live" ? { undo: rich.editor.can().undo(), redo: rich.editor.can().redo() }
    : { undo: source.canUndo, redo: source.canRedo },
});
find = attachFindbar({
  getMode: () => mode,
  getText: () => sync.text,
  applyFullText: (text) => {
    if (mode === "live") rich.replaceMarkdown(text);
    else source.view.dispatch({ changes: { from: 0, to: source.view.state.doc.length, insert: text } });
    refreshPreview();
  },
  liveFind: (query, active) => rich.find(query, active),
  liveStep: (index) => rich.focusMatch(index),
  liveReplace: (index, replacement, all) => rich.replaceMatch(index, replacement, all),
  roots: { live: liveRoot, reading: readingRoot, split: splitRoot },
});

function isDark(): boolean {
  return document.body.classList.contains("vscode-dark") || document.body.classList.contains("vscode-high-contrast");
}
const codeStyle = document.createElement("style");
codeStyle.textContent = codeTheme;
document.head.appendChild(codeStyle);
let previousTheme: boolean | undefined;
function theme(): void {
  source.configure(wrap, numbers, isDark());
  if (previousTheme !== isDark()) {
    previousTheme = isDark();
    for (const root of [liveRoot, readingRoot, splitRoot]) refreshDiagrams(root);
  }
}
function schedulePreview(): void {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(refreshPreview, 200);
}
function refreshPreview(): void {
  const root = mode === "reading" ? readingRoot : mode === "split" ? splitRoot : null;
  if (!root) return;
  renderPreview(root, sync.text);
  resolveImages(root);
  if (find?.isOpen()) find.refresh();
}
function setMode(next: Mode): void {
  toolbar?.close();
  find?.closeFind();
  sync.flush();
  if (mode === "live" && next !== "live") {
    pendingImages.forEach((target, nonce) => {
      if (target === "live") {
        source.bookmark(nonce);
        pendingImages.set(nonce, "source");
      }
    });
  }
  mode = next;
  vscode.setState({ ...vscode.getState(), mode });
  for (const name of ["source", "live", "split", "reading"] as Mode[]) {
    const button = $("btn-" + name);
    button.classList.toggle("active", next === name);
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(next === name));
  }
  $("main-row").classList.toggle("hidden", next !== "source" && next !== "split");
  $("source-wrap").classList.toggle("hidden", next !== "source" && next !== "split");
  $("split-preview").classList.toggle("hidden", next !== "split");
  $("live-wrap").classList.toggle("hidden", next !== "live");
  $("reading-wrap").classList.toggle("hidden", next !== "reading");
  if (next === "live") {
    rich.load(sync.text);
    resolveImages(liveRoot);
    void runMermaid(liveRoot);
  } else if (next === "source" || next === "split") source.load(sync.text);
  refreshPreview(); toolbar?.refreshBar();
}
for (const name of ["source", "live", "split", "reading"] as Mode[]) {
  $("btn-" + name).addEventListener("click", () => setMode(name));
}
readingRoot.addEventListener("dblclick", () => setMode("live"));

function resolveImages(root: HTMLElement): void {
  const missing = new Set<string>();
  root.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    const path = image.dataset.origsrc || image.getAttribute("src") || "";
    if (!path || /^(https?:|data:|blob:|vscode-)/i.test(path) || path.startsWith("#")) return;
    image.dataset.origsrc = path;
    const uri = images.get(path);
    if (uri) image.src = uri;
    else missing.add(path);
  });
  if (missing.size) post({ type: "resolve-imgs", paths: Array.from(missing) });
}
function saveImage(file: File, target: "live" | "source"): void {
  if (file.size > 15 * 1024 * 1024) { post({ type: "error", message: "Görsel 15 MB'tan büyük." }); return; }
  const nonce = `image-${Date.now()}-${++imageSequence}`;
  pendingImages.set(nonce, target);
  if (target === "live") rich.bookmark(nonce); else source.bookmark(nonce);
  const reader = new FileReader();
  reader.onload = () => post({ type: "save-image", nonce, dataUrl: reader.result });
  reader.onerror = () => { pendingImages.delete(nonce); post({ type: "error", message: "Görsel okunamadı." }); };
  reader.readAsDataURL(file);
}
function showRecovery(draft: string): void {
  $("recovery-draft")?.remove();
  const button = document.createElement("button");
  button.id = "recovery-draft"; button.type = "button"; button.textContent = "Taslağı geri yükle";
  button.addEventListener("click", () => {
    setMode("live"); rich.replaceMarkdown(draft);
    vscode.setState({ ...vscode.getState(), recoveryDraft: undefined }); button.remove();
  });
  $("formatbar").appendChild(button);
}
function reveal(line: number): void {
  if (mode === "source" || mode === "split") {
    const doc = source.view.state.doc, target = doc.line(Math.min(doc.lines, line + 1));
    source.view.dispatch({ selection: { anchor: target.from }, scrollIntoView: true });
  }
  const root = mode === "live" ? liveRoot : mode === "reading" ? readingRoot : splitRoot;
  const flatten = (nodes: ReturnType<typeof parseHeadings>): { line: number; label: string }[] =>
    nodes.flatMap((node) => [node, ...flatten(node.children)]);
  const heading = flatten(parseHeadings(sync.text)).find((node) => node.line === line);
  const element = heading ? Array.from(root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"))
    .find((node) => node.textContent === heading.label) : null;
  element?.scrollIntoView({ block: "center" });
}

// Preview navigation is delegated once. Read-only mode never changes tasks.
for (const root of [readingRoot, splitRoot]) root.addEventListener("click", (event) => {
  const link = (event.target as HTMLElement).closest("a");
  if (!link) return;
  event.preventDefault();
  const wiki = link.getAttribute("data-wikilink");
  post(wiki ? { type: "open-wikilink", name: wiki } : { type: "open-link", href: link.getAttribute("href") || "" });
});
function scrollTogether(from: HTMLElement, to: HTMLElement): void {
  if (mode !== "split" || syncingScroll) return;
  const max = from.scrollHeight - from.clientHeight;
  if (max <= 0) return;
  syncingScroll = true;
  to.scrollTop = from.scrollTop / max * Math.max(0, to.scrollHeight - to.clientHeight);
  requestAnimationFrame(() => { syncingScroll = false; });
}
source.view.scrollDOM.addEventListener("scroll", () => scrollTogether(source.view.scrollDOM, $("split-preview")));
$("split-preview").addEventListener("scroll", () => scrollTogether($("split-preview"), source.view.scrollDOM));

document.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key.toLowerCase() === "s") { event.preventDefault(); sync.save(); }
  if (event.key.toLowerCase() === "f" && !event.defaultPrevented && mode !== "source" && !(mode === "split" && source.view.hasFocus)) {
    event.preventDefault(); find?.openFind();
  }
}, true);
window.addEventListener("blur", () => sync.flush());
window.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || (message.proto !== undefined && message.proto !== PROTO)) return;
  if (message.type === "update" && typeof message.text === "string" && typeof message.version === "number") {
    sync.receive(message);
    resolveImages(liveRoot); void runMermaid(liveRoot);
  } else if (message.type === "edit-result") {
    sync.acknowledge(message.requestId, message, !!message.conflict);
    resolveImages(liveRoot);
  } else if (message.type === "config") {
    wrap = message.wordWrap !== false; numbers = message.lineNumbers !== false; theme();
    if (!configured) { setMode(vscode.getState()?.mode || (validMode(message.defaultMode) ? message.defaultMode : "live")); configured = true; }
  } else if (message.type === "img-saved") {
    const target = pendingImages.get(message.nonce); pendingImages.delete(message.nonce);
    if (!target || !message.path) return;
    if (target === "live") rich.insertImage(message.nonce, message.path);
    else {
      source.insertImage(message.nonce, message.path);
      if (mode === "live") rich.load(sync.text);
    }
    resolveImages(liveRoot);
  } else if (message.type === "img-uris") {
    for (const [path, uri] of Object.entries(message.map || {})) if (typeof uri === "string") images.set(path, uri);
    for (const root of [liveRoot, readingRoot, splitRoot]) resolveImages(root);
  } else if (message.type === "reveal-line") reveal(Math.max(0, Number(message.line) || 0));
});
new MutationObserver(theme).observe(document.body, { attributes: true, attributeFilter: ["class"] });
window.addEventListener("pagehide", () => { sync.flush(); rich.destroy(); source.view.destroy(); });
theme(); setMode(mode);
const recovery = vscode.getState()?.recoveryDraft;
if (recovery) showRecovery(recovery);
post({ type: "ready" });

// Eliminated from production builds; integration tests exercise real transactions.
declare const __TEST__: boolean;
if (typeof __TEST__ !== "undefined" && __TEST__) {
  (window as any).__karacaTest = { rich, source, sync, setMode };
}
