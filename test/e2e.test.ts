/**
 * Uçtan uca webview testleri: derlenmiş media/webview.js paketi jsdom içinde
 * çalıştırılır, acquireVsCodeApi stub'lanır, gerçek DOM olaylarıyla sürülür.
 * Çalıştırma: önce `npm run compile` (güncel paket gerekir).
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const { JSDOM } = require("jsdom") as any;

const SAMPLE = `# Başlık Bir

Giriş paragrafı burada.

## İkinci Başlık

- [ ] görev bir
- [x] görev iki

| Ad | Yaş |
| --- | --- |
| Ali | 3 |

Son paragraf matematik $x^2$ ile.
`;

const SKELETON = `<!DOCTYPE html>
<html lang="tr"><head><meta charset="UTF-8" /></head>
<body class="vscode-dark">
<div id="formatbar" class="hidden">
  <button type="button" data-cmd="undo" title="Geri al">x</button>
  <button type="button" data-cmd="redo" title="Yinele">x</button>
  <button type="button" data-cmd="bold" title="Kalın">x</button>
  <button type="button" data-cmd="italic" title="İtalik">x</button>
  <button type="button" data-cmd="strike" title="x">x</button>
  <button type="button" data-cmd="heading-menu" title="x">x</button>
  <button type="button" data-cmd="bullet" title="x">x</button>
  <button type="button" data-cmd="numbered" title="x">x</button>
  <button type="button" data-cmd="task" title="x">x</button>
  <button type="button" data-cmd="quote" title="x">x</button>
  <button type="button" data-cmd="code" title="x">x</button>
  <button type="button" data-cmd="table-menu" title="x">x</button>
  <button type="button" data-cmd="link" title="x">x</button>
  <button type="button" data-cmd="image" title="x">x</button>
  <span class="spacer"></span>
  <span id="dirty"></span>
  <div class="seg" role="tablist" aria-label="Mod">
    <button id="btn-source" data-mode="source">Kaynak</button>
    <button id="btn-live" data-mode="live">Canlı</button>
    <button id="btn-split" data-mode="split">Split</button>
    <button id="btn-reading" data-mode="reading">Okuma</button>
  </div>
</div>
<div id="findbar" class="hidden">
  <div class="frow">
    <input id="find-input" type="text" />
    <button type="button" data-ffind="case">Aa</button>
    <button type="button" data-ffind="word">ab</button>
    <button type="button" data-ffind="regex">.*</button>
    <span id="find-count"></span>
    <button type="button" data-ffind="prev">x</button>
    <button type="button" data-ffind="next">x</button>
    <button type="button" data-ffind="toggle-replace">x</button>
    <button type="button" data-ffind="close">x</button>
  </div>
  <div class="frow hidden" id="replace-row">
    <input id="replace-input" type="text" />
    <button type="button" data-ffind="replace">x</button>
    <button type="button" data-ffind="replace-all">x</button>
  </div>
</div>
<div id="main-row">
  <div id="source-wrap" class="hidden"><div id="cm-host"></div></div>
  <div id="split-preview" class="hidden"><div id="split-root" class="md-body"></div></div>
</div>
<div id="live-wrap" class="hidden"><div id="live-root" class="md-body"></div></div>
<div id="reading-wrap" class="hidden"><div id="reading-root" class="md-body"></div><div id="back-to-live"></div></div>
</body></html>`;

let win: any;
let doc: any;
let posted: any[];

function send(data: any) {
  win.dispatchEvent(new win.MessageEvent("message", { data }));
}

function frames(n = 4): Promise<void> {
  return new Promise((resolve) => {
    const tick = () => {
      if (n-- <= 0) {
        resolve();
      } else {
        win.requestAnimationFrame(tick);
      }
    };
    tick();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function lastEdit(): string | undefined {
  for (let i = posted.length - 1; i >= 0; i--) {
    if (posted[i]?.type === "edit") {
      return posted[i].text;
    }
  }
  return undefined;
}

function liveBlocks(): any[] {
  return Array.from(doc.querySelectorAll("#live-root div.block"));
}

before(async () => {
  const bundlePath = path.join(__dirname, "..", "..", "media", "webview.js");
  assert.ok(fs.existsSync(bundlePath), "önce npm run compile çalışmalı");
  const bundle = fs.readFileSync(bundlePath, "utf8");
  const dom = new JSDOM(SKELETON, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    beforeParse(window: any) {
      window.__posted = [];
      posted = window.__posted;
      window.acquireVsCodeApi = () => ({
        postMessage: (m: any) => window.__posted.push(m),
        getState: () => window.__state || {},
        setState: (s: any) => {
          window.__state = s;
        },
      });
      window.HTMLElement.prototype.scrollIntoView = function () {};
      window.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    },
  });
  win = dom.window;
  doc = win.document;
  win.eval(bundle);
  send({ proto: 1, type: "config", defaultMode: "live", wordWrap: true, lineNumbers: true });
  send({ proto: 1, type: "update", text: SAMPLE, isDirty: false });
  await frames(6);
});

describe("e2e: açılış ve modlar", () => {
  it("canlı modda açılır, tek aktif sekme", () => {
    const active = doc.querySelectorAll(".seg button.active");
    assert.equal(active.length, 1);
    assert.equal(active[0].id, "btn-live");
    assert.ok(liveBlocks().length > 3);
    assert.ok(!doc.querySelector("#live-root textarea"), "başta edit kutusu yok");
  });

  it("toolbar: bilgi yok, sekmeler biçim çubuğunda", () => {
    assert.equal(doc.querySelector("#wordcount"), null);
    assert.ok(doc.querySelector("#dirty"));
    const seg = doc.querySelector("#formatbar .seg");
    assert.ok(seg, ".seg formatbar içinde");
    assert.equal(seg.querySelectorAll("button").length, 4);
  });

  it("split moduna geçilir", async () => {
    (doc.querySelector("#btn-split") as any).click();
    await frames(3);
    assert.ok((doc.querySelector("#btn-split") as any).classList.contains("active"));
    assert.ok(!(doc.querySelector("#split-preview") as any).classList.contains("hidden"));
    assert.ok((doc.querySelector("#split-root") as any).childNodes.length > 0);
    (doc.querySelector("#btn-live") as any).click();
    await frames(3);
  });
});

describe("e2e: blok düzenleme + imleç", () => {
  it("bloğa tıklayınca dikişsiz edit açılır, imleç sonda", async () => {
    const first = liveBlocks()[0] as any;
    first.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    await frames(4);
    const ta = doc.querySelector("#live-root textarea") as any;
    assert.ok(ta, "textarea açıldı");
    assert.ok(!/\n[ \t]*$/.test(ta.value), "sonda boş satır yok");
    assert.equal(ta.selectionStart, ta.value.length);
    assert.equal(ta.selectionEnd, ta.value.length);
    assert.equal(win.document.activeElement, ta);
    // kapat
    ta.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await frames(3);
    assert.equal(doc.querySelector("#live-root textarea"), null);
  });
});

describe("e2e: toplu seç-sil", () => {
  it("tüm bloklar seçilip Delete ile silinir", async () => {
    const root = doc.querySelector("#live-root") as any;
    const before = liveBlocks().length;
    assert.ok(before > 3);
    const sel = win.getSelection();
    const range = doc.createRange();
    range.selectNodeContents(root);
    sel.removeAllRanges();
    sel.addRange(range);
    posted.length = 0; // bayat edit mesajları testi yalan söylemesin
    doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    await sleep(450); // sendEdit debounce
    const text = lastEdit();
    assert.ok(text !== undefined, "edit mesajı gönderildi");
    assert.equal(text, "");
    await frames(3);
    assert.ok(doc.querySelector("#live-root .empty-hint"), "boş ipucu render edildi");
    // geri yükle
    send({ proto: 1, type: "update", text: SAMPLE, isDirty: false });
    await frames(4);
    assert.ok(liveBlocks().length === before);
  });
});

describe("e2e: toplu seç-sil (açık edit varken)", () => {
  it("önce commit'ler sonra siler", async () => {
    // A bloğunda edit aç
    let blocks = liveBlocks() as any[];
    blocks[0].dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    await frames(4);
    // Tıklama sonrası DOM yenilendi: düğümleri tazele (bayat düğümle seçim yapılmaz)
    blocks = liveBlocks() as any[];
    assert.ok(doc.querySelector("#live-root textarea"), "edit açık");
    // B-C bloklarını seç (odak TA'da kalır)
    const sel = win.getSelection();
    const range = doc.createRange();
    range.setStart(blocks[1], 0);
    range.setEnd(blocks[2], blocks[2].childNodes.length);
    sel.removeAllRanges();
    sel.addRange(range);
    posted.length = 0; // bayat edit mesajları testi yalan söylemesin
    (doc.querySelector("#live-root textarea") as any).dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "Delete", bubbles: true })
    );
    await sleep(450);
    const text = lastEdit();
    assert.ok(text !== undefined, "edit mesajı gönderildi");
    assert.ok(!text!.includes("Giriş paragrafı"), "seçili bloklar silindi");
    await frames(3);
  });
});

describe("e2e: kısmi seçim + Delete", () => {
  it("çapa bloğunu düzenlemeye açar", async () => {
    send({ proto: 1, type: "update", text: SAMPLE, isDirty: false });
    await frames(4);
    const h1 = doc.querySelector("#live-root h1") as any;
    const sel = win.getSelection();
    const range = doc.createRange();
    range.setStart(h1.firstChild, 0);
    range.setEnd(h1.firstChild, 3);
    sel.removeAllRanges();
    sel.addRange(range);
    doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    await frames(4);
    assert.ok(doc.querySelector("#live-root textarea"), "düzenleme açıldı");
  });
});

describe("e2e: biçim düğmesi canlıda", () => {
  it("B seçili metni kalın yapar", async () => {
    const ta = doc.querySelector("#live-root textarea") as any;
    assert.ok(ta, "edit açık (h1 bloğu)");
    ta.selectionStart = 2;
    ta.selectionEnd = 8; // "Başlık"
    (doc.querySelector('button[data-cmd="bold"]') as any).click();
    await frames(2);
    assert.equal(ta.value, "# **Başlık** Bir");
    ta.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await frames(3);
  });
});
describe("e2e: tablo menüsü", () => {
  it("boş blokta menüden tablo eklenir (150ms yarışını atlatır)", async () => {
    const gap = doc.querySelector("#live-root .gap-spacer")?.parentElement as any;
    assert.ok(gap, "boş blok var");
    gap.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    await frames(4);
    let ta = doc.querySelector("#live-root textarea") as any;
    assert.ok(ta, "boş blok editi açıldı");
    (doc.querySelector('button[data-cmd="table-menu"]') as any).click();
    await frames(2);
    assert.ok(doc.querySelector(".kmenu"), "menü açıldı");
    await sleep(300); // eski kodda blur-commit bu pencerede kutuyu öldürürdü
    ta = doc.querySelector("#live-root textarea") as any;
    assert.ok(ta, "menü açıkken edit kutusu yaşıyor");
    const items = Array.from(doc.querySelectorAll(".kmenu button")) as any[];
    (items[0] as any).click(); // Tablo Ekle
    await frames(2);
    ta = doc.querySelector("#live-root textarea") as any;
    assert.ok(ta && ta.value.includes("| Başlık 1"), "tablo eklendi: " + (ta?.value ?? "<yok>"));
    ta.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await frames(3);
  });
});

describe("e2e: markdown kopyalama", () => {
  it("başlık bloğu kaynak olarak kopyalanır", async () => {
    send({ proto: 1, type: "update", text: SAMPLE, isDirty: false });
    await frames(4);
    const h1 = doc.querySelector("#live-root h1") as any;
    assert.ok(h1, "h1 render edildi");
    const sel = win.getSelection();
    const range = doc.createRange();
    range.selectNodeContents(h1);
    sel.removeAllRanges();
    sel.addRange(range);
    const dt: any = { data: {} as any, setData(k: string, v: string) { this.data[k] = v; } };
    const ev = new win.Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clipboardData", { value: dt });
    (h1 as any).dispatchEvent(ev);
    assert.ok(dt.data["text/plain"] !== undefined, "pano yazıldı");
    assert.match(dt.data["text/plain"], /^# Başlık Bir$/);
  });
});

describe("e2e: bulma çubuğu", () => {
  it("Ctrl+F canlıda çubuğu açar, vurgular", async () => {
    doc.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true })
    );
    await frames(2);
    assert.ok(!(doc.querySelector("#findbar") as any).classList.contains("hidden"));
    const input = doc.querySelector("#find-input") as any;
    input.value = "görev";
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
    await sleep(300);
    const marks = doc.querySelectorAll("mark.find-hit");
    assert.ok(marks.length >= 2, `vurgu var (${marks.length})`);
    assert.match((doc.querySelector("#find-count") as any).textContent, /1 \/ \d+/);
    input.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await frames(2);
    assert.ok((doc.querySelector("#findbar") as any).classList.contains("hidden"));
  });
});
