import { translate, type Language } from "../shared/i18n";

let language: Language = "en";
export const t = (message: string): string => translate(message, language);
export const setLanguage = (value: unknown): void => { language = value === "tr" ? "tr" : "en"; };
const originalText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();

// Only call on application chrome, never on the user's document.
export function localizeChrome(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (!originalText.has(text)) originalText.set(text, text.data);
    text.data = t(originalText.get(text)!);
  }
  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    let originals = originalAttributes.get(element);
    if (!originals) { originals = new Map(); originalAttributes.set(element, originals); }
    for (const attr of ["title", "aria-label", "placeholder"]) {
      if (!originals.has(attr) && element.hasAttribute(attr)) originals.set(attr, element.getAttribute(attr)!);
      if (originals.has(attr)) element.setAttribute(attr, t(originals.get(attr)!));
    }
  }
}
