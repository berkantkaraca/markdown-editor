import { beforeEach, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
const { JSDOM } = require("jsdom");
const SAMPLE = "# Başlık\n\nGiriş paragrafı.\n\n- [ ] görev bir\n- [x] görev iki\n\n| Ad | Yaş |\n| --- | --- |\n| Ali | 3 |\n\nSon paragraf.\n";
const SKELETON = `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"></head><body class="vscode-dark">${fs.readFileSync(path.join(__dirname, "../../src/webview/layout.html"), "utf8")}</body></html>`;

let win: any, doc: any, app: any, posted: any[];
const pause = (ms = 350) => new Promise((resolve) => setTimeout(resolve, ms));
function send(data: any) { win.dispatchEvent(new win.MessageEvent("message", { data: { proto: 1, ...data } })); }
function receive(text: string, version = 1) { send({ type: "update", text, version, isDirty: false }); }
function edits() { return posted.filter((message) => message.type === "edit"); }
function root() { return doc.querySelector("#live-root"); }
function load(text: string) { receive(text, 2); }
function paragraphPosition(text: string) {
  let found = -1;
  app.rich.editor.state.doc.descendants((node: any, pos: number) => { if (node.isText && node.text.includes(text)) found = pos; });
  assert.ok(found >= 0, `metin bulundu: ${text}`); return found;
}
function select(text: string) {
  const position = paragraphPosition(text);
  app.rich.editor.commands.setTextSelection({ from: position, to: position + text.length });
}
function button(command: string) { return doc.querySelector(`[data-cmd="${command}"]`); }
function type(text: string) { app.rich.editor.commands.insertContent(text); }
function key(value: string, modifiers = {}) {
  return app.rich.editor.view.dom.dispatchEvent(new win.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...modifiers }));
}

beforeEach(async () => {
  posted = [];
  const dom = new JSDOM(SKELETON, { runScripts: "outside-only", pretendToBeVisual: true,
    beforeParse(window: any) {
      window.acquireVsCodeApi = () => ({ postMessage: (message: any) => posted.push(message),
        getState: () => window.__state || {}, setState: (state: any) => { window.__state = state; } });
      window.HTMLElement.prototype.scrollIntoView = function () {};
      const rect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });
      window.Range.prototype.getBoundingClientRect = rect;
      window.Range.prototype.getClientRects = () => [];
      window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    },
  });
  win = dom.window; doc = win.document;
  win.eval(fs.readFileSync(path.join(__dirname, "../../media/test-bundle.js"), "utf8"));
  app = win.__karacaTest;
  send({ type: "config", language: "tr", defaultMode: "live", wordWrap: true, lineNumbers: true });
  receive(SAMPLE);
  await pause(20);
  posted.length = 0;
});
afterEach(() => { app.rich.destroy(); app.source.view.destroy(); win.close(); });

