import { diffHunks, gitLines } from "../shared/git-diff";
import { t } from "./i18n";
import { setLanguage, localizeChrome } from "./i18n";
import codeTheme from "./code-theme.css";
import { DocumentEditor } from "./document-editor";
import { SourceEditor } from "./source-editor";
import { DocumentSync, type LocalDraft, type SyncState } from "./document-sync";
import { renderPreview, runMermaid, refreshDiagrams } from "./preview";
import { attachFormatbar } from "./format";
import { attachTableHover } from "./table-hover";
import { attachFindbar } from "./search";
import { createPoster, PROTO, type EditorHost } from "./protocol";
import { createMarkdown } from "../shared/md-pipeline";
import { parseFrontmatter, parseHeadings } from "../shared/md-utils";
import { decorateGitPreview } from "./git-markers";
import { scrollKey, captureScroll, applyScroll, cancelScroll, type ScrollSurface, type ScrollPosition } from "./comparison-scroll";

type Mode = "live" | "source" | "split" | "reading";
type ViewState = { mode?: string; recoveryDraft?: string; draft?: LocalDraft; scrollOffsets?: Record<string, number> };
declare function acquireVsCodeApi(): EditorHost<ViewState>;
const browserHost = window.__karacaBrowserHost;
const vscode: EditorHost<ViewState> = browserHost ?? acquireVsCodeApi();
const post = createPoster((message) => vscode.postMessage(message));
const $ = (id: string) => document.getElementById(id)!;
const validMode = (value: unknown): value is Mode => ["live", "source", "split", "reading"].includes(String(value));
const storedMode = vscode.getState()?.mode;
let mode: Mode = validMode(storedMode) ? storedMode : "live";
let configured = false;
let saveAfterComposition = false;
const compositionMessages: any[] = [];
let wrap = true, numbers = true;

let previewTimer: ReturnType<typeof setTimeout>;
let imageSequence = 0;
let syncState: SyncState = "idle";
const images = new Map<string, string>();
const pendingImages = new Map<string, "live" | "source">();
const pendingPlainPastes = new Set<string>();
let plainPasteSequence = 0;
const imagePickers = new Map<string, (file: string) => void>();
const liveRoot = $("live-root"), readingRoot = $("reading-root"), splitRoot = $("split-root");
function updateLanguage(language: unknown): void {
  setLanguage(language);
  document.documentElement.lang = language === "tr" ? "tr" : "en";
  for (const id of ["formatbar", "findbar", "back-to-live", "sync-retry"]) localizeChrome($(id));
  for (const node of liveRoot.querySelectorAll<HTMLElement>(".preserved-content")) node.title = t("Düzenlemek için çift tıklayın");
  $("sync-message").textContent = syncState === "blocked" ? t("Kayıt tamamlanamadı. Taslağınız korundu.") : t("Kaydı yeniden deniyoruz…");
}
updateLanguage("en");
let toolbar: ReturnType<typeof attachFormatbar> | undefined;
let tableHover: ReturnType<typeof attachTableHover> | undefined;
let find: ReturnType<typeof attachFindbar> | undefined;
let gitBase: string | null = null;
let comparisonSide: "original" | "modified" | null = null;
let pairedComparison = false;
let changeIndex = -1;
let changes = diffHunks([], []);
function updateComparisonNavigation(): void {
  changes = pairedComparison && comparisonSide === "modified" && gitBase !== null
    ? diffHunks(gitLines(gitBase), gitLines(sync.text)) : [];
  changeIndex = -1;
  $("comparison-nav").classList.toggle("hidden", comparisonSide !== "modified" || !pairedComparison);
  for (const id of ["comparison-prev", "comparison-next"]) {
    ($(id) as HTMLButtonElement).disabled = !changes.length;
  }
  $("comparison-count").textContent = String(changes.length);
}
let gitTimer: ReturnType<typeof setTimeout>;
function refreshGit(): void {
  updateComparisonNavigation();
  if (mode === "live") rich.refreshGit();
  if (mode === "reading") decorateGitPreview(readingRoot, gitBase, sync.text, comparisonSide === "original");
  if (mode === "split") decorateGitPreview(splitRoot, gitBase, sync.text, comparisonSide === "original");
}

