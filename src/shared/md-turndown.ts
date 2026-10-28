import { decodeSource } from "./md-utils";
// HTML -> markdown çevirisi (tek-yüzey canlı düzenleme + kopyalama için).
// DOM bağımsız kurulum; düğümler çağrı yerinde verilir (e2e ile test edilir).
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

export function createTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
    // Plain Markdown blank lines separate paragraphs but cannot represent an
    // empty paragraph. Keep an explicit HTML paragraph so Enter survives save.
    blankReplacement: (_content, node) => node.nodeName === "P" && !node.closest("td,th")
      ? "\n\n<p></p>\n\n" : (node as HTMLElement & { isBlock?: boolean }).isBlock ? "\n\n" : "",
  });
  td.use(gfm);

  // The upstream GFM plugin emits single tildes, which our Markdown parser
  // treats as literal text. Use the standard double-delimiter spelling.
  td.addRule("karaca-strike", {
    filter: (node) => /^(DEL|S|STRIKE)$/.test(node.nodeName),
    replacement: (content) => `~~${content}~~`,
  });
  td.addRule("karaca-cell", {
    filter: ["th", "td"],
    replacement: (content, node) => {
      const el = node as HTMLElement;
      const first = el.parentElement?.firstElementChild === el;
      const text = content.trim().replace(/\n+/g, "<br>").replace(/(?<!\\)\|/g, "\\|");
      return `${first ? "| " : " "}${text} |`;
    },
  });

  // Ham korunacak etiketler (kaynakta aynen durur)
  const keepTags = [
    "details",
    "summary",
    "u",
    "span",
    "font",
    "sub",
    "sup",
    "kbd",
    "abbr",
    "small",
    "ins",
  ] as unknown as (keyof HTMLElementTagNameMap)[];
  td.keep(keepTags);

  // Kod bloğu: dil sınıfı korunur
  td.addRule("karaca-code", {
    filter: (node) => node.nodeName === "PRE",
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const code = el.querySelector("code");
      const cls = code?.getAttribute("class") || "";
      const lang = (/language-([\w+-]+)/.exec(cls) || [])[1] || "";
      const text = (code ?? el).textContent || "";
      const fence = "`".repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length + 1)));
      return `\n\n${fence}${lang}\n${text.replace(/\n$/, "")}\n${fence}\n\n`;
    },
  });

  // Çözümlenmiş görsel: özgün yolu kullan (webview URI'si dosyaya yazılmaz)
  td.addRule("karaca-img", {
    filter: "img",
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const src = el.getAttribute("data-origsrc") || el.getAttribute("src") || "";
      const alt = (el.getAttribute("alt") || "").replace(/([\\\[\]])/g, "\\$1");
      const destination = /[\s()<>]/.test(src) ? `<${src.replace(/</g, "%3C").replace(/>/g, "%3E")}>` : src;
      const title = el.getAttribute("title");
      const suffix = title ? ` "${title.replace(/([\\"])/g, "\\$1")}"` : "";
      return `![${alt}](${destination}${suffix})`;
    },
  });

  // Mermaid: kaynak geri yazılır (çizilmiş SVG değil)
  td.addRule("karaca-mermaid", {
    filter: (node) =>
      node.nodeName === "DIV" && (node as HTMLElement).classList?.contains("mermaid") === true,
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const src = decodeSource(el.dataset?.source ?? el.textContent ?? "").replace(/\n+$/, "");
      return `\n\n\`\`\`mermaid\n${src}\n\`\`\`\n\n`;
    },
  });

  // Ön madde: ham haliyle geri yazılır (düzenlenemez bloktur)
  td.addRule("karaca-frontmatter", {
    filter: (node) =>
      node.nodeName === "DIV" && (node as HTMLElement).classList?.contains("frontmatter") === true,
    replacement: (_content, node) => {
      const raw = (node as HTMLElement).dataset?.raw ?? "";
      return raw ? `\n\n${raw}\n\n` : "";
    },
  });

  // WikiLink: tam içiyle geri yazılır
  td.addRule("karaca-wiki", {
    filter: (node) =>
      node.nodeName === "A" && (node as HTMLElement).hasAttribute("data-wikilink"),
    replacement: (_content, node) => {
      const inner = (node as HTMLElement).getAttribute("data-wikilink") ?? "";
      return `[[${inner}]]`;
    },
  });

  // KaTeX: annotation'daki TeX kaynağına dönülür
  td.addRule("karaca-math", {
    filter: (node) => {
      const el = node as HTMLElement;
      if (!el.classList) {
        return false;
      }
      if (el.classList.contains("katex-display")) {
        return true;
      }
      return el.classList.contains("katex") && !el.closest?.(".katex-display");
    },
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const tex = el.querySelector("annotation")?.textContent ?? el.textContent ?? "";
      if (el.classList.contains("katex-display")) {
        return `\n\n$$${tex}$$\n\n`;
      }
      return `$${tex}$`;
    },
  });

  // Bulma vurgusu: iç metin aynen kalır
  td.addRule("karaca-mark", {
    filter: "mark",
    replacement: (content) => content,
  });

  return td;
}

