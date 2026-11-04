const { test } = require("node:test");
const { _electron: electron } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
test("VS Code Extension Host: aç, düzenle, kaydet ve yeniden aç", { timeout: 120000 }, async () => {
  const root = path.resolve(__dirname, "..");
  const hostDirectory = path.join(root, "out/extension-host"); fs.mkdirSync(hostDirectory, { recursive: true });
  const directory = fs.mkdtempSync(path.join(hostDirectory, "git-"));
  const file = path.join(directory, "roundtrip.md");
  const baseline = "# Extension Host\n\n[Hedefe git](#hedef)\n\nBaşlangıç paragrafı.\n\n" + "Kaydetme denemesi.\n\n".repeat(30) + "## Orta hedef\n\n" + "Kaydetme denemesi.\n\n".repeat(30) + "Silinecek.\n\n## Hedef\n\nSon.\n";
  fs.writeFileSync(file, baseline);
  const git = args => execFileSync("git", args, { cwd: directory, stdio: "pipe" });
  git(["init"]); git(["-c", "user.name=Karaca Test", "-c", "user.email=test@example.invalid", "add", "roundtrip.md"]);
  git(["-c", "user.name=Karaca Test", "-c", "user.email=test@example.invalid", "commit", "-m", "Git gutter baseline"]);
  fs.writeFileSync(file, baseline.replace("Başlangıç paragrafı.", "Değişen paragraf.").replace("Silinecek.\n\n", "") + "\nYeni paragraf.\n");
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
    assert.equal(await frame.locator("#pkgmark").innerText(), "paket-25");
    await frame.getByRole("button", { name: "Table", exact: true }).waitFor();
    await frame.locator("#live-root .git-modified").first().waitFor();
    await frame.locator("#live-root .git-added").first().waitFor();
    assert.ok(await frame.locator("#live-root .git-deleted-point").count());
    await frame.getByRole("tab", { name: "Source", exact: true }).click();
    await frame.locator(".git-source-gutter .git-modified").first().waitFor();
    await frame.getByRole("tab", { name: "Live", exact: true }).click();
    await frame.locator("#live-wrap").evaluate(wrap => {
      wrap.scrollTop = 620;
      wrap.dispatchEvent(new Event("scroll"));
    });
    fs.writeFileSync(path.join(channel, "command.json"), JSON.stringify({ type: "switch-note" }));
    await window.waitForFunction(() => Array.from(document.querySelectorAll(".tab.active")).some(tab => tab.textContent.includes("other.md")));
    fs.writeFileSync(path.join(channel, "command.json"), JSON.stringify({ type: "switch-back" }));
    await window.waitForFunction(() => Array.from(document.querySelectorAll(".tab.active")).some(tab => tab.textContent.includes("roundtrip.md")));
    frame = await editorFrame();
    await frame.waitForFunction(() => Math.abs(document.querySelector("#live-wrap").scrollTop - 620) < 2);
    fs.writeFileSync(path.join(channel,"command.json"),JSON.stringify({type:"open-diff"}));
    let diffFrames = [];
    for(let attempt=0;attempt<100;attempt++) {
      diffFrames=[];
      for(const candidate of window.frames()) if(await candidate.locator("#live-root .tiptap").count().catch(()=>0)) diffFrames.push(candidate);
      if(diffFrames.length===2) break; await window.waitForTimeout(100);
    }
    assert.equal(diffFrames.length,2,"Working Tree iki özel editör açmalı");
    const modified = (await diffFrames[0].locator("#live-root").innerText()).includes("Değişen paragraf") ? diffFrames[0] : diffFrames[1];
    const originalFrame = diffFrames.find(f=>f!==modified);
    await modified.locator("#live-root h2").first().waitFor();
    await modified.evaluate(()=>{ const wrap=document.querySelector("#live-wrap"), heading=document.querySelector("#live-root h2"); wrap.scrollTop+=heading.getBoundingClientRect().top-wrap.getBoundingClientRect().top-25; });
    await originalFrame.waitForFunction(()=>document.querySelector("#live-wrap").scrollTop>300);
    const offset = f=>f.evaluate(()=>document.querySelector("#live-root h2").getBoundingClientRect().top-document.querySelector("#live-wrap").getBoundingClientRect().top);
    await window.waitForTimeout(300);
    assert.ok(Math.abs(await offset(originalFrame)-await offset(modified))<5,"Karşılaştırma aynı içeriğe kaymalı");
    await originalFrame.evaluate(()=>{document.querySelector("#live-wrap").scrollTop-=250;});
    await window.waitForTimeout(500);
    assert.ok(Math.abs(await offset(originalFrame)-await offset(modified))<5,"Ters yönde de kaydırılmalı");
    fs.writeFileSync(path.join(channel,"command.json"),JSON.stringify({type:"close-diff"}));
    for(let attempt=0;attempt<100&&!fs.existsSync(path.join(channel,"diff-closed"));attempt++) await window.waitForTimeout(100);
    frame=await editorFrame();
    await frame.getByRole("link", { name: "Hedefe git", exact: true }).click();
    await frame.waitForFunction(() => document.querySelector("#live-wrap").scrollTop > 500);
    assert.equal(await frame.locator("#ui-language").count(), 0);
    fs.writeFileSync(path.join(channel, "command.json"), JSON.stringify({ type: "language", language: "tr" }));
    await frame.getByRole("button", { name: "Tablo", exact: true }).waitFor();
    await app.evaluate(({clipboard})=>{
      globalThis.karacaSavedClipboard={text:clipboard.readText(),html:clipboard.readHTML(),rtf:clipboard.readRTF(),image:clipboard.readImage()};
      clipboard.writeText("Düz pano denemesi");
    });
    await frame.locator("#live-root .tiptap").click(); await window.keyboard.press("Control+End");
    await window.keyboard.press("Enter"); await window.keyboard.press("Control+v");
    await frame.waitForFunction(()=>document.querySelector("#live-root").textContent.includes("Düz pano denemesi"),{},{timeout:5000});
    await app.evaluate(({clipboard})=>clipboard.write({text:"Biçimsiz yapıştırma",html:"<h1>Biçimsiz yapıştırma</h1>"}));
    await window.keyboard.press("Enter"); await window.keyboard.press("Control+Shift+v");
    await frame.waitForFunction(()=>document.querySelector("#live-root").textContent.includes("Biçimsiz yapıştırma"),{},{timeout:5000});
    assert.equal(await frame.locator("#live-root h1").filter({hasText:"Biçimsiz yapıştırma"}).count(),0);
    await app.evaluate(({clipboard})=>clipboard.write({text:"Biçimli pano örneği",html:'<html><body><!--StartFragment--><div class="confluence-content"><h2>Pano başlığı</h2><p>Bir <strong>kalın</strong> ve <em>italik</em> <a href="https://example.com">bağlantı</a>.</p><ul><li>Birinci madde</li><li>İkinci madde</li></ul><table><tbody><tr><th>Ad</th><th>Değer</th></tr><tr><td>Pano hücresi</td><td>42</td></tr></tbody></table></div><!--EndFragment--></body></html>'}));
    await window.keyboard.press("Enter"); await window.keyboard.press("Control+v");
    await frame.locator("#live-root h2").filter({hasText:"Pano başlığı"}).waitFor({timeout:5000});
    assert.equal(await frame.locator("#live-root strong").filter({hasText:"kalın"}).count(),1);
    assert.equal(await frame.locator("#live-root td").filter({hasText:"Pano hücresi"}).count(),1);
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
    await frame.getByRole("button", { name: "Tablo", exact: true }).waitFor();
    assert.equal(await frame.locator("#ui-language").count(), 0);
    assert.match(await frame.locator("#live-root").innerText(), /Extension Host kaydı başarılı/);
    assert.doesNotMatch(fs.readFileSync(file,"utf8"),/<(?:p|table|tr|td|th)\b/);
    assert.match(fs.readFileSync(file,"utf8"),/\| Ad \| Değer \|/);
    assert.match(fs.readFileSync(file,"utf8"),/## Pano başlığı/);
    assert.match(fs.readFileSync(file,"utf8"),/\*\*kalın\*\*/);
    assert.equal(await frame.locator("#live-root td").filter({hasText:"Pano hücresi"}).count(),1);
    await window.screenshot({ path: path.join(directory, "roundtrip-paket-25.png") });
    const original = path.join(directory, "selected-original.png");
    fs.writeFileSync(original, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j/gAAAABJRU5ErkJggg==", "base64"));
    // Stub only the OS chooser in this isolated Electron process, exercising the
    // real extension's file reading, copying, insertion, save cleanup and undo.
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, original);
    await frame.getByRole("button", { name: "Görsel", exact: true }).click();
    await frame.getByRole("button", { name: "Dosyadan seç…", exact: true }).click();
    const dialog = frame.getByRole("dialog", { name: "Görsel ekle", exact: true });
    await frame.waitForFunction(() => document.querySelectorAll(".kdialog input")[1]?.value.startsWith("assets/img-"));
    const relative = await dialog.locator("input").nth(1).inputValue();
    assert.match(relative, /^assets\/img-\d{14}(?:-\d+)?\.png$/);
    const copied = path.join(directory, relative);
    assert.ok(fs.existsSync(copied));
    await dialog.getByRole("button", { name: "Ekle", exact: true }).click();
    await window.keyboard.press("Control+s");
    for (let attempt = 0; attempt < 100 && !fs.readFileSync(file, "utf8").includes(relative); attempt++) await window.waitForTimeout(100);
    assert.ok(fs.readFileSync(file, "utf8").includes(relative));
    await frame.locator("#live-root img").click(); await window.keyboard.press("Delete");
    await window.keyboard.press("Control+s");
    for (let attempt = 0; attempt < 100 && fs.existsSync(copied); attempt++) await window.waitForTimeout(100);
    assert.equal(fs.existsSync(copied), false); assert.ok(fs.existsSync(original));
    await window.keyboard.press("Control+z");
    for (let attempt = 0; attempt < 100 && !fs.existsSync(copied); attempt++) await window.waitForTimeout(100);
    assert.ok(fs.existsSync(copied), "Undo restores the image file");
    await window.keyboard.press("Control+s");
    for (let attempt = 0; attempt < 50 && !fs.readFileSync(file, "utf8").includes(relative); attempt++) await window.waitForTimeout(100);
    git(["add", "roundtrip.md"]); git(["-c", "user.name=Karaca Test", "-c", "user.email=test@example.invalid", "commit", "-m", "Accept editor changes"]);
    fs.writeFileSync(path.join(channel, "command.json"), JSON.stringify({ type: "git-status" }));
    await frame.waitForFunction(() => document.querySelectorAll("#live-root .git-modified,#live-root .git-added,#live-root .git-deleted-point").length === 0);
    fs.writeFileSync(path.join(channel, "command.json"), JSON.stringify({ type: "git-new-file" }));
    for (let attempt = 0; attempt < 100 && !fs.existsSync(path.join(channel, "new-file-open")); attempt++) await window.waitForTimeout(100);
    frame = await editorFrame();
    await frame.waitForFunction(() => document.querySelector("#live-root h1")?.textContent === "New note");
    await frame.locator("#live-root .git-added").first().waitFor();
    assert.equal(await frame.locator("#live-root .git-modified").count(), 0);

  } catch (error) {
    const window = await app.firstWindow();
    await window.screenshot({ path: path.join(directory, "failure.png") });
    console.log("frames", window.frames().map((frame) => frame.url()));
    throw error;
  } finally {
    fs.writeFileSync(path.join(channel, "command.json"), JSON.stringify({ type: "stop" }));
    await app.evaluate(({clipboard})=>{
      if(globalThis.karacaSavedClipboard && ["Düz pano denemesi","Biçimsiz yapıştırma","Biçimli pano örneği"].includes(clipboard.readText())) clipboard.write(globalThis.karacaSavedClipboard);
    }).catch(()=>{});
    await app.close().catch(() => {});
  }
});