describe("belge motoru: tek yüzey", () => {
  it("varsayılan dil İngilizce; Türkçe seçimi belgeyi değiştirmez", () => {
    send({ type: "config" });
    assert.equal(doc.documentElement.lang, "en");
    assert.equal(doc.querySelector("#btn-live").textContent, "Live");
    assert.equal(button("table-menu").getAttribute("aria-label"), "Table");
    button("table-menu").click();
    assert.equal(doc.querySelector(".table-picker").getAttribute("aria-label"), "Insert table");
    assert.equal(doc.querySelector('.table-picker [name="cols"]').labels[0].textContent, "Columns");
    send({ type: "config", language: "tr" });
    assert.equal(doc.querySelector(".table-picker"), null);
    assert.equal(button("table-menu").getAttribute("aria-label"), "Tablo");
    assert.equal(app.sync.text, SAMPLE); assert.equal(edits().length, 0);
  });
  it("tek paragraf düzenlenince diğer Markdown yazımları ve referanslar aynen kalır", () => {
    const original = "Başlık\n======\n\n*   bir\n*   iki\n\nDeğiştir.\n\n[bağ][ref]\n\n[ref]: https://example.com \"başlık\"\n";
    load(original); select("Değiştir"); type("Yeni"); app.rich.flush();
    assert.equal(app.sync.text, original.replace("Değiştir", "Yeni"));
    button("undo").click(); app.rich.flush(); assert.equal(app.sync.text, original);
  });
  it("tek düzenleme yüzeyi, blok editörü ve textarea yok", () => {
    assert.equal(root().querySelectorAll('[contenteditable="true"]').length, 1);
    assert.equal(root().querySelectorAll(".block, textarea, .tablebar").length, 0);
    assert.equal(root().querySelector("h1").textContent, "Başlık");
    assert.equal(doc.querySelector("#pkgmark").textContent, "paket-13");
  });
  it("odak kaybı kaynağı normalize etmez", async () => {
    load("Başlık\n======\n\n*   madde\n\n");
    app.rich.editor.view.dom.dispatchEvent(new win.Event("blur"));
    await pause(); assert.equal(edits().length, 0);
  });
  it("yazarken aynı düzenleme yüzeyi ve imleç korunur", () => {
    const surface = app.rich.editor.view.dom;
    select("Giriş"); type("Merhaba");
    assert.equal(app.rich.editor.view.dom, surface);
    assert.match(root().textContent, /Merhaba paragrafı/);
    assert.equal(app.rich.editor.state.selection.empty, true);
  });
  it("kalın seçimi belge işlemiyle uygular ve yeniden kaldırır", async () => {
    select("Giriş"); button("bold").click();
    assert.equal(root().querySelector("strong").textContent, "Giriş");
    assert.equal(button("bold").getAttribute("aria-pressed"), "true");
    button("bold").click(); assert.equal(root().querySelector("strong"), null);
    await pause(); assert.equal(app.sync.text, SAMPLE);
  });
  it("seçimsiz kalın komutu yer tutucu yazmaz, sonraki metni biçimler", () => {
    app.rich.editor.commands.setTextSelection(paragraphPosition("Giriş"));
    button("bold").click(); type("Yeni ");
    assert.equal(root().querySelector("strong").textContent, "Yeni ");
    assert.doesNotMatch(root().textContent, /metin/);
  });
  it("iki paragraf arasındaki seçimi tek işlemde değiştirir", () => {
    load("Birinci paragraf.\n\nİkinci paragraf.");
    app.rich.editor.commands.setTextSelection({ from: paragraphPosition("Birinci") + 4, to: paragraphPosition("İkinci") + 6 });
    type(" birleşti ");
    assert.match(root().textContent, /Biri birleşti  paragraf/);
    assert.equal(root().querySelectorAll("p").length, 1);
  });
  it("geri al ve yinele gerçek işlem geçmişini kullanır", () => {
    select("Giriş"); type("Yeni");
    button("undo").click(); assert.match(root().textContent, /Giriş paragrafı/);
    button("redo").click(); assert.match(root().textContent, /Yeni paragrafı/);
  });
  it("başlığın sonunda Enter normal paragraf oluşturur", () => {
    app.rich.editor.commands.setTextSelection(paragraphPosition("Başlık") + "Başlık".length);
    key("Enter"); type("Yeni paragraf");
    assert.equal(root().querySelector("h1").nextElementSibling.textContent, "Yeni paragraf");
    assert.equal(root().querySelector("h1").nextElementSibling.tagName, "P");
  });
  it("liste Enter ile sürer ve boş maddede listeden çıkar", () => {
    load("- Bir madde");
    app.rich.editor.commands.setTextSelection(paragraphPosition("Bir madde") + 9);
    key("Enter"); type("İki");
    assert.equal(root().querySelectorAll("li").length, 2);
    key("Enter"); key("Enter"); type("Liste dışı");
    assert.equal(root().querySelector("ul").nextElementSibling.textContent, "Liste dışı");
  });
  it("görev kutusu durumunu modelde ve kaynakta saklar", async () => {
    const checkbox = root().querySelector('input[type="checkbox"]');
    checkbox.click(); await pause();
    assert.match(edits()[0].text, /\[x\] görev bir/);
  });
  it("hücreye göre satır ekler, siler ve geri alır", () => {
    select("Ali"); button("table-menu").click();
    doc.querySelectorAll(".kmenu button")[1].click();
    assert.equal(root().querySelectorAll("tr").length, 3);
    button("undo").click(); assert.equal(root().querySelectorAll("tr").length, 2);
  });
  it("tablo ekleme seçili metnin konumunda gerçekleşir", () => {
    select("Giriş"); button("table-menu").click(); doc.querySelector('.table-picker button[type="submit"]').click();
    assert.equal(root().querySelectorAll("table").length, 2);
  });
  it("tablo boyutunu ızgaradan seçer, seçimin konumunda ekler ve geri alır", () => {
    select("Giriş"); button("table-menu").click();
    doc.querySelector('.table-grid [aria-label="4 sütun, 5 satır"]').click();
    const added = root().querySelectorAll("table")[0];
    assert.equal(added.querySelectorAll("tr").length, 5);
    assert.equal(added.querySelectorAll("th").length, 4);
    assert.equal(doc.querySelector(".table-picker"), null);
    button("undo").click(); assert.equal(root().querySelectorAll("table").length, 1);
  });
  it("kaynak modunda özel boyutlu tablo seçili metni tabloyla değiştirir", () => {
    app.setMode("source");
    app.source.view.dispatch({ selection: { anchor: 0, head: 8 } });
    button("table-menu").click();
    doc.querySelector('.table-picker [name="cols"]').value = "3";
    doc.querySelector('.table-picker [name="rows"]').value = "4";
    doc.querySelector('.table-picker button[type="submit"]').click();
    const text = app.source.view.state.doc.toString();
    assert.match(text, /\| Başlık 1 \| Başlık 2 \| Başlık 3 \|/);
    assert.equal(text.split("\n").filter((line: string) => line.startsWith("| ")).length, 8);
  });
  it("bağlantı diyaloğu seçimi geri kurar", async () => {
    select("Giriş"); button("link").click();
    const fields = doc.querySelectorAll(".kdialog input"); fields[0].value = "Site"; fields[1].value = "https://example.com";
    doc.querySelector(".kdialog").dispatchEvent(new win.Event("submit", { cancelable: true }));
    assert.equal(root().querySelector('a[href="https://example.com"]').textContent, "Site");
    await pause(); assert.match(edits()[0].text, /\[Site\]\(https:\/\/example.com\)/);
  });
});

