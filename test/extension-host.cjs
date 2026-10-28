const { test } = require("node:test");
const { _electron: electron } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
test("VS Code Extension Host: aç, düzenle, kaydet ve yeniden aç", { timeout: 120000 }, async () => {
  const root = path.resolve(__dirname, "..");
  const directory = path.join(root, "out/extension-host");
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "roundtrip.md");
  fs.writeFileSync(file, "# Extension Host\n\nKaydetme denemesi.\n");
  const candidates = [process.env.VSCODE_EXECUTABLE,
    path.join(process.env.LOCALAPPDATA || "", "Programs/Microsoft VS Code/Code.exe"),
    "/Applications/Visual Studio Code.app/Contents/MacOS/Electron", "/usr/share/code/code"].filter(Boolean);
  const executablePath = candidates.find((file) => fs.existsSync(file));
  assert.ok(executablePath, "VSCODE_EXECUTABLE ile VS Code yürütülebilir dosyasını belirtin");
  const profile = fs.mkdtempSync(path.join(directory, "profile-"));
  const channel = fs.mkdtempSync(path.join(directory, "channel-"));
  const env = { ...process.env, KARACA_HOST_TEST_CHANNEL: channel, KARACA_HOST_TEST_FILE: file }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath, env, timeout: 60000,
    args: ["--extensionDevelopmentPath=" + root, "--extensionTestsPath=" + path.join(root, "test/extension-runner.cjs"), "--user-data-dir=" + profile, "--extensions-dir=" + path.join(directory, "extensions"), "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--new-window", file] });
  try {
    const window = await app.firstWindow();
    const editorFrame = async () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        for (const frame of window.frames()) {
          if (await frame.locator("#live-root .tiptap").count().catch(() => 0)) return frame;
        }
        await window.waitForTimeout(200);
      }
      throw new Error("Karaca editörü yüklenmedi");
    };
    for (let attempt = 0; attempt < 200 && !fs.existsSync(path.join(channel, "ready")); attempt++) await window.waitForTimeout(100);
    assert.ok(fs.existsSync(path.join(channel, "ready")), "Extension Host test runner başlatılmalı");
    let frame = await editorFrame();
    await frame.locator("#live-root h1").waitFor();
    assert.equal(await frame.locator("#pkgmark").innerText(), "paket-9");
    await frame.locator("#live-root .tiptap").click();
    await window.keyboard.press("Control+End");
    await window.keyboard.press("Enter");
    await window.keyboard.type("Extension Host kaydı başarılı.");
    await window.keyboard.press("Control+s");
    for (let attempt = 0; attempt < 50 && !fs.readFileSync(file, "utf8").includes("Extension Host kaydı başarılı."); attempt++) await window.waitForTimeout(100);
    assert.ok(fs.readFileSync(file, "utf8").includes("Extension Host kaydı başarılı."));
    fs.writeFileSync(path.join(channel, "command.json"), JSON.stringify({ type: "reopen" }));
    for (let attempt = 0; attempt < 100 && !fs.existsSync(path.join(channel, "reopened")); attempt++) await window.waitForTimeout(100);
    assert.ok(fs.existsSync(path.join(channel, "reopened")), "Belge host API ile yeniden açılmalı");
    frame = await editorFrame();
    await frame.waitForFunction(() => document.querySelector("#live-root")?.textContent.includes("Extension Host kaydı başarılı"));
    assert.match(await frame.locator("#live-root").innerText(), /Extension Host kaydı başarılı/);
    await window.screenshot({ path: path.join(directory, "roundtrip-paket-9.png") });

  } catch (error) {
    const window = await app.firstWindow();
    await window.screenshot({ path: path.join(directory, "failure.png") });
    console.log("frames", window.frames().map((frame) => frame.url()));
    throw error;
  } finally {
    fs.writeFileSync(path.join(channel, "command.json"), JSON.stringify({ type: "stop" }));
    await app.close().catch(() => {});
  }
});
