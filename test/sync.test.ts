import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DocumentSync } from "../src/webview/document-sync";

function session() {
  const messages: any[] = [], recovered: string[] = [];
  const sync = new DocumentSync({ send: (message) => messages.push(message),
    changed: () => {}, status: () => {}, recover: (text) => recovered.push(text) });
  sync.receive({ text: "bir\niki", version: 1 });
  return { sync, messages, recovered };
}
describe("belge kayıt senkronizasyonu", () => {
  it("aynı anda yalnızca bir yazım gönderir, yeni taslağı onaydan sonra gönderir", () => {
    const { sync, messages } = session();
    sync.edit("bir!\niki"); sync.flush();
    sync.edit("bir!!\niki"); sync.flush();
    assert.equal(messages.length, 1);
    sync.acknowledge(1, { text: "bir!\niki", version: 2 });
    assert.equal(sync.text, "bir!!\niki");
    assert.equal(messages.length, 2); assert.equal(messages[1].base, 2);
  });
  it("yanlış veya eski onayı dikkate almaz", () => {
    const { sync, messages } = session();
    sync.edit("yeni"); sync.flush();
    sync.acknowledge(99, { text: "eski", version: 2 });
    assert.equal(sync.text, "yeni"); assert.equal(messages.length, 1);
    sync.acknowledge(1, { text: "yeni", version: 2 });
  });
  it("ayrık dış değişiklikleri bekleyen yerel taslakla birleştirir", () => {
    const { sync, messages } = session();
    sync.edit("bir!\niki");
    sync.receive({ text: "bir\niki!", version: 2 });
    assert.equal(sync.text, "bir!\niki!");
    assert.equal(messages[0].base, 2);
    sync.acknowledge(1, { text: sync.text, version: 3 });
  });
  it("çakışmada yerel taslağı kurtarma alanına alır, eski yazımı göndermez", () => {
    const { sync, messages, recovered } = session();
    sync.edit("yerel"); sync.flush();
    sync.acknowledge(1, { text: "dış değişiklik", version: 2 }, true);
    sync.flush();
    assert.deepEqual(recovered, ["yerel"]); assert.equal(sync.text, "dış değişiklik");
    assert.equal(messages.length, 1);
  });
  it("uçuş sırasında dış güncellemeyi onaydan önce uygulamaz", () => {
    const { sync } = session();
    sync.edit("bir!\niki"); sync.flush();
    sync.receive({ text: "bir\niki!", version: 2 });
    assert.equal(sync.text, "bir!\niki");
    sync.acknowledge(1, { text: "bir!\niki!", version: 3 });
    assert.equal(sync.text, "bir!\niki!");
  });
  it("kaydet son taslak onaylanana kadar host kaydını bekletir", () => {
    const { sync, messages } = session();
    sync.edit("ilk"); sync.flush(); sync.edit("son"); sync.save();
    assert.equal(messages.length, 1);
    sync.acknowledge(1, { text: "ilk", version: 2 });
    assert.equal(messages[1].type, "edit");
    assert.equal(messages[1].text, "son");
    sync.acknowledge(2, { text: "son", version: 3 });
    assert.equal(messages[2].type, "save");
  });

});


describe("Windows kayıt yanıtı", () => {
  it("yanıt kesilirse aynı kimlikle tekrarlar, sınırdan sonra elle devam eder", async () => {
    const messages: any[] = [], states: string[] = [], drafts: any[] = [];
    const sync = new DocumentSync({ send: m => messages.push(m), changed: () => {}, status: () => {}, recover: () => {},
      ackTimeoutMs: 5, maxRetries: 1, stateChanged: s => states.push(s), draftChanged: d => drafts.push(d) });
    try {
      sync.receive({ text: "ilk", version: 1 }); sync.edit("son"); sync.flush();
      await new Promise(resolve => setTimeout(resolve, 45));
      assert.equal(messages.length, 2); assert.deepEqual(messages[0], messages[1]); assert.equal(states.at(-1), "blocked");
      sync.retry(); assert.deepEqual(messages[2], messages[0]);
      sync.acknowledge(1, { text: "son", version: 2, isDirty: true });
      assert.equal(drafts.at(-1).text, "son");
      sync.save(); sync.saved(2, { text: "son", version: 2, isDirty: true }, false);
      assert.equal(states.at(-1), "blocked"); assert.ok(drafts.at(-1));
      sync.retry(); assert.equal(messages.at(-1).requestId, 3);
      sync.saved(3, { text: "son", version: 2, isDirty: false }, true);
      assert.equal(drafts.at(-1), null);
    } finally { sync.dispose(); }
  });
  it("yalnızca satır sonu değişen kayıt yankısı belgeyi yeniden yüklemez", () => {
    const changes: boolean[] = [], messages: any[] = [];
    const sync = new DocumentSync({ send: (message) => messages.push(message),
      changed: (_text, external) => changes.push(external), status: () => {}, recover: () => assert.fail("çakışma olmamalı") });
    sync.receive({ text: "İlk\r\n\r\nSon", version: 1 });
    changes.length = 0;
    sync.edit("Yeni\n\n<p></p>\n\nSon"); sync.flush();
    sync.receive({ text: "Yeni\r\n\r\n<p></p>\r\n\r\nSon", version: 2 });
    sync.acknowledge(messages[0].requestId, { text: "Yeni\r\n\r\n<p></p>\r\n\r\nSon", version: 2 });
    assert.deepEqual(changes, [false]);
    assert.equal(sync.text, "Yeni\n\n<p></p>\n\nSon");
  });
});