describe("Markdown ve modlar", () => {
  it("kod boşluklarını ve iç içe fence işaretlerini korur", async () => {
    load("````md\na\n\n\n```\nb\n````\n\nSon");
    select("Son"); type("Yeni son"); await pause();
    assert.match(edits()[0].text, /````md\na\n\n\n```\nb\n````/);
  });
  it("ön madde, matematik, Mermaid ve wikilink kaynağını korur", async () => {
    load('---\ntitle: Örnek\n---\n\n$x^2$ ve [[Not|Etiket]]\n\n$$a+b$$\n\n```mermaid\ngraph TD; A-->B;\n```\n\nSon');
    select("Son"); type("Yeni son"); await pause();
    const text = edits()[0].text;
    assert.match(text, /title: Örnek/); assert.ok(text.includes("$x^2$")); assert.ok(text.includes("$$a+b$$"));
    assert.ok(text.includes("[[Not|Etiket]]")); assert.match(text, /```mermaid\ngraph TD; A-->B;/);
  });
  it("göreli görsellerin webview adresini dosyaya yazmaz", async () => {
    load("![Deneme](assets/a.png)\n\nSon");
    send({ type: "img-uris", map: { "assets/a.png": "https://webview.example/a.png" } });
    select("Son"); type("Yeni son"); await pause();
    assert.ok(edits()[0].text.includes("assets/a.png")); assert.ok(!edits()[0].text.includes("webview.example"));
  });
  it("kaynak değişikliği canlıya taşınır ve salt mod geçişi kaydetmez", async () => {
    app.setMode("source");
    app.source.view.dispatch({ changes: { from: 0, to: app.source.view.state.doc.length, insert: "## Yeni belge" } });
    app.setMode("live");
    assert.equal(root().querySelector("h2").textContent, "Yeni belge");
    await pause(); assert.equal(edits().length, 1);
  });
  it("okuma ve split modları gezinmeyi engellemez", () => {
    app.setMode("reading"); assert.equal(doc.querySelector("#formatbar").classList.contains("hidden"), false);
    assert.equal(doc.querySelector("#btn-reading").getAttribute("aria-selected"), "true");
    app.setMode("split"); assert.ok(doc.querySelector("#split-root h1"));
    app.setMode("live"); assert.ok(root().querySelector("h1"));
  });
  it("HTML içindeki çalıştırılabilir içeriği temizler", () => {
    load('<img src="a.png" onerror="alert(1)"><script>alert(1)</script>');
    assert.equal(root().querySelector("script"), null); assert.equal(root().querySelector("[onerror]"), null);
  });
  it("dış revizyon önceki belgenin geri alma geçmişini temizler", () => {
    select("Giriş"); type("Yerel");
    app.rich.flush(); app.sync.flush(); const request = edits()[0];
    send({ type: "edit-result", requestId: request.requestId, text: app.sync.text, version: 2 });
    receive("Tamamen farklı belge", 3);
    app.rich.editor.commands.undo();
    assert.equal(root().textContent, "Tamamen farklı belge");
  });
});

