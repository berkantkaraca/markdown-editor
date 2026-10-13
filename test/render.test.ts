import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMdPipeline } from "../src/shared/md-pipeline.js";

const pipe = createMdPipeline();

describe("render hattı", () => {
  it("mermaid fence diyagram kabı üretir", () => {
    const html = pipe.renderBlockHtml("```mermaid\ngraph TD;A-->B;\n```");
    assert.match(html, /div class="mermaid"/);
    assert.match(html, /data-source="graph TD;A--&gt;B;\n"/);
  });
  it("js fence highlight'lı pre üretir", () => {
    const html = pipe.renderBlockHtml("```js\nconst a = 1;\n```");
    assert.match(html, /<pre class="hljs">/);
    assert.match(html, /hljs-/);
  });
  it("bilinmeyen dil güvenli düşer", () => {
    const html = pipe.renderBlockHtml("```zzbilinmeyen\nx < y\n```");
    assert.match(html, /<pre class="hljs">/);
    assert.match(html, /x &lt; y/);
  });
  it("matematik katex üretir", () => {
    const inl = pipe.renderBlockHtml("Euler $e^{i\\pi}+1=0$ budur.");
    assert.match(inl, /class="katex"/);
    const disp = pipe.renderBlockHtml("$$\\frac{1}{2}$$");
    assert.match(disp, /katex-display/);
  });
  it("dolarlı düz metni bozmaz", () => {
    const html = pipe.renderBlockHtml("Fiyat 5 dolar ve 10 dolar.");
    assert.doesNotMatch(html, /class="katex"/);
  });
  it("wikilink etiketi", () => {
    const html = pipe.renderWikilinks("bak [[Not#Baş|Etiket]] buraya");
    assert.match(html, /data-wikilink="Not#Baş\|Etiket"/);
    assert.match(html, />Etiket<\//);
  });
  it("frontmatter + başlık", () => {
    const full = pipe.renderFullWithFm("---\ntitle: T\n---\n\n# Merhaba");
    assert.match(full, /frontmatter/);
    assert.match(full, />T</);
    assert.match(full, /<h1>Merhaba<\/h1>/);
  });
  it("görev listesi checkbox üretir", () => {
    assert.match(pipe.renderBlockHtml("- [ ] iş"), /checkbox/);
  });
});
