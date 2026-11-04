import DOMPurify from "dompurify";
import { prepareTaskLists, taskCheckbox } from "./task-lists";

// Import the semantic content of a web editor, without its editing widgets,
// document provenance or scripts. This is deliberately separate from loading MD.
export function normalizeClipboardHTML(html: string): string {
  const firstTag = /^\s*(?:<!--[^]*?-->\s*)*<(td|th|tr|tbody|thead|tfoot)\b/i.exec(html)?.[1]?.toLowerCase();
  if (firstTag === "td" || firstTag === "th") html = `<table><tbody><tr>${html}</tr></tbody></table>`;
  else if (firstTag === "tr") html = `<table><tbody>${html}</tbody></table>`;
  else if (firstTag) html = `<table>${html}</table>`;
  const root = new DOMParser().parseFromString(DOMPurify.sanitize(html), "text/html").body;
  root.querySelectorAll("script,style,meta,link,button,[aria-hidden='true']").forEach(element => element.remove());
  root.querySelectorAll("*").forEach(element => {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name) || attribute.name === "data-md-range" || ["contenteditable","draggable","id"].includes(attribute.name)) element.removeAttribute(attribute.name);
    }
    if (element.getAttribute("role") === "heading") {
      const level = Math.min(6,Math.max(1,Number(element.getAttribute("aria-level")) || 2));
      const heading = document.createElement(`h${level}`);
      heading.append(...Array.from(element.childNodes)); element.replaceWith(heading);
    }
  });
  root.querySelectorAll("pre").forEach(pre => {
    const code = pre.querySelector("code");
    const language = pre.getAttribute("data-language") || code?.getAttribute("data-language") || /(?:language|brush)[-:]\s*([\w+-]+)/i.exec(code?.className || pre.className)?.[1];
    const plain = document.createElement("code");
    if (language && /^[\w+-]+$/.test(language)) plain.className = `language-${language}`;
    plain.textContent = pre.textContent || ""; pre.replaceChildren(plain);
  });
  prepareTaskLists(root);
  root.querySelectorAll('li[data-type="taskItem"]').forEach(item => taskCheckbox(item)?.remove());
  return root.innerHTML;
}

export function clipboardHasText(html: string): boolean {
  return !!new DOMParser().parseFromString(DOMPurify.sanitize(html),"text/html").body.textContent?.trim();
}