describe("bulma: belge süslemeleri", () => {
  it("bulma işaretleri kaynağa sızmaz ve kapatılabilir", async () => {
    doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true }));
    const input = doc.querySelector("#find-input"); input.value = "görev"; input.dispatchEvent(new win.Event("input"));
    await pause();
    assert.equal(root().querySelectorAll(".find-hit").length, 2);
    assert.match(doc.querySelector("#find-count").textContent, /1 \/ 2/);
    select("Giriş"); type("Yeni"); await pause();
    assert.ok(!edits()[0].text.includes("find-hit"));
    input.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(root().querySelectorAll(".find-hit").length, 0);
  });
  it("değiştir yalnızca görünen metni değiştirir ve geri alınabilir", async () => {
    load("**görev** ve görev");
    doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true }));
    const input = doc.querySelector("#find-input"); input.value = "görev"; input.dispatchEvent(new win.Event("input")); await pause();
    doc.querySelector("#replace-input").value = "iş";
    doc.querySelector('[data-ffind="replace-all"]').click();
    assert.equal(root().querySelector("strong").textContent, "iş"); assert.equal(root().textContent, "iş ve iş");
    app.rich.editor.commands.undo(); assert.equal(root().textContent, "görev ve görev");
  });
});


describe("aktarım regresyonları", () => {
  it("CRLF ön madde alanlarını gösterir ve başka paragraf düzenlenince korur", async () => {
    load("---\r\ntitle: Windows\r\n---\r\n\r\nSon");
    assert.match(root().querySelector(".frontmatter").textContent, /Windows/);
    select("Son"); type("Düzenlendi"); await pause();
    assert.match(edits()[0].text, /title: Windows/);
  });
  it("HTML ayrıntı ve satır içi üst simge kaynağını korur", async () => {
    load('<details><summary>Ayrıntı</summary>İçerik</details>\n\nH<sub>2</sub>O\n\nSon');
    select("Son"); type("Düzenlendi"); await pause();
    assert.ok(edits()[0].text.includes("<details>"));
    assert.ok(edits()[0].text.includes("<sub>2</sub>"));
  });
  it("arama farklı biçimler arasındaki metni birlikte bulur", () => {
    load("Bir **kalın** cümle.");
    assert.equal(app.rich.find(/Bir kalın cümle/gu), 1);
  });
  it("bekleyen görsel çapası araya yazı eklenince yeni konuma taşınır", async () => {
    select("Giriş");
    app.rich.bookmark("image-test");
    app.rich.editor.commands.setTextSelection(1);
    type("Önek ");
    app.rich.insertImage("image-test", "assets/test.png");
    await pause();
    assert.ok(edits()[0].text.includes("assets/test.png"));
    assert.match(edits()[0].text, /Önek/);
    assert.ok(!edits()[0].text.includes("Giriş"));
  });
});


describe("görev listesi aktarımı", () => {
  it("boş satırlı ve normal maddelerle karışık görevleri korur", async () => {
    load("- [ ] Bir görev\n\n- [x] İkinci görev\n\n- Normal madde\n\nSon");
    assert.equal(root().querySelectorAll('input[type="checkbox"]').length, 2);
    assert.equal(root().querySelectorAll('li[data-type="taskItem"]').length, 2);
    select("Son"); type("Bitti"); await pause();
    assert.match(edits()[0].text, /\[ \] Bir görev/);
    assert.match(edits()[0].text, /\[x\] İkinci görev/);
    assert.match(edits()[0].text, /Normal madde/);
  });
});


describe("geniş HTML aktarımı", () => {
  it("özel kapsayıcıları, stilleri, yorumları ve birleşik hücreleri korur", async () => {
    const html = '<!-- kalıcı yorum -->\n\n<article class="note"><div data-note="özel"><span style="color:red">Kırmızı</span></div><dl><dt>Terim</dt><dd>Açıklama</dd></dl></article>\n\n<table><tr><th colspan="2">Birleşik</th></tr><tr><td>A</td><td>B</td></tr></table>\n\nSon';
    load(html);
    select("Son"); type("Düzenlendi"); await pause();
    const output = edits()[0].text;
    assert.ok(output.includes('<!-- kalıcı yorum -->'), output);
    assert.ok(output.includes('<article class="note">'));
    assert.ok(output.includes('data-note="özel"'));
    assert.ok(output.includes('style="color:red"'));
    assert.ok(output.includes('<dl><dt>Terim</dt><dd>Açıklama</dd></dl>'));
    assert.ok(output.includes('colspan="2"'));
  });
});
