// Markdown render hattı: DOM bağımsızdır, `npm test` ile test edilir.
// Webview (main.ts) bu fabrikadan aldığı örnekle çalışır — tek kaynak.
import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import { highlightCode } from "./code-highlight";
import katex from "katex";
import texmath from "markdown-it-texmath";
import { parseFrontmatter, renderFrontmatterHtml, parseWikilink, escapeHtml } from "./md-utils";

export interface MdPipeline {
  md: InstanceType<typeof MarkdownIt>;
  renderWikilinks(src: string): string;
  renderBlockHtml(source: string): string;
  renderFullWithFm(text: string): string;
}

export function createMarkdown(): InstanceType<typeof MarkdownIt> {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
  highlight(str: string, lang: string): string {
    const safeLang = (lang || "").trim().split(/\s+/)[0];
    const cls = safeLang ? ` class="language-${md.utils.escapeHtml(safeLang)}"` : "";
    const highlighted = highlightCode(str, safeLang);
    if (highlighted !== null) return `<pre class="hljs"><code${cls}>${highlighted}</code></pre>`;
    const esc = md.utils.escapeHtml(str);
    return `<pre class="hljs"><code${cls}>${esc}</code></pre>`;
  },
  });
  md.use(taskLists as any, { enabled: true, label: false });
  md.use(texmath as any, {
    engine: katex,
    delimiters: "dollars",
    katexOptions: { strict: false, throwOnError: false },
  });

  md.inline.ruler.before("link", "wikilink", (state, silent) => {
    if (!state.src.startsWith("[[", state.pos) || state.linkLevel > 0) return false;
    const end = state.src.indexOf("]]", state.pos + 2);
    if (end < 0) return false;
    const inner = state.src.slice(state.pos + 2, end);
    const parsed = parseWikilink(inner);
    if (!parsed || inner.includes("\n")) return false;
    if (!silent) {
      const open = state.push("link_open", "a", 1);
      open.attrs = [["data-wikilink", inner], ["href", "#"]];
      state.push("text", "", 0).content = parsed.label;
      state.push("link_close", "a", -1);
    }
    state.pos = end + 2;
    return true;
  });

  // ```mermaid blokları: kod yerine diyagram kabı üret (çizim runMermaid'de)
  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const info = (tokens[idx].info || "").trim().split(/\s+/)[0].toLowerCase();
    if (info === "mermaid") {
      const code = tokens[idx].content;
      return `<div class="mermaid" data-source="${encodeURIComponent(code)}">${md.utils.escapeHtml(code)}</div>`;
    }
    if (defaultFence) {
      return defaultFence(tokens, idx, options, env, self);
    }
    return self.renderToken(tokens, idx, options);
  };
  return md;
}

export function renderWikilinksWith(md: InstanceType<typeof MarkdownIt>, src: string): string {
  return md.renderInline(src);
}

export function renderBlockHtmlWith(md: InstanceType<typeof MarkdownIt>, source: string): string {
  return md.render(source);
}

export function renderFullWithFmWith(md: InstanceType<typeof MarkdownIt>, text: string): string {
  const fm = parseFrontmatter(text);
  if (!fm) {
    return md.render(text);
  }
  const rest = text.split("\n").slice(fm.endLine).join("\n");
  return renderFrontmatterHtml(fm) + md.render(rest);
}

export function createMdPipeline(): MdPipeline {
  const md = createMarkdown();
  return {
    md,
    renderWikilinks: (src) => renderWikilinksWith(md, src),
    renderBlockHtml: (source) => renderBlockHtmlWith(md, source),
    renderFullWithFm: (text) => renderFullWithFmWith(md, text),
  };
}
