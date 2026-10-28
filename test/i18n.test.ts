import { it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { english, translate } from "../src/shared/i18n";

it("varsayılan İngilizce, isteğe bağlı Türkçe ve güvenli metin geri dönüşü", () => {
  assert.equal(translate("Tablo ekle"), "Insert table");
  assert.equal(translate("Tablo ekle", "tr"), "Tablo ekle");
  assert.equal(translate("unregistered message"), "unregistered message");
  for (const [key, value] of Object.entries(english)) { assert.ok(key); assert.ok(value); }
});

it("manifest yerelleştirme anahtarları iki dilde de mevcut; ikon paketlenebilir PNG", () => {
  const root = path.resolve(__dirname, "../..");
  const manifest = fs.readFileSync(path.join(root, "package.json"), "utf8");
  const pkg = JSON.parse(manifest);
  for (const file of ["package.nls.json", "package.nls.tr.json"]) {
    const messages = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
    for (const match of manifest.matchAll(/%([^%]+)%/g)) assert.ok(messages[match[1]], `${file}: ${match[1]}`);
  }
  assert.equal(pkg.publisher, "berkantkaraca"); assert.equal(pkg.contributes.configuration.properties["karacaMd.language"].default, "en");
  const png = fs.readFileSync(path.join(root, pkg.icon));
  assert.equal(png.subarray(1, 4).toString(), "PNG"); assert.equal(png.readUInt32BE(16), 256); assert.equal(png.readUInt32BE(20), 256);
});
