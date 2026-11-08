import { findHeadingLine } from "../shared/md-utils";
import { isEmbeddedRasterImage } from "../shared/image-data";
import { PROTO, type BrowserEditorHost, type OutMsg } from "./protocol";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $("web-status");
const labels = {
  en: { local: "Draft saved on this device", unavailable: "Browser storage unavailable. Download your work before leaving.", downloading: "Markdown downloaded", opening: "Could not open that file.", composition: "Finish typing before continuing.", replace: "Replace the current draft? Download it first if you need a copy.", image: "Use a PNG, JPG, GIF or WebP image up to 2 MB.", link: "This link needs the original folder or a full web address.", newer: "Another tab changed the saved draft. Download this copy to keep it." },
  tr: { local: "Taslak bu cihazda saklandı", unavailable: "Tarayıcı taslağı saklayamadı. Çıkmadan önce indir.", downloading: "Markdown indirildi", opening: "Dosya açılamadı.", composition: "Devam etmeden önce yazmayı bitir.", replace: "Açık taslak değiştirilsin mi? Saklamak istiyorsan önce indir.", image: "En fazla 2 MB boyutunda PNG, JPG, GIF veya WebP seç.", link: "Bu bağlantı için özgün klasör veya tam bir web adresi gerekli.", newer: "Başka bir sekme kayıtlı taslağı değiştirdi. Bu kopyayı saklamak için indir." },
};
const key = `karaca-md:editor:${location.pathname.replace(/(?:index\.html)?\/?$/, "/")}`;
const starter = "# Untitled\n\nStart writing here, or open a Markdown file.\n";
type Draft = { name: string; text: string; changed: boolean };
type Settings = { language?: "en" | "tr"; mode?: string };
function read<T>(name: string): T | undefined {
  try { return JSON.parse(localStorage.getItem(name) ?? "null") ?? undefined; }
  catch { return undefined; }
}
const stored = read<Draft>(key);
let draft: Draft = typeof stored?.text === "string" && typeof stored.name === "string"
  ? { ...stored, changed: stored.changed === true } : { name: "untitled.md", text: starter, changed: false };
let version = 1;
const settingsKey = `${key}:settings`;
const settings: Settings = read<Settings>(settingsKey) ?? {};
let language: "en" | "tr" = settings.language === "tr" ? "tr" : "en";
let backedUp = true, otherTab = false, opening = false;
let actions: Parameters<BrowserEditorHost["connect"]>[0];

function show(message: keyof typeof labels.en): void { status.textContent = labels[language][message]; }
function persistSettings(): void {
  try { localStorage.setItem(settingsKey, JSON.stringify(settings)); } catch { /* editing is still available */ }
}
function persist(): void {
  if (otherTab) { show("newer"); return; }
  try { localStorage.setItem(key, JSON.stringify(draft)); backedUp = true; show("local"); }
  catch { backedUp = false; show("unavailable"); }
}
function applyLanguage(): void {
  document.querySelectorAll<HTMLElement>("[data-web-en][data-web-tr]").forEach(node => {
    node.textContent = node.dataset[language === "tr" ? "webTr" : "webEn"]!;
  });
  send({ type: "config", language });
  show(otherTab ? "newer" : backedUp ? "local" : "unavailable");
}
function send(message: OutMsg): void { queueMicrotask(() => actions.receive({ proto: PROTO, ...message })); }
function rename(): void {
  const filename = $("web-filename");
  filename.textContent = draft.name;
  filename.title = draft.name;
  document.title = `${draft.name} · Karaca MD`;
}
function update(text: string): void {
  if (text === draft.text) return;
  draft = { ...draft, text, changed: true };
  persist();
}
function prepared(): string | undefined {
  const text = actions.prepare();
  if (text === undefined) show("composition");
  else update(text);
  return text;
}
function replace(name: string, text: string): void {
  if (prepared() === undefined) return;
  if (draft.changed && !window.confirm(labels[language].replace)) return;
  draft = { name, text: text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"), changed: false };
  actions.replace(draft.text, ++version);
  rename(); persist();
}
function download(): void {
  const text = prepared();
  if (text === undefined) return;
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = /\.md$/i.test(draft.name) ? draft.name : `${draft.name}.md`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  draft.changed = false;
  persist(); show("downloading");
}
function openLink(href: string): void {
  if (href.startsWith("#") && href.length > 1) {
    let fragment = href.slice(1);
    try { fragment = decodeURIComponent(fragment); } catch { /* allow literal percent signs */ }
    const line = findHeadingLine(prepared() ?? draft.text, fragment);
    if (line >= 0) actions.reveal(line);
    else show("link");
  } else if (/^(https?:\/\/|mailto:)/i.test(href)) window.open(href, "_blank", "noopener,noreferrer");
  else if (href) show("link");
}
const maxImageBytes = 2 * 1024 * 1024;
function pickImage(nonce: unknown): void {
  const input = document.createElement("input");
  input.type = "file"; input.accept = "image/png,image/jpeg,image/gif,image/webp"; input.hidden = true;
  const done = (path = "") => { input.remove(); send({ type: "image-picked", nonce, path }); };
  input.addEventListener("cancel", () => done(), { once: true });
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) { done(); return; }
    if (file.size > maxImageBytes) { done(); show("image"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const path = String(reader.result);
      if (isEmbeddedRasterImage(path)) done(path);
      else { done(); show("image"); }
    };
    reader.onerror = () => { done(); show("image"); };
    reader.readAsDataURL(file);
  }, { once: true });
  document.body.append(input); input.click();
}

