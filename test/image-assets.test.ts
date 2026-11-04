import { it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ImageAssets, generatedImages } from "../src/host/image-assets";

it("oluşturulan görsel kaldırılıp kaydedilince temizlenir, geri alınca yeniden açılışta bile döner", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "karaca-images-"));
  try {
    const folder = path.join(root, "project"), recovery = path.join(root, "recovery");
    await fs.mkdir(path.join(folder, "assets"), { recursive: true });
    const name = "img-20261030200056.png", file = path.join(folder, "assets", name);
    await fs.writeFile(file, "original pixels");
    const store = new ImageAssets(recovery);
    await store.cleanup(folder, [name], async () => ["![shared](assets/" + name.toUpperCase() + ")"]);
    assert.equal(await fs.readFile(file, "utf8"), "original pixels");
    await store.cleanup(folder, [name], async () => ["removed"]);
    await assert.rejects(fs.access(file));
    assert.equal(await new ImageAssets(recovery).restore(folder, `![image](assets/${name})`), true);
    assert.equal(await fs.readFile(file, "utf8"), "original pixels");
    await fs.writeFile(file, "new pixels"); await store.restore(folder, `![image](assets/${name})`);
    assert.equal(await fs.readFile(file, "utf8"), "new pixels");
    await assert.rejects(store.cleanup(folder, ["photo.png"], async () => []));
    await assert.rejects(store.cleanup(folder, ["../img-20261030200056.png"], async () => []));
    await assert.rejects(store.cleanup(folder, [name], async () => { throw Error("scan failed"); }));
    assert.equal(await fs.readFile(file, "utf8"), "new pixels");
    let checks = 0;
    await store.cleanup(folder, [name], async () => ++checks === 1 ? [] : [name]);
    assert.equal(await fs.readFile(file, "utf8"), "new pixels");
    assert.deepEqual(generatedImages("assets/yapistirilan-20261029200056.png assets/img-20261030200056-1.svg"), ["yapistirilan-20261029200056.png", "img-20261030200056-1.svg"]);
    const linked = path.join(root, "linked"), outside = path.join(root, "outside");
    await fs.mkdir(linked); await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, name), "external");
    await fs.symlink(outside, path.join(linked, "assets"), process.platform === "win32" ? "junction" : "dir");
    await store.cleanup(linked, [name], async () => []);
    assert.equal(await fs.readFile(path.join(outside, name), "utf8"), "external");
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith("karaca-images-"));
    await fs.rm(root, { recursive: true, force: true });
  }
});
