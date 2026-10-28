const { test, before, beforeEach, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const engines = require("playwright");
const browserName = process.env.KARACA_BROWSER || "chromium";
const modifier = process.platform === "darwin" ? "Meta" : "Control";
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
let browser, server, page, address;
const errors = [];
const initial = "# Deneme\n\nBirinci paragraf.\n\nİkinci paragraf.\n\n- Bir madde\n\n- [ ] Görev\n";
before(async () => {
  const root = path.resolve(__dirname, "..");
  server = http.createServer((request, response) => {
    if (request.url === "/") {
      const html = (`<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"></head><body>${fs.readFileSync(path.join(__dirname, "../src/webview/layout.html"), "utf8")}</body></html>`)
        .replace("</head>", '<link rel="stylesheet" href="/media/style.css"><link rel="stylesheet" href="/media/katex.css"><style>body{--vscode-editor-background:#fff;--vscode-editor-foreground:#202631;--vscode-sideBar-background:#eef0f4;--vscode-font-family:Segoe UI;--vscode-font-size:13px;--vscode-editorWidget-background:#fff;--vscode-input-background:#fff;--vscode-input-foreground:#202631;--vscode-descriptionForeground:#7d8490}</style></head>')
        .replace("</body>", '<script src="/media/test-bundle.js"></script></body>');
      response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html); return;
    }
    const file = path.resolve(root, "." + decodeURIComponent(request.url.split("?")[0]));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { response.writeHead(404).end(); return; }
    response.setHeader("Content-Type", file.endsWith(".css") ? "text/css" : file.endsWith(".js") ? "application/javascript" : "application/octet-stream");
    response.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  address = `http://127.0.0.1:${server.address().port}`;
  const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean);
  const executablePath = process.env.CI ? undefined : candidates.find((candidate) => fs.existsSync(candidate));
  browser = await engines[browserName].launch({ headless: true, ...(browserName === "chromium" && executablePath ? { executablePath } : {}) });
});
beforeEach(async () => {
  errors.length = 0;
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(({ text }) => {
    let state = {}, version = 1, documentText = text;
    window.__posted = [];
    const send = (message) => window.postMessage({ proto: 1, ...message }, "*");
    window.acquireVsCodeApi = () => ({ getState: () => state, setState: (next) => { state = next; },
      postMessage: (message) => {
        window.__posted.push(message);
        if (message.type === "ready") setTimeout(() => {
          send({ type: "config", defaultMode: "live" });
          send({ type: "update", text: documentText, version, isDirty: false });
        });
        if (message.type === "edit") setTimeout(() => {
          documentText = window.__hostCRLF ? message.text.replace(/\r?\n/g, "\r\n") : message.text; version = Math.max(version, message.base) + 1;
          send({ type: "update", text: documentText, version, isDirty: true });
          send({ type: "edit-result", requestId: message.requestId, text: documentText, version, isDirty: true });
        }, 20);
      } });
  }, { text: initial });
  await page.goto(address);
  await page.locator("#live-root h1").waitFor();
});
afterEach(async () => { assert.deepEqual(errors, []); await page.close(); });
after(async () => { await browser?.close(); await new Promise((resolve) => server?.close(resolve)); });

test("gerçek klavye: paragraf birleştirme, Enter, kalın yazım, geri alma", async () => {
  const surface = page.locator("#live-root .tiptap");
  await surface.click();
  await page.evaluate(() => {
    const editor = window.__karacaTest.rich.editor;
    let pos;
    editor.state.doc.descendants((node, position) => { if (node.isText && node.text === "İkinci paragraf.") pos = position; });
    editor.commands.setTextSelection(pos);
  });
  await page.keyboard.press("Backspace");
  assert.match(await surface.innerText(), /Birinci paragraf.İkinci paragraf./);
  await page.keyboard.press("Enter");
  await page.keyboard.press(`${modifier}+b`);
  await page.keyboard.type("Kalın deneme");
  assert.equal(await surface.locator("strong").innerText(), "Kalın deneme");
  await page.keyboard.press(`${modifier}+z`);
  assert.equal(await surface.locator("strong").count(), 0);
  await page.keyboard.press(`${modifier}+Shift+z`);
  assert.equal(await surface.locator("strong").innerText(), "Kalın deneme");
});

test("pano HTML yapıştırma model üzerinden biçimli kaydedilir", async () => {
  const surface = page.locator("#live-root .tiptap");
  await surface.click();
  await page.evaluate(() => {
    const data = new DataTransfer(); data.setData("text/html", '<p>Yapıştırılan <strong>metin</strong></p>');
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: data });
    document.querySelector(".tiptap").dispatchEvent(event);
  });
  await page.waitForFunction(() => window.__posted.some((message) => message.type === "edit" && message.text.includes("**metin**")));
  assert.equal(await surface.locator("strong").innerText(), "metin");
});

