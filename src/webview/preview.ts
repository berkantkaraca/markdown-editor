import { prepareTaskLists, taskCheckbox } from "./task-lists";
import { decodeSource } from "../shared/md-utils";
import DOMPurify from "dompurify";
import { createMdPipeline } from "../shared/md-pipeline";
const { renderFullWithFm } = createMdPipeline();
export function renderPreview(root: HTMLElement, text: string): void {
  root.innerHTML = DOMPurify.sanitize(renderFullWithFm(text));
  prepareTaskLists(root);
  // Match the editor's task NodeView structure so spacing and baselines agree.
  root.querySelectorAll<HTMLLIElement>("li").forEach((item) => {
    const checkbox = taskCheckbox(item);
    if (!checkbox) return;
    checkbox.disabled = true;
    checkbox.remove();
    item.dataset.type = "taskItem";
    item.dataset.checked = String(checkbox.checked);
    item.parentElement!.dataset.type = "taskList";
    const label = document.createElement("label"); label.appendChild(checkbox);
    const content = document.createElement("div");
    content.append(...Array.from(item.childNodes));
    item.replaceChildren(label, content);
  });
  void runMermaid(root);
}
function isDarkTheme(): boolean { return document.body.classList.contains("vscode-dark"); }
function post(message: { type: string; message: string }): void { console.error(message.message); }
// ---------- Mermaid ----------
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

export async function runMermaid(root: HTMLElement) {
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
  const diagramTheme = isDarkTheme() ? "dark" : "default";
  for (const node of visible) {
    const el = node as HTMLElement;
    const src = decodeSource(el.dataset.source ?? "");
    const hit = mermaidSvgCache.get(`${diagramTheme}:${src}`);
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
      theme: diagramTheme,
      securityLevel: "strict",
    });
    await mermaid.run({ nodes: fresh.map((n) => n as HTMLElement) });
    fresh.forEach((el) => {
      el.dataset.done = "1";
      cacheMermaidSvg(`${diagramTheme}:${decodeSource(el.dataset.source ?? "")}`, el.innerHTML);
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


export function refreshDiagrams(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(".mermaid[data-done]").forEach((element) => {
    delete element.dataset.done;
    delete element.dataset.processed;
    element.classList.remove("mermaid-err");
  });
  void runMermaid(root);
}