const sync = new DocumentSync({
  send: post,
  changed: (text, external) => {
    if (external) {
      if (mode === "live") rich.load(text);
      else source.load(text);
    }
    schedulePreview();
    clearTimeout(gitTimer); gitTimer = setTimeout(refreshGit, 180);
    toolbar?.refreshBar();
  },
  status: (dirty) => { $("dirty").textContent = dirty ? "●" : ""; },
  draftChanged: (draft) => {
    vscode.setState({ ...vscode.getState(), draft: draft || undefined });
    post(draft ? { type: "draft", draft } : { type: "draft-clear", expectedText: sync.text });
  },
  stateChanged: (state) => {
    syncState = state;
    $("sync-alert").classList.toggle("hidden", state !== "blocked" && state !== "retrying");
    $("sync-message").textContent = state === "blocked" ? t("Kayıt tamamlanamadı. Taslağınız korundu.") : t("Kaydı yeniden deniyoruz…");
    $("sync-retry").classList.toggle("hidden", state !== "blocked");
  },
  recover: (draft) => {
    showRecovery(draft);
    post({ type: "error", message: t("Dış değişiklikle çakışan yerel taslak korundu. Üstteki Taslağı geri yükle düğmesiyle açabilirsiniz.") });
  },
});
const rich = new DocumentEditor({
  element: liveRoot,
  changed: (text) => {
    sync.edit(text);
    resolveImages(liveRoot);
    void runMermaid(liveRoot);
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
  insertSpecial: (kind) => rich.insertSpecial(kind),
  pickImage: (done) => {
    const nonce = `pick-${Date.now()}-${++imageSequence}`;
    imagePickers.set(nonce, done); post({ type: "pick-image", nonce });
  },
  undo: () => { if (mode === "live") rich.editor.commands.undo(); else source.undo(); toolbar?.refreshBar(); },
  redo: () => { if (mode === "live") rich.editor.commands.redo(); else source.redo(); toolbar?.refreshBar(); },
  history: () => mode === "live" ? { undo: rich.editor.can().undo(), redo: rich.editor.can().redo() }
    : { undo: source.canUndo, redo: source.canRedo },
});
tableHover = attachTableHover(rich.editor,()=>comparisonSide === "original" ? "reading" : mode,anchor=>toolbar?.tableMenu(anchor));
find = attachFindbar({
  getMode: () => mode,
  getText: () => sync.text,
  applyFullText: (text) => {
    if (comparisonSide === "original") return;
    if (mode === "live") rich.replaceMarkdown(text);
    else source.view.dispatch({ changes: { from: 0, to: source.view.state.doc.length, insert: text } });
    refreshPreview();
  },
  liveFind: (query, active) => rich.find(query, active),
  liveStep: (index) => rich.focusMatch(index),
  liveReplace: (index, replacement, all) => { if (comparisonSide !== "original") rich.replaceMatch(index, replacement, all); },
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
  decorateGitPreview(root, gitBase, sync.text, comparisonSide === "original");
  resolveImages(root);
  if (find?.isOpen()) find.refresh();
}
function setMode(next: Mode): void {
  toolbar?.close();
  tableHover?.hide();
  find?.closeFind();
  rich.flush();
  sync.flush();
  if (mode === "live" && next !== "live") {
    source.load(sync.text);
    pendingImages.forEach((target, nonce) => {
      if (target === "live") {
        source.bookmark(nonce);
        pendingImages.set(nonce, "source");
      }
    });
  }
  mode = next;
  if (comparisonSide !== "original") post({ type: "comparison-mode", mode });
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
  refreshPreview(); refreshGit(); toolbar?.refreshBar();
}
for (const name of ["source", "live", "split", "reading"] as Mode[]) {
  $("btn-" + name).addEventListener("click", () => setMode(name));
}
readingRoot.addEventListener("dblclick", () => { if (comparisonSide !== "original") setMode("live"); });

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
  if (comparisonSide === "original") return;
  if (file.size > 15 * 1024 * 1024) { post({ type: "error", message: t("Görsel 15 MB'tan büyük.") }); return; }
  const nonce = `image-${Date.now()}-${++imageSequence}`;
  pendingImages.set(nonce, target);
  if (target === "live") rich.bookmark(nonce); else source.bookmark(nonce);
  const reader = new FileReader();
  reader.onload = () => post({ type: "save-image", nonce, dataUrl: reader.result });
  reader.onerror = () => { pendingImages.delete(nonce); post({ type: "error", message: t("Görsel okunamadı.") }); };
  reader.readAsDataURL(file);
}
function showRecovery(draft: string): void {
  $("recovery-draft")?.remove();
  vscode.setState({ ...vscode.getState(), recoveryDraft: draft });
  const notice = document.createElement("div"); notice.id = "recovery-draft"; notice.className = "document-notice";
  notice.setAttribute("role", "status");
  const label = document.createElement("span"); label.textContent = t("Kaydedilmemiş bir taslak bulundu.");
  const restore = document.createElement("button"); restore.type = "button"; restore.textContent = t("Taslağı geri yükle");
  const dismiss = document.createElement("button"); dismiss.type = "button"; dismiss.textContent = t("Taslağı sil");
  restore.onclick = () => {
    setMode("live"); rich.replaceMarkdown(draft); rich.flush();
    vscode.setState({ ...vscode.getState(), recoveryDraft: undefined }); notice.remove();
  };
  dismiss.onclick = () => {
    const state = vscode.getState();
    vscode.setState({ ...state, recoveryDraft: undefined, draft: state?.draft?.text === draft ? undefined : state?.draft });
    post({ type: "draft-clear", expectedText: draft }); notice.remove();
  };
  notice.append(label, restore, dismiss); $("formatbar").insertAdjacentElement("afterend", notice);
}
$("sync-retry").addEventListener("click", () => { rich.flush(); sync.retry(); });
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

function revealChange(line: number): void {
  if (mode === "source" || mode === "split") {
    const target = source.view.state.doc.line(Math.min(source.view.state.doc.lines, line + 1));
    const block = source.view.lineBlockAt(target.from);
    const pane = source.view.scrollDOM;
    pane.scrollTop += source.view.documentTop + block.top - pane.getBoundingClientRect().top - pane.clientHeight / 3;
    expectedScroll.set(pane, pane.scrollTop);
  }
  if (mode === "source") return;
  let offset = 0;
  for (let i = 0; i < line; i++) {
    const next = sync.text.indexOf("\n", offset);
    if (next < 0) break;
    offset = next + 1;
  }
  const ranges = mode === "live" ? rich.scrollRanges() : Array.from(
    (mode === "split" ? splitRoot : readingRoot).querySelectorAll<HTMLElement>(":scope > [data-md-range]"),
    element => ({ element, to: Number(element.getAttribute("data-md-range")!.split(":")[1]) }),
  );
  const target = ranges.find(range => range.to > offset) ?? ranges[ranges.length - 1];
  const pane = mode === "live" ? liveSurface.container : mode === "split" ? splitSurface.container : readingSurface.container;
  if (target) {
    pane.scrollTop += target.element.getBoundingClientRect().top - pane.getBoundingClientRect().top - pane.clientHeight / 3;
    expectedScroll.set(pane, pane.scrollTop);
  }
}

for (const [id, step] of [["comparison-prev", -1], ["comparison-next", 1]] as const) {
  $(id).addEventListener("click", () => {
    if (!changes.length) return;
    changeIndex = changeIndex < 0 ? (step > 0 ? 0 : changes.length - 1) : (changeIndex + step + changes.length) % changes.length;
    const change = changes[changeIndex];
    $("comparison-count").textContent = `${changeIndex + 1}/${changes.length}`;
    revealChange(change.from);
    post({ type: "comparison-reveal", line: change.originalFrom });
  });
}

// Preview navigation is delegated once. Read-only mode never changes tasks.
for (const root of [readingRoot, splitRoot]) root.addEventListener("click", (event) => {
  const link = (event.target as HTMLElement).closest("a");
  if (!link) return;
  event.preventDefault();
  const wiki = link.getAttribute("data-wikilink");
  post(wiki ? { type: "open-wikilink", name: wiki } : { type: "open-link", href: link.getAttribute("href") || "" });
});
const previewSurface = (container: HTMLElement, root: HTMLElement): ScrollSurface => ({ container, blocks: () =>
  Array.from(root.children).flatMap(element => {
    const range = element.getAttribute("data-md-range"); if (!range) return [];
    const [from,to] = range.split(":").map(Number), rect = element.getBoundingClientRect();
    return [{key: scrollKey(sync.text.slice(from,to)), top: rect.top, height: rect.height}];
  }) });
const liveSurface: ScrollSurface = {container: $("live-wrap"), blocks: () => rich.scrollRanges().map(range => {
  const rect = range.element.getBoundingClientRect();
  return { key: scrollKey(sync.text.slice(range.from,range.to)), top: rect.top, height: rect.height };
})};
const scrollMarkdown = createMarkdown({sourceMap:true});
let scrollSourceText: string | undefined, scrollSourceRanges: {from:number;to:number;key:string}[] = [];
function sourceScrollRanges(text: string) {
  if(text === scrollSourceText) return scrollSourceRanges;
  scrollSourceText = text;
  const fm = parseFrontmatter(text), rest = fm ? text.split("\n").slice(fm.endLine).join("\n") : text;
  const offset = text.length-rest.length;
  scrollSourceRanges = offset ? [{from:0,to:offset,key:scrollKey(text.slice(0,offset))}] : [];
  for(const token of scrollMarkdown.parse(rest,{sourceOffset:offset})) {
    const range=token.attrGet("data-md-range"); if(!range)continue;
    const [from,to]=String(range).split(":").map(Number);
    scrollSourceRanges.push({from,to,key:scrollKey(text.slice(from,to))});
  }
  return scrollSourceRanges;
}
const sourceSurface: ScrollSurface = {container: source.view.scrollDOM, blocks: () => {
  const text = source.view.state.doc.toString(), blocks = [];
  for (const range of sourceScrollRanges(text)) {
    const first = source.view.lineBlockAt(range.from), last = source.view.lineBlockAt(Math.max(range.from,range.to-1));
    blocks.push({key: range.key, top: source.view.documentTop+first.top, height: last.bottom-first.top});
  }
  return blocks;
}};
const splitSurface = previewSurface($("split-preview"),splitRoot), readingSurface = previewSurface($("reading-wrap"),readingRoot);
const activeSurfaces = () => mode === "live" ? [liveSurface] : mode === "reading" ? [readingSurface] : mode === "source" ? [sourceSurface] : [sourceSurface,splitSurface];
let scrollFrame = 0;
const expectedScroll = new WeakMap<HTMLElement,number>();
const allSurfaces = [liveSurface,sourceSurface,splitSurface,readingSurface];
const scrollOffsets = { ...vscode.getState()?.scrollOffsets };
let receivedDocument = false;
let restoreFrame = 0;
function scrollPaneKey(surface: ScrollSurface): string {
  return surface === sourceSurface ? `${mode}-source` : surface.container.id;
}
function restoreScrollOffsets(): void {
  if (!activeSurfaces().some(surface => scrollOffsets[scrollPaneKey(surface)] > 0)) return;
  // Preview and CodeMirror must lay out the received document before scrolling.
  clearTimeout(previewTimer);
  refreshPreview();
  const restoreMode = mode;
  restoreFrame = requestAnimationFrame(() => {
    restoreFrame = requestAnimationFrame(() => {
      restoreFrame = 0;
      if (mode !== restoreMode) return;
      for (const surface of activeSurfaces()) {
        const top = scrollOffsets[scrollPaneKey(surface)];
        if (!Number.isFinite(top) || top < 0) continue;
        surface.container.scrollTop = top;
        expectedScroll.set(surface.container, surface.container.scrollTop);
      }
    });
  });
}
function moveSurface(surface: ScrollSurface, position: ScrollPosition): void {
  applyScroll(surface,position,top => expectedScroll.set(surface.container,top));
}
function receiveScroll(position: ScrollPosition): void {
  for (const surface of activeSurfaces()) moveSurface(surface,position);
}
for (const surface of allSurfaces) {
  const container = surface.container;
  const takeControl = () => {
    cancelAnimationFrame(restoreFrame);
    restoreFrame = 0;
    cancelScroll(container);
    expectedScroll.delete(container);
  };
  for (const event of ["wheel","pointerdown","touchstart","keydown"]) container.addEventListener(event,takeControl,{passive:true});
  container.addEventListener("scroll", () => {
    const expected = expectedScroll.get(container);
    if (!receivedDocument || restoreFrame || !activeSurfaces().includes(surface)) return;
    const key = scrollPaneKey(surface);
    if (scrollOffsets[key] !== container.scrollTop) {
      scrollOffsets[key] = container.scrollTop;
      vscode.setState({ ...vscode.getState(), scrollOffsets });
    }
    if (expected !== undefined && Math.abs(container.scrollTop-expected)<1) return;
    if(scrollFrame) cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame=0;
      const position = captureScroll(surface);
      for (const other of activeSurfaces()) if(other!==surface) moveSurface(other,position);
      post({type:"scroll-sync",position});
    });
  });
}

