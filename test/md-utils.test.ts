import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildFindRegex,  togglePrefix,
  toggleTaskLine,
  toggleHeadingLine,
  isParaLike,
  joinKeptLines,
  splitCells,
  joinCells,
  isTableBlock,
  editTable,
  parseFrontmatter,
  parseWikilink,
  fileNameForTarget,
  findHeadingLine,
  parseHeadings,
  mimeToExt,
  escapeRegExp,
  setHeadingLevel,
  listItemLineSpans,
  listEnterAction,
  mergeTexts,
} from "../src/shared/md-utils.js";

describe("togglePrefix", () => {
  it("ekler ve kaldırır", () => {
    const f = togglePrefix("- ");
    assert.equal(f("elma"), "- elma");
    assert.equal(f("- elma"), "elma");
  });
  it("boş satıra dokunmaz", () => {
    assert.equal(togglePrefix("> ")("   "), null);
  });
});

describe("toggleTaskLine", () => {
  it("düz satırı göreve çevirir", () => {
    assert.equal(toggleTaskLine("süt al"), "- [ ] süt al");
  });
  it("görevi maddeye çevirir", () => {
    assert.equal(toggleTaskLine("- [ ] süt al"), "- süt al");
    assert.equal(toggleTaskLine("- [x] süt al"), "- süt al");
  });
  it("maddeyi göreve çevirir", () => {
    assert.equal(toggleTaskLine("- süt al"), "- [ ] süt al");
  });
});

describe("toggleHeadingLine", () => {
  it("başlık ekler ve söker", () => {
    assert.equal(toggleHeadingLine("Başlık"), "## Başlık");
    assert.equal(toggleHeadingLine("## Başlık"), "Başlık");
    assert.equal(toggleHeadingLine("### Derin"), "Derin");
  });
});

describe("isParaLike", () => {
  it("düz yazı true", () => {
    assert.equal(isParaLike("merhaba dünya"), true);
  });
  it("yapısal satırlar false", () => {
    for (const s of ["# H", "- madde", "1. sıra", "> alıntı", "| a |", "```js", "    kod", "- [ ] iş"]) {
      assert.equal(isParaLike(s), false);
    }
  });
});

describe("joinKeptLines", () => {
  it("silinen boşluk sonrası paragrafları bitiştirmez", () => {
    const lines = ["A", "", "B", "", "C"];
    assert.equal(joinKeptLines(lines, [false, true, true, true, false]), "A\n\nC");
  });
  it("tablo satırlarına ayraç koymaz", () => {
    const lines = ["| a |", "| b |", "| c |"];
    assert.equal(joinKeptLines(lines, [false, true, false]), "| a |\n| c |");
  });
  it("hepsi silinirse boş döner", () => {
    assert.equal(joinKeptLines(["a", "b"], [true, true]), "");
  });
});

describe("buildFindRegex", () => {
  it("düz metni kaçırır", () => {
    const re = buildFindRegex("a.b", { caseSensitive: false, wholeWord: false, regex: false })!;
    assert.equal(re.test("a.b"), true);
    assert.equal(re.test("axb"), false);
  });
  it("büyük/küçük harf bayrağı", () => {
    const ci = buildFindRegex("elma", { caseSensitive: false, wholeWord: false, regex: false })!;
    const cs = buildFindRegex("elma", { caseSensitive: true, wholeWord: false, regex: false })!;
    assert.equal(ci.test("ELMA"), true);
    assert.equal(cs.test("ELMA"), false);
  });
  it("tüm sözcük", () => {
    const re = buildFindRegex("elma", { caseSensitive: false, wholeWord: true, regex: false })!;
    assert.equal(re.test("elma suyu"), true);
    assert.equal(re.test("elmalar"), false);
  });
  it("hatalı regex null döner", () => {
    assert.equal(buildFindRegex("([", { caseSensitive: false, wholeWord: false, regex: true }), null);
    assert.equal(buildFindRegex("", { caseSensitive: false, wholeWord: false, regex: false }), null);
  });
});

