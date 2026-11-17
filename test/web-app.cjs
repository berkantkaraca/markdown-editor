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
  assert.equal(await page.locator("#pkgmark").textContent(), "36");
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
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 48;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#4da3ff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL().split(",")[1];
  });
  await page.getByRole("button", { name: /Choose file/ }).click();
  await (await imagePicker).setFiles({ name: "point.png", mimeType: "image/png",
    buffer: Buffer.from(png, "base64") });
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  const liveImage = page.locator('#live-root img[src^="data:image/png;base64,"]');
  const preview = page.getByRole("dialog", { name: "Image preview" });
  await liveImage.click();
  await preview.waitFor();
  const previewImage = preview.locator("img");
  await previewImage.waitFor();
  assert.equal(await previewImage.getAttribute("src"), await liveImage.getAttribute("src"));
  const fitWidth = (await previewImage.boundingBox()).width;
  assert.ok(fitWidth > (await liveImage.boundingBox()).width);
  const zoomIn = preview.getByRole("button", { name: "Zoom in", exact: true });
  const zoomOut = preview.getByRole("button", { name: "Zoom out", exact: true });
  const fit = preview.getByRole("button", { name: /Fit image to view/ });
  const imageView = preview.getByRole("region", { name: "Image view" });
  assert.equal(await zoomOut.isDisabled(), true);
  await zoomIn.press("Space");
  assert.equal(await fit.textContent(), "125%");
  assert.ok((await previewImage.boundingBox()).width > fitWidth);
  const area = await imageView.boundingBox();
  const x = area.x + area.width / 2;
  const y = area.y + area.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -100);
  await preview.getByRole("button", { name: /Fit image to view.*150%/ }).waitFor();
  const scrollLeft = await imageView.evaluate(node => node.scrollLeft);
  await page.mouse.down();
  await page.mouse.move(x - 36, y, { steps: 3 });
  await page.mouse.up();
  assert.ok(await imageView.evaluate(node => node.scrollLeft) > scrollLeft);
  await zoomOut.click();
  assert.equal(await fit.textContent(), "125%");
  await fit.click();
  assert.equal(await fit.textContent(), "100%");
  assert.equal(await imageView.evaluate(node => node.scrollLeft), 0);
  assert.equal((await previewImage.boundingBox()).width, fitWidth);
  await zoomIn.click();
  await page.keyboard.press("Escape");
  await preview.waitFor({ state: "hidden" });

  await page.locator("#btn-reading").click();
  const readingImage = page.locator('#reading-root img[src^="data:image/png;base64,"]');
  await readingImage.focus();
  await page.keyboard.press("Enter");
  await preview.waitFor();
  assert.equal(await fit.textContent(), "100%");
  await preview.getByRole("button", { name: "Close" }).click();
  await preview.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement === document.querySelector('#reading-root img[src^="data:image/png;base64,"]'));

  await page.locator("#btn-split").click();
  await page.locator('#split-root img[src^="data:image/png;base64,"]').click();
  await preview.waitFor();
  await page.mouse.click(1, 1);
  await preview.waitFor({ state: "hidden" });
  await page.locator("#btn-live").click();
  await liveImage.waitFor();

  const exportEvent = page.waitForEvent("download");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+s" : "Control+s");
  const download = await exportEvent;
  assert.equal(download.suggestedFilename(), "notlar.md");
  const text = fs.readFileSync(await download.path(), "utf8");
  assert.match(text, /^# Test\n/);
  assert.match(text, /Tarayıcıda düzenlendi\./);
  assert.match(text, /!\[[^\]]*\]\(data:image\/png;base64,/);

  const settings = page.locator("#editor-settings");
  await settings.locator("summary").click();
  await settings.locator('[data-editor-preference="language"]').selectOption("tr");
  await page.getByRole("button", { name: ".md indir", exact: true }).waitFor();
  await settings.locator('[data-editor-preference="defaultMode"]').selectOption("source");
  await settings.locator('[data-editor-preference="lineNumbers"]').uncheck();
  await settings.locator('[data-editor-preference="wordWrap"]').uncheck();
  await page.reload();
  await page.getByRole("button", { name: ".md indir", exact: true }).waitFor();
  await page.locator(".cm-content").waitFor();
  assert.equal(await page.locator(".cm-lineNumbers").count(), 0);
  assert.equal(await page.locator(".cm-content").evaluate(node => getComputedStyle(node).whiteSpace), "pre");
  await page.locator("#btn-live").click();
  await page.getByRole("button", { name: "Yeni", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#live-root .tiptap")?.textContent === "");
  assert.equal(await page.locator("#web-filename").textContent(), "untitled.md");
  assert.deepEqual(errors, []);
});

test("a host form loads and submits Markdown through the embedded editor", async (t) => {
  const http = require("node:http");
  const initial = "# Eski içerik\n\n**Var olan metin.**\n\n\u003c/script>\n";
  const escaped = initial.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  const assets = createServer();
  const submissions = [];
  const server = http.createServer(async (req, res) => {
    if (req.url !== "/form") { assets.emit("request", req, res); return; }
    if (req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      submissions.push(new URLSearchParams(body).get("FullDescription"));
      res.writeHead(303, { Location: "/form" }).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(`<!doctype html>
      <form method="post" action="/form">
        <div data-karaca-editor>
          <div data-karaca-fallback><textarea name="FullDescription">${escaped}</textarea></div>
          <iframe title="Karaca MD" data-src="/editor/index.html?embed=1&amp;lang=tr" hidden></iframe>
          <p role="status" hidden>Kaydedilemedi.</p>
        </div>
        <button type="submit">Kaydet</button>
      </form>
      <script src="/assets/form-editor.js" defer></script>`);
  });
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(file => file && fs.existsSync(file));
  const browser = await chromium.launch({ headless: true, executablePath });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const url = `http://127.0.0.1:${server.address().port}/form`;
  await page.goto(url);
  const frame = page.frameLocator("iframe");
  await frame.getByRole("heading", { name: "Eski içerik" }).waitFor();
  assert.equal(await page.locator("textarea").isVisible(), false);
  assert.equal(await frame.locator("#web-download").isVisible(), false);
  const save = async () => {
    const response = page.waitForResponse(res => res.url() === url && res.request().method() === "POST");
    await page.getByRole("button", { name: "Kaydet" }).click();
    await response;
  };
  await save();
  assert.equal(submissions[0], initial.replaceAll("\n", "\r\n"));

  await frame.getByRole("heading", { name: "Eski içerik" }).waitFor();
  await frame.getByRole("heading", { name: "Eski içerik" }).click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(" düzenlendi");
  await save();
  assert.match(submissions[1], /^# Eski içerik düzenlendi\r?\n/);
  assert.match(submissions[1], /\*\*Var olan metin\.\*\*/);
  assert.equal(await page.evaluate(() => localStorage.length), 0);
});
