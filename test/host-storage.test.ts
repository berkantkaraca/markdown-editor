import { it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { RequestQueue, WriteResult } from "../src/host/request-queue";
import { DraftStore } from "../src/host/draft-store";

it("aynı kayıt isteğinin eşzamanlı ve geç tekrarları yalnızca bir kez uygulanır", async () => {
  const queue = new RequestQueue(); let count = 0;
  const request = { session: "one", requestId: 1, type: "edit" as const, text: "yeni", base: 1 };
  const snapshot = (): WriteResult => ({ text: "yeni", version: 2, isDirty: true });
  const apply = async () => { count++; await new Promise(resolve => setTimeout(resolve, 5)); return snapshot(); };
  await Promise.all([queue.execute(request, apply, snapshot), queue.execute(request, apply, snapshot)]);
  await queue.execute(request, apply, snapshot); assert.equal(count, 1);
  assert.equal((await queue.execute({ ...request, text: "farklı" }, apply, snapshot)).conflict, true);
  for (let id = 2; id < 60; id++) await queue.execute({ ...request, requestId: id }, async () => ({ ...snapshot(), text: "" }), snapshot);
  assert.equal((await queue.execute(request, apply, snapshot)).conflict, true); assert.equal(count, 1);
});

it("kayıt hatası kuyruğu durdurmaz ve başarısız sonuç bildirilir", async () => {
  const queue = new RequestQueue(), snapshot = () => ({ text: "taslak", version: 1, isDirty: true });
  const request = { session: "save", requestId: 1, type: "save" as const, text: "taslak", base: 1 };
  assert.equal((await queue.execute(request, async () => { throw Error("disk"); }, snapshot)).success, false);
  assert.equal((await queue.execute({ ...request, requestId: 2 }, async () => ({ ...snapshot(), success: true }), snapshot)).success, true);
});

it("taslak yeniden açılınca korunur; eski kayıt yeni taslağı silemez", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "karaca-drafts-"));
  try {
    const store = new DraftStore(directory), uri = "file:///C:/notes/deneme.md";
    const draft = { text: "ilk", baseText: "", baseVersion: 1, updatedAt: Date.now() };
    await Promise.all([store.write(uri, draft), store.write(uri, { ...draft, text: "son" })]);
    await store.clear(uri, "ilk");
    assert.equal((await new DraftStore(directory).read(uri))?.text, "son");
    assert.equal(await store.read(uri + "other"), null);
    assert.equal((await fs.readdir(directory)).filter(file => file.endsWith(".tmp")).length, 0);
    await store.clear(uri, "son"); assert.equal(await store.read(uri), null);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("karaca-drafts-"));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
