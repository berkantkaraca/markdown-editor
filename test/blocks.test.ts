import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMarkdown, computeBlocks } from "../src/shared/md-pipeline.js";

const md = createMarkdown();
const spans = (text: string) =>
  computeBlocks(md, text).map((b) => [b.startLine, b.endLine, b.source] as const);

describe("computeBlocks bölümleme", () => {
  it("bitişik başlık+paragraf ayrı blok olur (birleşme yok)", () => {
    const text = "## Başlık\nParagraf satırı";
    const bs = spans(text);
    assert.deepEqual(
      bs.map(([s, e]) => [s, e]),
      [
        [0, 1],
        [1, 2],
      ]
    );
    assert.equal(bs[0][2], "## Başlık");
    assert.equal(bs[1][2], "Paragraf satırı");
  });

  it("bitişik kod bloğu+paragraf ayrı kalır", () => {
    const text = "```js\nx();\n```\nSonraki paragraf";
    const bs = spans(text);
    assert.equal(bs[0][2], "```js\nx();\n```");
    assert.equal(bs[1][2], "Sonraki paragraf");
  });

  it("boşluklu bloklar + gap üretir", () => {
    const text = "# H\n\nParagraf\n";
    const bs = spans(text);
    // h1, boşluk gap'i, paragraf, sondaki boşluk gap'i
    assert.deepEqual(
      bs.map(([s, e]) => [s, e]),
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
      ]
    );
    assert.equal(bs[1][2], "");
  });

  it("boş dosya ipucu bloğu", () => {
    const bs = spans("");
    assert.equal(bs.length, 1);
    assert.match(bs[0][2], /^$/);
  });

  it("frontmatter ilk blok olur", () => {
    const bs = spans("---\ntitle: T\n---\n\n# H");
    assert.equal(bs[0][2], "---\ntitle: T\n---");
    assert.deepEqual([bs[0][0], bs[0][1]], [0, 3]);
    assert.ok(
      bs.some(([s, e, src]) => src === "# H" && s === 4 && e === 5),
      "başlık bloğu korunur"
    );
  });

  it("ham HTML bloğu ayrı kalır", () => {
    const text = "## T\n<details>\n<summary>X</summary>\n</details>";
    const bs = spans(text);
    assert.equal(bs[0][2], "## T");
    assert.ok(bs[1][2].includes("<details>"));
  });

  it("tablo tek bloktur", () => {
    const bs = spans("| A | B |\n| --- | --- |\n| 1 | 2 |");
    assert.equal(bs.length, 1);
    assert.deepEqual([bs[0][0], bs[0][1]], [0, 3]);
  });
});