test("örnek belge: tek yüzey, gerçek Mermaid render ve belge görünümü", async () => {
  const sample = fs.readFileSync(path.join(__dirname, "fixtures/editor.md"), "utf8");
  await page.evaluate((text) => window.postMessage({ proto: 1, type: "update", text, version: 100 }, "*"), sample);
  await page.locator("#live-root .mermaid svg").waitFor({ timeout: 30000 });
  assert.equal(await page.locator('#live-root [contenteditable="true"]').count(), 1);
  assert.equal(await page.locator("#live-root textarea, #live-root .block, #live-root .tablebar").count(), 0);
  await page.locator("#live-wrap").evaluate((element) => { element.scrollTop = 0; });
  fs.mkdirSync(path.join(__dirname, "../out"), { recursive: true });
  await page.screenshot({ path: path.join(__dirname, "../out/editor-paket-9.png") });
  await page.getByRole("tab", { name: "Okuma", exact: true }).click();
  await page.getByRole("tab", { name: "Canlı", exact: true }).click();
  assert.equal(await page.locator('#live-root [contenteditable="true"]').count(), 1);
});


test("canlı ve okuma: çerçevesiz alan ve görev satırları aynı ölçülerde", async () => {
  const text = "## Kontrol\n\nBir paragraf.\n\n- [ ] İlk görev\n- [x] İkinci görev\n\n- Normal madde\n- Başka madde\n\n| Ad | Değer |\n| --- | --- |\n| Ali | 3 |\n";
  await page.evaluate((text) => window.postMessage({ proto: 1, type: "update", text, version: 100 }, "*"), text);
  await page.locator("#live-root h2").waitFor();
  assert.equal(await page.locator('#live-root li[data-type="taskItem"]').count(), 2);
  const measure = (selector) => page.locator(selector).evaluate((root) => {
    const box = root.getBoundingClientRect();
    const css = getComputedStyle(root);
    const rect = (node) => { const r = node.getBoundingClientRect(); return { x: r.x - box.x, y: r.y - box.y, width: r.width, height: r.height }; };
    return { top: box.y, border: css.borderTopWidth, shadow: css.boxShadow, font: css.fontSize,
      heading: rect(root.querySelector("h2")),
      table: rect(root.querySelector("table")),
      tasks: Array.from(root.querySelectorAll('li[data-type="taskItem"]')).map((item) => ({
        box: rect(item.querySelector("input")), content: rect(item.querySelector(":scope > div")),
      })) };
  });
  const live = await measure("#live-root");
  await page.getByRole("tab", { name: "Okuma", exact: true }).click();
  const reading = await measure("#reading-root");
  assert.equal(live.border, "0px"); assert.equal(live.shadow, "none");
  assert.equal(reading.border, "0px"); assert.equal(reading.shadow, "none");
  assert.equal(live.font, reading.font);
  assert.equal(live.top, reading.top);
  for (const property of ["x", "y", "width", "height"]) {
    assert.ok(Math.abs(live.heading[property] - reading.heading[property]) < 1, `başlık ${property}`);
    assert.ok(Math.abs(live.table[property] - reading.table[property]) < 1, `tablo ${property}: ${JSON.stringify({live, reading})}`);
  }
  for (let i = 0; i < live.tasks.length; i++) {
    for (const property of ["x", "y", "height"]) {
      assert.ok(Math.abs(live.tasks[i].box[property] - reading.tasks[i].box[property]) < 1, `kutu ${property}`);
      assert.ok(Math.abs(live.tasks[i].content[property] - reading.tasks[i].content[property]) < 1, `görev metni ${property}`);
    }
    assert.ok(Math.abs(live.tasks[i].box.y - live.tasks[i].content.y) < 7, "kutu metinle aynı satırda");
  }
  await page.screenshot({ path: path.join(__dirname, "../out/reading-paket-9.png") });
  await page.getByRole("tab", { name: "Canlı", exact: true }).click();
  await page.screenshot({ path: path.join(__dirname, "../out/live-paket-9.png") });
});


