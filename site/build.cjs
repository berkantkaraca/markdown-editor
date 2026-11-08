const esbuild = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "out", "web");
const assets = path.join(output, "assets");
function copyTree(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const item of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, item.name), to = path.join(target, item.name);
    if (item.isDirectory()) copyTree(from, to);
    else if (item.isFile()) fs.copyFileSync(from, to);
  }
}
async function build() {
  const result = await esbuild.build({
    absWorkingDir: root,
    entryPoints: ["src/webview/browser-entry.ts"],
    outdir: assets, bundle: true, platform: "browser", format: "esm",
    splitting: true, target: ["es2020"], minify: true,
    define: { __TEST__: "false" }, loader: { ".css": "text" },
    chunkNames: "chunks/[name]-[hash]", metafile: true,
  });
  const chunks = path.join(assets, "chunks");
  const emitted = new Set(Object.keys(result.metafile.outputs).map(file => path.resolve(root, file)));
  for (const entry of fs.readdirSync(chunks, { withFileTypes: true })) {
    const file = path.join(chunks, entry.name);
    if (entry.isFile() && file.endsWith(".js") && !emitted.has(file)) fs.unlinkSync(file);
  }
  fs.mkdirSync(path.join(output, "editor"), { recursive: true });
  const layout = fs.readFileSync(path.join(root, "src/webview/layout.html"), "utf8");
  const editor = fs.readFileSync(path.join(__dirname, "editor.html"), "utf8");
  fs.writeFileSync(path.join(output, "editor", "index.html"), editor.replace("<!-- editor-layout -->", () => layout));
  fs.copyFileSync(path.join(__dirname, "index.html"), path.join(output, "index.html"));
  fs.copyFileSync(path.join(__dirname, "brand.css"), path.join(assets, "brand.css"));
  fs.copyFileSync(path.join(__dirname, "landing.css"), path.join(assets, "landing.css"));
  fs.copyFileSync(path.join(__dirname, "web.css"), path.join(assets, "web.css"));
  fs.copyFileSync(path.join(root, "media/style.css"), path.join(assets, "editor.css"));
  fs.copyFileSync(path.join(root, "media/icon.png"), path.join(assets, "icon.png"));
  fs.copyFileSync(path.join(root, "node_modules/katex/dist/katex.min.css"), path.join(assets, "katex.css"));
  copyTree(path.join(root, "node_modules/katex/dist/fonts"), path.join(assets, "fonts"));
  console.log("Web build: " + output);
}
build().catch(error => { console.error(error); process.exitCode = 1; });
