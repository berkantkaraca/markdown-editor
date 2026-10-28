import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTurndown } from "../src/shared/md-turndown";
import { createMdPipeline } from "../src/shared/md-pipeline";
const { JSDOM } = require("jsdom");

function roundtrip(html: string): { markdown: string; rendered: string } {
  const dom = new JSDOM("");
  try {
    const root = dom.window.document.createElement("div"); root.innerHTML = html;
    const markdown = createTurndown().turndown(root);
    return { markdown, rendered: createMdPipeline().renderFullWithFm(markdown) };
  } finally { dom.window.close(); }
}

describe("Markdown serileştirme", () => {
  it("üstü çizili yazım tekrar açılınca biçimini korur", () => {
    const { markdown, rendered } = roundtrip("<p><s>Silinen</s> metin</p>");
    assert.equal(markdown, "~~Silinen~~ metin"); assert.match(rendered, /<s>Silinen<\/s>/);
  });
  it("hücre içindeki pipe yeni sütun oluşturmaz", () => {
    const { markdown, rendered } = roundtrip("<table><tr><th>Başlık</th></tr><tr><td>A | B</td></tr></table>");
    assert.ok(markdown.includes("A \\| B"));
    assert.equal((rendered.match(/<td>/g) || []).length, 1);
  });
  it("görselin boşluklu yolunu, açıklamasını ve başlığını korur", () => {
    const { markdown, rendered } = roundtrip('<p><img src="assets/a (1).png" alt="Bir [görsel]" title="Açıklama"></p>');
    assert.ok(markdown.includes("<assets/a (1).png>"));
    assert.ok(rendered.includes('alt="Bir [görsel]"'));
    assert.ok(rendered.includes('title="Açıklama"'));
  });
});


describe("boş paragraf aktarımı", () => {
  it("ardışık boş paragraflar yeniden açıldığında kaybolmaz", () => {
    const { markdown, rendered } = roundtrip("<p>presen</p><p></p><p></p><h2>Export a file</h2>");
    assert.equal((markdown.match(/<p><\/p>/g) || []).length, 2);
    assert.equal((rendered.match(/<p><\/p>/g) || []).length, 2);
  });
  it("boş tablo hücrelerine paragraf işareti eklemez", () => {
    const { markdown } = roundtrip("<table><tr><th>Başlık</th></tr><tr><td><p></p></td></tr></table>");
    assert.ok(!markdown.includes("<p>"));
  });
});