document.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  if (comparisonSide === "original" && ["v", "s"].includes(event.key.toLowerCase())) { event.preventDefault(); return; }
  if (!browserHost && event.key.toLowerCase() === "v" && event.shiftKey && mode === "live" && rich.editor.view.hasFocus() && !rich.composing) {
    event.preventDefault(); event.stopImmediatePropagation();
    const nonce = `plain-paste-${++plainPasteSequence}`;
    rich.bookmark(nonce); pendingPlainPastes.add(nonce); post({type:"read-clipboard-text",nonce});
    return;
  }
  if (!browserHost && event.key.toLowerCase() === "s") { event.preventDefault(); if (mode === "live" ? rich.prepareSave() : rich.flush()) sync.save(); else saveAfterComposition = true; }
  if (event.key.toLowerCase() === "f" && !event.defaultPrevented && mode !== "source" && !(mode === "split" && source.view.hasFocus)) {
    event.preventDefault(); find?.openFind();
  }
}, true);
window.addEventListener("blur", () => { rich.flush(); sync.flush(); });
function receiveMessage(message: any): void {
  if (!message || (message.proto !== undefined && message.proto !== PROTO)) return;
  if (["update", "edit-result", "save-result", "git-baseline"].includes(message.type) && rich.composing) { compositionMessages.push(message); return; }
  if (typeof message.session === "string" && message.session !== sync.session) return;
  if (message.type === "clipboard-text" && pendingPlainPastes.delete(message.nonce)) {
    rich.pastePlainText(message.nonce,mode === "live" && typeof message.text === "string" ? message.text : "");
  } else if (message.type === "scroll-sync" && message.position) {
    receiveScroll(message.position);
  } else if (message.type === "update" && typeof message.text === "string" && typeof message.version === "number") {
    rich.flush();
    sync.receive(message);
    if (!receivedDocument) {
      receivedDocument = true;
      restoreScrollOffsets();
    }
    resolveImages(liveRoot); void runMermaid(liveRoot);
    if (vscode.getState()?.recoveryDraft === sync.text) {
      $("recovery-draft")?.remove(); vscode.setState({ ...vscode.getState(), recoveryDraft: undefined });
    }
  } else if (message.type === "edit-result") {
    rich.flush();
    sync.acknowledge(message.requestId, message, !!message.conflict);
    resolveImages(liveRoot);
  } else if (message.type === "save-result") {
    rich.flush(); sync.saved(message.requestId, message, !!message.success);
  } else if (message.type === "git-baseline") {
    const side = message.side === "original" || message.side === "modified" ? message.side : null;
    if (side !== comparisonSide) {
      comparisonSide = side;
      document.body.classList.toggle("comparison-original", side === "original");
      document.body.classList.toggle("comparison-modified", side === "modified");
      rich.editor.setEditable(side !== "original", false);
      source.setReadOnly(side === "original");
      tableHover?.hide();
    }
    pairedComparison = message.paired === true;
    if (side === "original" && validMode(message.mode) && mode !== message.mode) setMode(message.mode);
    gitBase = typeof message.text === "string" ? message.text : null;
    source.setGitBaseline(gitBase, pairedComparison, side === "original");
    rich.setGitBaseline(gitBase, side === "original");
    refreshGit();
  } else if (message.type === "comparison-reveal" && Number.isSafeInteger(message.line) && message.line >= 0) {
    revealChange(message.line);
  } else if (message.type === "draft-state") {
    const draft = message.draft as LocalDraft | null;
    const local = vscode.getState()?.draft;
    if (draft && typeof draft.text === "string" && draft.text !== sync.text && (!local || draft.updatedAt >= local.updatedAt)) showRecovery(draft.text);
  } else if (message.type === "config") {
    toolbar?.close();
    document.querySelector<HTMLDialogElement>(".source-dialog")?.close();
    updateLanguage(message.language); tableHover?.refresh();
    if (find?.isOpen()) find.refresh();
    rich.editor.view.dom.setAttribute("aria-label", t("Belge düzenleyici"));
    const recovery = vscode.getState()?.recoveryDraft;
    if (recovery !== undefined) showRecovery(recovery);
    wrap = message.wordWrap !== false; numbers = message.lineNumbers !== false; theme();
    const savedMode = vscode.getState()?.mode;
    if (!configured) { setMode(validMode(savedMode) ? savedMode : validMode(message.defaultMode) ? message.defaultMode : "live"); configured = true; }
  } else if (message.type === "image-picked") {
    const done = imagePickers.get(message.nonce); imagePickers.delete(message.nonce);
    done?.(typeof message.path === "string" ? message.path : "");
  } else if (message.type === "img-saved") {
    const target = pendingImages.get(message.nonce); pendingImages.delete(message.nonce);
    if (!target || !message.path) return;
    if (target === "live") rich.insertImage(message.nonce, message.path);
    else {
      source.insertImage(message.nonce, message.path);
      if (mode === "live") rich.load(sync.text);
    }
    resolveImages(liveRoot);
  } else if (message.type === "images-restored") {
    images.clear(); for (const root of [liveRoot, readingRoot, splitRoot]) resolveImages(root);
  } else if (message.type === "img-uris") {
    for (const [path, uri] of Object.entries(message.map || {})) if (typeof uri === "string") images.set(path, uri);
    for (const root of [liveRoot, readingRoot, splitRoot]) resolveImages(root);
  } else if (message.type === "reveal-line") reveal(Math.max(0, Number(message.line) || 0));
}
if (!browserHost) window.addEventListener("message", (event) => receiveMessage(event.data));
browserHost?.connect({
  receive: receiveMessage,
  prepare: () => (mode === "live" ? rich.prepareSave() : rich.flush()) ? sync.text : undefined,
  replace: (text, version) => {
    pendingImages.clear(); imagePickers.clear(); images.clear();
    document.querySelector<HTMLDialogElement>(".source-dialog")?.close();
    sync.reset({ text, version, isDirty: false });
    source.reset(sync.text); rich.load(sync.text, true);
    setMode(mode);
    for (const surface of allSurfaces) surface.container.scrollTop = 0;
  },
  reveal,
});
new MutationObserver(theme).observe(document.body, { attributes: true, attributeFilter: ["class"] });
liveRoot.addEventListener("compositionend", () => {
  const drain = () => {
    if (rich.composing) { setTimeout(drain, 25); return; }
    rich.flush();
    for (const message of compositionMessages.splice(0)) receiveMessage(message);
    if (saveAfterComposition) { saveAfterComposition = false; sync.save(); }
  };
  setTimeout(drain, 0);
});
window.addEventListener("pagehide", (event) => { rich.flush(); sync.flush(); if (event.persisted) return; clearTimeout(gitTimer); clearTimeout(previewTimer); cancelAnimationFrame(scrollFrame); for(const surface of allSurfaces) cancelScroll(surface.container); sync.dispose(); tableHover?.destroy(); rich.destroy(); source.view.destroy(); });
theme(); setMode(mode);
const recovery = vscode.getState()?.recoveryDraft ?? vscode.getState()?.draft?.text;
if (recovery) showRecovery(recovery);
post({ type: "ready", mode });

// Eliminated from production builds; integration tests exercise real transactions.
declare const __TEST__: boolean;
if (typeof __TEST__ !== "undefined" && __TEST__) {
  (window as any).__karacaTest = { rich, source, sync, setMode };
}
