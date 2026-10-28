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

export function createMarkdown(config: { sourceMap?: boolean } = {}): InstanceType<typeof MarkdownIt> {
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

  if (config.sourceMap) md.core.ruler.after("block", "source-ranges", (state) => {
    const offsets = [0];
    for (let i = 0; i < state.src.length; i++) if (state.src[i] === "\n") offsets.push(i + 1);
    const base = Number(state.env.sourceOffset || 0);
    for (const token of state.tokens) {
      if (token.level !== 0 || !token.map || token.nesting === -1 || token.type === "inline") continue;
      const from = offsets[token.map[0]] ?? state.src.length;
      const to = offsets[token.map[1]] ?? state.src.length;
      token.attrSet("data-md-range", `${base + from}:${base + to}`);
    }
  });
  const annotate = (html: string, range: string | number | null) => range
    ? html.replace(/^(\s*<[a-z][\w-]*)/i, `$1 data-md-range="${range}"`) : html;

  // ```mermaid blokları: kod yerine diyagram kabı üret (çizim runMermaid'de)
  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const info = (tokens[idx].info || "").trim().split(/\s+/)[0].toLowerCase();
    if (info === "mermaid") {
      const code = tokens[idx].content;
      return annotate(`<div class="mermaid" data-source="${encodeURIComponent(code)}">${md.utils.escapeHtml(code)}</div>`, tokens[idx].attrGet("data-md-range"));
    }
    if (defaultFence) {
      return annotate(defaultFence(tokens, idx, options, env, self), tokens[idx].attrGet("data-md-range"));
    }
    return self.renderToken(tokens, idx, options);
  };
  if (config.sourceMap) {
    for (const rule of ["math_block", "math_block_eqno", "code_block", "html_block"]) {
      const render = md.renderer.rules[rule];
      if (!render) continue;
      md.renderer.rules[rule] = (tokens, index, options, env, self) => {
        const html = render(tokens, index, options, env, self);
        const range = tokens[index].attrGet("data-md-range");
        if (rule === "html_block" && range && /^\s*<!--/.test(html)) {
          return `<div data-md-range="${range}" data-md-source="${encodeURIComponent(tokens[index].content)}">${html}</div>`;
        }
        return annotate(html, range);
      };
    }
  }
  return md;
}

export function renderWikilinksWith(md: InstanceType<typeof MarkdownIt>, src: string): string {
  return md.renderInline(src);
}

export function renderBlockHtmlWith(md: InstanceType<typeof MarkdownIt>, source: string): string {
  return md.render(source);
}

export function renderFullWithFmWith(md: InstanceType<typeof MarkdownIt>, text: string, sourceMap = false): string {
  const fm = parseFrontmatter(text);
  if (!fm) {
    return md.render(text);
  }
  const rest = text.split("\n").slice(fm.endLine).join("\n");
    const offset = text.length - rest.length;
  const frontmatter = sourceMap ? renderFrontmatterHtml(fm).replace("<div ", `<div data-md-range="0:${offset}" `) : renderFrontmatterHtml(fm);
  return frontmatter + md.render(rest, { sourceOffset: offset });
}

export function createMdPipeline(config: { sourceMap?: boolean } = {}): MdPipeline {
  const md = createMarkdown(config);
  return {
    md,
    renderWikilinks: (src) => renderWikilinksWith(md, src),
    renderBlockHtml: (source) => renderBlockHtmlWith(md, source),
    renderFullWithFm: (text) => renderFullWithFmWith(md, text, config.sourceMap),
  };
}