test("Enter ile açılan boş paragraf Windows kayıt yankısı ve mod geçişinde kalır", async () => {
  await page.evaluate(() => {
    window.__hostCRLF = true;
    window.postMessage({ proto: 1, type: "update", text: "All your files and folders are presen\r\n\r\n## Export a file\r\n\r\nYou can export the current file.", version: 100 }, "*");
  });
  await page.locator("#live-root h2").waitFor();
  await page.locator("#live-root .tiptap").click();
  await page.evaluate(() => {
    const editor = window.__karacaTest.rich.editor;
    editor.commands.setTextSelection(1 + "All your files and folders are presen".length);
  });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);
  assert.equal(await page.locator("#live-root .tiptap > p").nth(1).textContent(), "");
  await page.getByRole("tab", { name: "Okuma", exact: true }).click();
  await page.getByRole("tab", { name: "Canlı", exact: true }).click();
  assert.equal(await page.locator("#live-root .tiptap > p").nth(1).textContent(), "");
  const saved = await page.evaluate(() => window.__karacaTest.sync.text);
  assert.ok(saved.includes("<p></p>"));
  await page.reload();
  await page.locator("#live-root h1").waitFor();
  await page.evaluate((text) => window.postMessage({ proto: 1, type: "update", text, version: 100 }, "*"), saved);
  await page.locator("#live-root h2").waitFor();
  assert.equal(await page.locator("#live-root .tiptap > p").nth(1).textContent(), "");
  await page.locator("#live-root .tiptap > p").nth(1).click();
  await page.keyboard.type("Yeni satır");
  assert.match(await page.locator("#live-root").innerText(), /Yeni satır/);
});


test("referans kod paleti Java ve TypeScript için Canlı/Okuma modlarında aynıdır", async () => {
  const java = '@RestController\n@RequestMapping("/api/v1/hello")\npublic class HelloController {\n\n    @GetMapping\n    public ResponseEntity<String> sayHello() {\n        return ResponseEntity.ok("Hello, Markdown!");\n    }\n}';
  const ts = "import * as vscode from 'vscode';\n\nexport function activate(context: vscode.ExtensionContext) {\n    let disposable = vscode.commands.registerCommand('karaca.md.editor', () => {\n        vscode.window.showInformationMessage('Karaca MD Editor aktif!');\n    });\n    context.subscriptions.push(disposable);\n}";
  const markdown = '```java\n' + java + '\n```\n\n```typescript\n' + ts + '\n```';
  await page.evaluate((text) => {
    document.body.className = "vscode-dark";
    document.body.style.setProperty("--vscode-editor-background", "#1e1e1e");
    document.body.style.setProperty("--vscode-editor-foreground", "#d4d4d4");
    window.postMessage({ proto: 1, type: "update", text, version: 100 }, "*");
  }, markdown);
  await page.locator("#live-root pre .hljs-control").first().waitFor();
  const colors = (selector) => page.locator(selector).evaluate((root) => {
    const selectors = [".hljs-meta", ".hljs-title.class_", ".hljs-title.function_", ".hljs-control", ".hljs-string", ".hljs-keyword:not(.hljs-control)", ".hljs-variable"];
    return { background: getComputedStyle(root.querySelector("pre")).backgroundColor,
      tokens: selectors.map((selector) => getComputedStyle(root.querySelector(selector)).color),
      source: Array.from(root.querySelectorAll("pre code"), (code) => code.textContent) };
  });
  const live = await colors("#live-root");
  assert.equal(live.background, "rgb(40, 40, 40)");
  assert.deepEqual(live.tokens, ["rgb(78, 201, 176)", "rgb(78, 201, 176)", "rgb(220, 220, 170)", "rgb(197, 134, 192)", "rgb(206, 145, 120)", "rgb(86, 156, 214)", "rgb(156, 220, 254)"]);
  assert.deepEqual(live.source.map((source) => source.trimEnd()), [java, ts]);
  await page.screenshot({ path: path.join(__dirname, "../out/code-live-paket-9.png") });
  await page.getByRole("tab", { name: "Okuma", exact: true }).click();
  const reading = await colors("#reading-root");
  assert.deepEqual(reading.tokens, live.tokens);
  assert.equal(reading.background, live.background);
  assert.deepEqual(reading.source.map((source) => source.trimEnd()), [java, ts]);
  await page.screenshot({ path: path.join(__dirname, "../out/code-reading-paket-9.png") });
});