window.__karacaBrowserHost = {
  getState: () => ({ mode: settings.mode }),
  setState: ({ mode }) => { if (settings.mode !== mode) { settings.mode = mode; persistSettings(); } },
  connect(next) { actions = next; },
  postMessage(raw) {
    const message = raw as OutMsg;
    switch (message.type) {
      case "ready":
        applyLanguage(); rename(); persist();
        send({ type: "update", text: draft.text, version, isDirty: false });
        break;
      case "draft": {
        const { text } = message.draft as { text: string };
        update(text);
        break;
      }
      case "edit":
      case "save": {
        const text = message.text as string;
        send({ type: `${message.type}-result`, requestId: message.requestId, session: message.session,
          text, version: ++version, isDirty: false, success: true });
        break;
      }
      case "open-link": openLink(String(message.href)); break;
      case "open-wikilink": show("link"); break;
      case "pick-image": pickImage(message.nonce); break;
      case "save-image": {
        const path = typeof message.dataUrl === "string" ? message.dataUrl : "";
        const maxDataLength = Math.ceil(maxImageBytes / 3) * 4 + 32;
        const valid = path.length <= maxDataLength && isEmbeddedRasterImage(path);
        if (!valid) show("image");
        send({ type: "img-saved", nonce: message.nonce, path: valid ? path : "" });
        break;
      }
      case "error": status.textContent = String(message.message); break;
    }
  },
};

const input = $<HTMLInputElement>("web-input");
$("web-open").onclick = () => { if (!opening) input.click(); };
input.onchange = async () => {
  const file = input.files?.[0];
  input.value = "";
  if (!file || opening) return;
  opening = true;
  try { replace(file.name, await file.text()); }
  catch { show("opening"); }
  finally { opening = false; }
};
$("web-new").onclick = () => { if (!opening) replace("untitled.md", ""); };
$("web-download").onclick = download;
$<HTMLSelectElement>("web-language").value = language;
$<HTMLSelectElement>("web-language").onchange = (event) => {
  language = (event.currentTarget as HTMLSelectElement).value === "tr" ? "tr" : "en";
  settings.language = language; persistSettings(); applyLanguage();
};
window.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "s") {
    event.preventDefault(); download();
  }
});
window.addEventListener("storage", event => {
  if (event.key === key || event.key === null) { otherTab = true; show("newer"); }
});
window.addEventListener("beforeunload", event => {
  if ((!backedUp || otherTab) && draft.changed) { event.preventDefault(); event.returnValue = ""; }
});

void import("./main").then(() => {
  document.querySelectorAll<HTMLButtonElement>("[data-web-action]").forEach(button => { button.disabled = false; });
  $<HTMLSelectElement>("web-language").disabled = false;
}).catch(error => { status.textContent = "The editor failed to load. Refresh to retry."; console.error(error); });