describe("tablo", () => {
  const tbl = "| Ad | Yaş |\n| --- | --- |\n| Ali | 3 |";
  it("split/join Cells", () => {
    assert.deepEqual(splitCells("| Ad | Yaş |"), [" Ad ", " Yaş "]);
    assert.equal(joinCells(["Ad", "Yaş"]), "| Ad | Yaş |");
  });
  it("isTableBlock", () => {
    assert.equal(isTableBlock(tbl), true);
    assert.equal(isTableBlock("düz yazı"), false);
    assert.equal(isTableBlock("| tek satır"), false);
  });
  it("satır ekle/sil", () => {
    const added = editTable(tbl, "add-row")!;
    assert.equal(added.split("\n").length, 4);
    assert.ok(added.includes("|  |  |"));
    const deleted = editTable(tbl, "del-row")!;
    assert.equal(deleted.split("\n").length, 2);
    assert.equal(editTable("| A |\n| --- |", "del-row"), null);
  });
  it("sütun ekle/sil", () => {
    const added = editTable(tbl, "add-col")!;
    assert.ok(added.split("\n")[0].includes("| Ad | Yaş |  |"));
    assert.ok(added.split("\n")[1].includes("| --- | --- | --- |"));
    const deleted = editTable(tbl, "del-col")!;
    assert.equal(deleted.split("\n")[0], "| Ad |");
    assert.equal(editTable("| A |\n| --- |", "del-col"), null);
  });
  it("tablo değilse null", () => {
    assert.equal(editTable("merhaba", "add-row"), null);
  });
});

describe("frontmatter", () => {
  it("geçerli bloğu çözer", () => {
    const fm = parseFrontmatter("---\ntitle: Deneme\ntags: a, b\n---\n\niçerik")!;
    assert.equal(fm.endLine, 4);
    assert.deepEqual(fm.entries, [
      ["title", "Deneme"],
      ["tags", "a, b"],
    ]);
  });
  it("geçersiz/kapanmamış null döner", () => {
    assert.equal(parseFrontmatter("düz metin"), null);
    assert.equal(parseFrontmatter("---\ntitle: x\n"), null);
  });
});

describe("wikilink", () => {
  it("varyantlar", () => {
    assert.deepEqual(parseWikilink("Not"), { target: "Not", anchor: "", label: "Not" });
    assert.deepEqual(parseWikilink("Not#Başlık"), { target: "Not", anchor: "Başlık", label: "Not#Başlık" });
    assert.deepEqual(parseWikilink("Not|Etiket"), { target: "Not", anchor: "", label: "Etiket" });
    assert.deepEqual(parseWikilink("Not#Başlık|Etiket"), {
      target: "Not",
      anchor: "Başlık",
      label: "Etiket",
    });
  });
  it("dosya adı", () => {
    assert.equal(fileNameForTarget("Not"), "Not.md");
    assert.equal(fileNameForTarget("N.md"), "N.md");
  });
});

describe("findHeadingLine", () => {
  const text = "# Giriş\n\n## Kurulum Adımı\n\nmetin";
  it("düz ve slug eşleşme", () => {
    assert.equal(findHeadingLine(text, "Kurulum Adımı"), 2);
    assert.equal(findHeadingLine(text, "kurulum-adımı"), 2);
    assert.equal(findHeadingLine(text, "Yok"), -1);
  });
});

describe("parseHeadings", () => {
  it("iç içe ağaç kurar", () => {
    const tree = parseHeadings("# A\n## B\n## C\n# D");
    assert.equal(tree.length, 2);
    assert.equal(tree[0].children.length, 2);
    assert.equal(tree[0].children[0].line, 1);
    assert.equal(tree[1].label, "D");
  });
});

describe("mimeToExt", () => {
  it("eşleme", () => {
    assert.equal(mimeToExt("image/png"), "png");
    assert.equal(mimeToExt("image/svg+xml"), "svg");
    assert.equal(mimeToExt("application/pdf"), undefined);
  });
});

