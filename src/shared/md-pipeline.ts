// Markdown render hattı: DOM bağımsızdır, `npm test` ile test edilir.
// Webview (main.ts) bu fabrikadan aldığı örnekle çalışır — tek kaynak.
import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import hljs from "highlight.js";
import katex from "katex";
import texmath from "markdown-it-texmath";
import { parseFrontmatter, renderFrontmatterHtml, parseWikilink, escapeHtml } from "./md-utils";

export interface MdPipeline {
  md: MarkdownIt;
  renderWikilinks(src: string): string;
  renderBlockHtml(source: string): string;
  renderFullWithFm(text: string): string;
}

export function createMarkdown(): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    highlight(str: string, lang: string): string {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang }).value}</code></pre>`;
        } catch {
          /* fallthrough */
        }
      }
      const esc = md.utils.escapeHtml(str);
      return `<pre class="hljs"><code>${esc}</code></pre>`;
    },
  });
  md.use(taskLists as any, { enabled: true, label: true, labelAfter: true });
  md.use(texmath as any, {
    engine: katex,
    delimiters: "dollars",
    katexOptions: { strict: false, throwOnError: false },
  });

  // ```mermaid blokları: kod yerine diyagram kabı üret (çizim runMermaid'de)
  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const info = (tokens[idx].info || "").trim().split(/\s+/)[0].toLowerCase();
    if (info === "mermaid") {
      const code = tokens[idx].content;
      return `<div class="mermaid" data-source="${escapeHtml(code)}">${md.utils.escapeHtml(code)}</div>`;
    }
    if (defaultFence) {
      return defaultFence(tokens, idx, options, env, self);
    }
    return self.renderToken(tokens, idx, options);
  };
  return md;
}

export function createMdPipeline(): MdPipeline {
  const md = createMarkdown();
  const renderWikilinks = (src: string): string => {
    return src.replace(/\[\[([^\]]+)\]\]/g, (m: string, inner: string) => {
      const p = parseWikilink(inner);
      if (!p) {
        return m;
      }
      return `<a data-wikilink="${escapeHtml(inner)}" href="#">${md.utils.escapeHtml(p.label)}</a>`;
    });
  };
  const renderBlockHtml = (source: string): string =>
    md.render(renderWikilinks(source));
  const renderFullWithFm = (text: string): string => {
    const fm = parseFrontmatter(text);
    if (!fm) {
      return md.render(renderWikilinks(text));
    }
    const rest = text.split("\n").slice(fm.endLine).join("\n");
    return renderFrontmatterHtml(fm) + md.render(renderWikilinks(rest));
  };
  return { md, renderWikilinks, renderBlockHtml, renderFullWithFm };
}
