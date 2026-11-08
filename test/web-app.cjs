const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("playwright");
const { createServer } = require("../site/serve.cjs");

test("web editor opens, edits, restores and exports Markdown with an embedded image", async (t) => {
  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(file => file && fs.existsSync(file));
  const browser = await chromium.launch({ headless: true, executablePath });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", entry => { if (entry.type() === "error") errors.push(entry.text()); });
  await page.goto(url);
  await page.getByRole("link", { name: /Tarayıcıda düzenle/ }).click();
  await page.waitForURL("**/editor/");
  await page.locator("#live-root h1").waitFor();
  assert.equal(await page.locator("#pkgmark").textContent(), "paket-29");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  const picker = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open .md", exact: true }).click();
  await (await picker).setFiles({ name: "notlar.md", mimeType: "text/markdown",
    buffer: Buffer.from("# Test\n\nÖzgün metin.\n\n- [ ] Kontrol\n") });
  await page.locator("#live-root h1", { hasText: "Test" }).waitFor();
  assert.equal(await page.locator("#web-filename").textContent(), "notlar.md");
  await page.locator("#live-root p", { hasText: "Özgün metin." }).click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(" Tarayıcıda düzenlendi.");
  await page.locator("#btn-split").click();
  await page.locator("#split-root p", { hasText: "Tarayıcıda düzenlendi." }).waitFor();
  assert.match(await page.locator(".cm-content").textContent(), /# Test.*Tarayıcıda düzenlendi\./s);
  await page.reload();
  await page.locator("#split-root p", { hasText: "Tarayıcıda düzenlendi." }).waitFor();
  assert.equal(await page.locator("#web-filename").textContent(), "notlar.md");

  await page.locator("#btn-live").click();
  await page.locator("#live-root p", { hasText: "Tarayıcıda düzenlendi." }).click();
  await page.keyboard.press("End");
  await page.locator('[data-cmd="image"]').click();
  const imagePicker = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Choose file/ }).click();
  await (await imagePicker).setFiles({ name: "point.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ZkAAAAASUVORK5CYII=", "base64") });
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.locator('#live-root img[src^="data:image/png;base64,"]').waitFor();
  await page.locator("#btn-reading").click();
  await page.locator('#reading-root img[src^="data:image/png;base64,"]').waitFor();
  await page.locator("#btn-live").click();
  await page.locator('#live-root img[src^="data:image/png;base64,"]').waitFor();

  const exportEvent = page.waitForEvent("download");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+s" : "Control+s");
  const download = await exportEvent;
  assert.equal(download.suggestedFilename(), "notlar.md");
  const text = fs.readFileSync(await download.path(), "utf8");
  assert.match(text, /^# Test\n/);
  assert.match(text, /Tarayıcıda düzenlendi\./);
  assert.match(text, /!\[[^\]]*\]\(data:image\/png;base64,/);

  await page.locator("#web-language").selectOption("tr");
  await page.getByRole("button", { name: ".md indir", exact: true }).waitFor();
  await page.getByRole("button", { name: "Yeni", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#live-root .tiptap")?.textContent === "");
  assert.equal(await page.locator("#web-filename").textContent(), "untitled.md");
  assert.deepEqual(errors, []);
});