describe("setHeadingLevel", () => {
  it("seviye atar ve değiştirir", () => {
    assert.equal(setHeadingLevel(1)("Başlık"), "# Başlık");
    assert.equal(setHeadingLevel(4)("## Eski"), "#### Eski");
    assert.equal(setHeadingLevel(9)("x"), "###### x");
    assert.equal(setHeadingLevel(2)("   "), null);
  });
});

describe("listItemLineSpans", () => {
  it("düz + iç içe + görev öğeleri", () => {
    const lines = [
      "1. Birinci adım",
      "2. İkinci adım",
      "   1. Alt adım A",
      "   2. Alt adım B",
      "3. Üçüncü adım",
      "",
      "- [ ] görev",
    ];
    assert.deepEqual(listItemLineSpans(lines), [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [6, 7],
    ]);
  });
  it("liste dışı satırları atlar, boşlukları budar", () => {
    const lines = ["- a", "  devam satırı", "", "- b"];
    assert.deepEqual(listItemLineSpans(lines), [
      [0, 2],
      [3, 4],
    ]);
  });
  it("öğesiz metinde boş döner", () => {
    assert.deepEqual(listItemLineSpans(["düz yazı", "devamı"]), []);
  });
});

describe("listEnterAction", () => {
  it("devam: madde, numaralı (artan), görev", () => {
    assert.deepEqual(listEnterAction("- elma"), { kind: "continue", marker: "- " });
    assert.deepEqual(listEnterAction("1. adım"), { kind: "continue", marker: "2. " });
    assert.deepEqual(listEnterAction("3) x"), { kind: "continue", marker: "4) " });
    assert.deepEqual(listEnterAction("- [x] iş"), { kind: "continue", marker: "- [ ] " });
    assert.deepEqual(listEnterAction("  - iç"), { kind: "continue", marker: "  - " });
  });
  it("boş öğe: çık veya girinti azalt", () => {
    assert.deepEqual(listEnterAction("- "), { kind: "exit" });
    assert.deepEqual(listEnterAction("-"), { kind: "exit" });
    assert.deepEqual(listEnterAction("  - "), { kind: "outdent" });
  });
  it("liste dışı ve sürüm numarası etkilenmez", () => {
    assert.deepEqual(listEnterAction("düz yazı").kind, "none");
    assert.deepEqual(listEnterAction("1.2.3").kind, "none");
  });
});

describe("mergeTexts", () => {
  it("hızlı yollar", () => {
    assert.equal(mergeTexts("a", "a", "a"), "a");
    assert.equal(mergeTexts("a", "b", "a"), "b");
    assert.equal(mergeTexts("a", "a", "b"), "b");
  });
  it("ayrık satırlar birleşir", () => {
    const base = "1\n2\n3\n4\n5";
    const disk = "1\n2x\n3\n4\n5";
    const gelen = "1\n2\n3\n4\n5x";
    assert.equal(mergeTexts(base, disk, gelen), "1\n2x\n3\n4\n5x");
  });
  it("iki uca ekleme birleşir", () => {
    assert.equal(mergeTexts("orta", "üst\norta", "orta\nalt"), "üst\norta\nalt");
  });
  it("aynı satır çakışır", () => {
    assert.equal(mergeTexts("a\nb\nc", "a\nB1\nc", "a\nB2\nc"), null);
  });
  it("aynı noktaya ekleme çakışır", () => {
    assert.equal(mergeTexts("a\nc", "a\nX\nc", "a\nY\nc"), null);
  });
});

describe("escapeRegExp", () => {  it("özel karakterleri kaçırır, önek çakışması yapmaz", () => {
    const base = "Not (1)";
    const re = new RegExp(`\\[\\[${escapeRegExp(base)}(?:[#|\\]])`);
    assert.equal(re.test("[[Not (1)]]"), true);
    assert.equal(re.test("[[Not (1)#A]]"), true);
    assert.equal(re.test("[[Not (1)lar]]"), false);
  });
});