test("büyük dosya performans ölçümü", { skip: !process.env.KARACA_PERF_LABEL }, async () => {
  const text = Array.from({ length: Number(process.env.KARACA_PERF_SECTIONS) || 1000 }, (_, i) => `## Bölüm ${i}\n\n${"Büyük dosyada seçilebilir ve düzenlenebilir metin. ".repeat(5)}\n\n${i % 10 === 0 ? "```typescript\nexport function sample(value: number) { return value + 1; }\n```\n\n" : ""}`).join("");
  const metrics = await page.evaluate(async (text) => {
    const app = window.__karacaTest;
    const start = performance.now();
    app.sync.receive({ text, version: 100 });
    const loaded = performance.now() - start;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const edits = [];
    for (let i = 0; i < 5; i++) {
      const now = performance.now();
      app.rich.editor.view.dispatch(app.rich.editor.state.tr.insertText("x", 1));
      edits.push(performance.now() - now);
    }
    const serializing = performance.now();
    app.rich.flush();
    return { loadedMs: loaded, editMs: edits, flushMs: performance.now() - serializing, paragraphs: app.rich.editor.state.doc.childCount };
  }, text);
  const report = { label: process.env.KARACA_PERF_LABEL, platform: process.platform, bytes: Buffer.byteLength(text), ...metrics };
  fs.mkdirSync(path.join(__dirname, "../out"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, `../out/performance-${process.env.KARACA_PERF_LABEL}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  assert.ok(metrics.loadedMs < 30000, "yükleme 30 saniyeyi aşmamalı");
  assert.ok(Math.max(...metrics.editMs) < 3000, "yazım 3 saniyeyi aşmamalı");
});


test("canlı matematik ve Mermaid pencereleri düzenler, iptal eder ve kaydeder", async () => {
  await page.getByRole("button", { name: "Matematik", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Kaynak", exact: true }).fill("$$x^3$$");
  await dialog.locator(".katex").waitFor();
  await dialog.getByRole("button", { name: "Uygula", exact: true }).click();
  await page.locator("#live-root .katex").dblclick();
  await dialog.getByRole("textbox", { name: "Kaynak", exact: true }).fill("$$y^4$$");
  await dialog.getByRole("button", { name: "Uygula", exact: true }).click();
  await page.waitForFunction(() => window.__posted.some((message) => message.type === "edit" && message.text.includes("$$y^4$$")));
  await page.getByRole("button", { name: "Diyagram", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Kaynak", exact: true }).fill("```mermaid\nflowchart LR\n    Start --> Finish\n```");
  await dialog.locator(".mermaid svg").waitFor();
  await dialog.getByRole("button", { name: "Uygula", exact: true }).click();
  await page.locator("#live-root .mermaid svg").waitFor();
  await page.locator("#live-root .mermaid").dblclick();
  assert.match(await dialog.getByRole("textbox", { name: "Kaynak", exact: true }).inputValue(), /Start --> Finish/);
  await dialog.getByRole("textbox", { name: "Kaynak", exact: true }).fill("Silinmemeli");
  await dialog.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await page.waitForFunction(() => window.__karacaTest.sync.text.includes("Start --> Finish"));
  assert.ok(!(await page.evaluate(() => window.__karacaTest.sync.text)).includes("Silinmemeli"));
});

test("araç çubuğu dar ekranda erişilebilir ve simgeler etiketlidir", async () => {
  for (const button of await page.locator('#formatbar button[data-cmd]').all()) {
    assert.ok(await button.getAttribute("aria-label"));
    assert.equal(await button.locator("svg").count(), 1);
  }
  await page.getByRole("button", { name: "Kalın", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator(":focus").getAttribute("aria-label"), "İtalik");
  await page.setViewportSize({ width: 390, height: 800 });
  assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false);
  await page.getByRole("tab", { name: "Okuma", exact: true }).click();
  await page.getByRole("tab", { name: "Canlı", exact: true }).click();
  await page.screenshot({ path: path.join(__dirname, "../out/toolbar-mobile-paket-9.png") });
});

test("IME bileşimi ve Unicode metin kayıtta tek parça korunur", { skip: browserName !== "chromium" }, async () => {
  await page.locator("#live-root .tiptap").click();
  await page.evaluate(() => window.__karacaTest.rich.editor.commands.setTextSelection(1));
  const session = await page.context().newCDPSession(page);
  await session.send("Input.imeSetComposition", { text: "にほん", selectionStart: 3, selectionEnd: 3 });
  await session.send("Input.insertText", { text: "日本語" });
  await session.send("Input.insertText", { text: " 中文 한글 Türkçe ğışüöç" });
  await page.waitForFunction(() => window.__karacaTest.sync.text.includes("日本語 中文 한글 Türkçe ğışüöç"));
  const text = await page.evaluate(() => window.__karacaTest.sync.text);
  assert.equal((text.match(/日本語/g) || []).length, 1);
  assert.ok(!text.includes("にほん"));
});


test("Unicode yazım farklı tarayıcılarda kaydedilir", async () => {
  await page.locator("#live-root .tiptap").click();
  await page.keyboard.insertText("日本語 中文 한글 Türkçe ğışüöç");
  await page.waitForFunction(() => window.__karacaTest.sync.text.includes("日本語 中文 한글 Türkçe ğışüöç"));
});
