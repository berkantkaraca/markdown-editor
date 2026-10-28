import hljs from "highlight.js";

const controlWords = new Set(["import", "from", "as", "export", "return", "throw", "try", "catch", "finally", "if", "else", "switch", "case", "break", "continue", "for", "while", "do", "yield", "await"]);

// Shared by preview HTML and editable decorations. The lexer still owns strings,
// comments and syntax; these extra categories provide the reference palette for
// control words, annotations, class names and otherwise unclassified identifiers.
export function highlightCode(source: string, language: string): string | null {
  if (!hljs.getLanguage(language)) return null;
  let html: string;
  try { html = hljs.highlight(source, { language }).value; } catch { return null; }
  if (!/^(java|typescript|ts|javascript|js|jsx|tsx)$/i.test(language)) return html;
  html = html.replace(/<span class="hljs-keyword">([^<]+)<\/span>/g, (tag, word: string) =>
    controlWords.has(word) ? `<span class="hljs-keyword hljs-control">${word}</span>` : tag);
  html = html.replace(/<span class="hljs-meta">([^<]*)<\/span>/g, (_tag, content: string) =>
    `<span class="hljs-meta">${content.replace(/&quot;[\s\S]*?&quot;/g, (value) => `<span class="hljs-string">${value}</span>`)}</span>`);
  const stack: string[] = [];
  return html.split(/(<[^>]+>)/g).map((part) => {
    if (part.startsWith("<span")) { stack.push(/class="([^"]+)"/.exec(part)?.[1] || ""); return part; }
    if (part === "</span>") { stack.pop(); return part; }
    if (part.startsWith("<") || stack.some((scope) => scope !== "hljs-params")) return part;
    return part.replace(/&(?:#\d+|#x[\da-f]+|\w+);|\b[A-Za-z_$][\w$]*\b/g, (word, offset: number) => {
      if (word.startsWith("&")) return word;
      const after = part.slice(offset + word.length);
      const category = /^\s*\(/.test(after) ? "hljs-title function_" : /^[A-Z]/.test(word) ? "hljs-type" : "hljs-variable";
      return `<span class="${category}">${word}</span>`;
    });
  }).join("");
}
