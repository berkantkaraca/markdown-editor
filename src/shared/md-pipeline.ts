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
  computeBlocks(text: string): Block[];
}

export interface Block {
  startLine: number;
  endLine: number; // exclusive
  source: string;
  html: string;
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

export function renderWikilinksWith(md: MarkdownIt, src: string): string {
  return src.replace(/\[\[([^\]]+)\]\]/g, (m: string, inner: string) => {
    const p = parseWikilink(inner);
    if (!p) {
      return m;
    }
    return `<a data-wikilink="${escapeHtml(inner)}" href="#">${md.utils.escapeHtml(p.label)}</a>`;
  });
}

export function renderBlockHtmlWith(md: MarkdownIt, source: string): string {
  return md.render(renderWikilinksWith(md, source));
}

export function renderFullWithFmWith(md: MarkdownIt, text: string): string {
  const fm = parseFrontmatter(text);
  if (!fm) {
    return md.render(renderWikilinksWith(md, text));
  }
  const rest = text.split("\n").slice(fm.endLine).join("\n");
  return renderFrontmatterHtml(fm) + md.render(renderWikilinksWith(md, rest));
}

export function computeBlocks(md: MarkdownIt, text: string): Block[] {
  const lines = text.split("\n");
  const fm = parseFrontmatter(text);
  const fmEnd = fm ? fm.endLine : 0;
  const tokens = md.parse(text, {});
  const ranges: Array<[number, number]> = [];
  for (const tok of tokens) {
    if (tok.map && tok.level === 0 && tok.type !== "inline") {
      const [s, e] = tok.map as [number, number];
      ranges.push([s, e]);
    }
  }
  // Yalnızca GERÇEKTEN çakışan aralıklar birleşir (r[0] < last[1]).
  // Sınırı paylaşan bitişik bloklar (r[0] == last[1]) ayrı kalır; yoksa
  // başlık+paragraf gibi komşu bloklar tek div olur, kısmi seçim silinemez.
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] < last[1]) {
      last[1] = Math.max(last[1], r[1]);
    } else {
      merged.push([...r] as [number, number]);
    }
  }
  // Ön madde aralığındaki tokenları at, kısmi çakışmayı kırp
  const bodyRanges: Array<[number, number]> = [];
  for (const [s, e] of merged) {
    if (e <= fmEnd) {
      continue;
    }
    bodyRanges.push([Math.max(s, fmEnd), e]);
  }
  // Token üretmeyen boş satır aralarını da "boş blok" olarak ekle ki tıklanıp yazılabilsin
  const result: Block[] = [];
  if (fm) {
    result.push({ startLine: 0, endLine: fmEnd, source: fm.raw, html: renderFrontmatterHtml(fm) });
  }
  let cursor = fmEnd;
  const pushGap = (s: number, e: number) => {
    if (e > s) {
      const source = lines.slice(s, e).join("\n");
      // Saf boşluk satırları: her boşlukta ipucu göstermek yerine ince, tıklanabilir boşluk
      const html =
        source.trim() === ""
          ? `<div class="gap-spacer"></div>`
          : renderBlockHtmlWith(md, source);
      result.push({ startLine: s, endLine: e, source, html });
    }
  };
  for (const [s, e] of bodyRanges) {
    pushGap(cursor, s);
    const source = lines.slice(s, e).join("\n");
    result.push({ startLine: s, endLine: e, source, html: renderBlockHtmlWith(md, source) });
    cursor = e;
  }
  pushGap(cursor, lines.length);
  // Tamamen boş dosya
  if (result.length === 0) {
    result.push({ startLine: 0, endLine: 1, source: "", html: `<p class="empty-hint">Yazmak için tıklayın…</p>` });
  } else if (result.length === 1 && result[0].source.trim() === "") {
    result[0].html = `<p class="empty-hint">Yazmak için tıklayın…</p>`;
  }
  return result;
}

export function createMdPipeline(): MdPipeline {
  const md = createMarkdown();
  return {
    md,
    renderWikilinks: (src) => renderWikilinksWith(md, src),
    renderBlockHtml: (source) => renderBlockHtmlWith(md, source),
    renderFullWithFm: (text) => renderFullWithFmWith(md, text),
    computeBlocks: (text) => computeBlocks(md, text),
  };
}
