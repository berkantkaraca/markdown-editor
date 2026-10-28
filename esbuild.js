const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");
const onlyArg = process.argv.find((a) => a.startsWith("--only=")) || "";
const only = onlyArg.slice("--only=".length); // "ext" | "webview" | ""

/** Extension host (Node) */
const extConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  loader: { ".html": "text" },
  sourcemap: !production,
  minify: production,
};

/** Webview test paketi (jsdom ESM modülleri çalıştırmaz; testler IIFE kullanır) */
const testBundleConfig = {
  entryPoints: ["src/webview/main.ts"],
  bundle: true,
  outfile: "media/test-bundle.js",
  define: { __TEST__: "true" },
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  sourcemap: false,
  minify: false,
  loader: { ".css": "text" },
};
/** Webview (browser, ES modülü + lazy chunk'lar) */
const webviewConfig = {
  entryPoints: ["src/webview/main.ts"],
  bundle: true,
  outdir: "media/webview",
  define: { __TEST__: "false" },
  format: "esm",
  splitting: true,
  platform: "browser",
  target: ["es2020"],
  // NOT: sourcemap kapalı — 19 MB'lık map üretimi esbuild'i Windows'ta
  // natif tarafta sessizce çökertiyor (0xC0000409). Hata ayıklama yine yapılır.
  sourcemap: false,
  minify: production,
  loader: { ".css": "text" },
};

// Tek tek silme (fs.rmSync bu makinede sessizce işlemiyor, kullanılmaz)
function rmDirSync(dir) {
  if (!fs.existsSync(dir)) {
    return;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      rmDirSync(p);
    } else {
      fs.unlinkSync(p);
    }
  }
  fs.rmdirSync(dir);
}

// Tek tek dosya kopyalar (fs.cpSync bu makinede natif çöküyor, kullanılmaz)
function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

// KaTeX CSS + fontlarını media/ altına kopyala (webview gömülü kullanır)
function copyKatexAssets() {
  try {
    const cssSrc = "node_modules/katex/dist/katex.min.css";
    if (fs.existsSync(cssSrc)) {
      fs.copyFileSync(cssSrc, "media/katex.css");
    }
    const fontsSrc = "node_modules/katex/dist/fonts";
    if (fs.existsSync(fontsSrc)) {
      rmDirSync("media/fonts");
      copyDirSync(fontsSrc, "media/fonts");
    }
  } catch (err) {
    console.warn("KaTeX kopyalama atlandı:", err?.message || err);
  }
}

function spawnBuild(part, extraArgs) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [__filename, `--only=${part}`, ...extraArgs], {
      stdio: "inherit",
    });
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`build ${part} çıkış kodu ${code}`))
    );
    p.on("error", reject);
  });
}

async function run() {
  if (!only || only === "webview") copyKatexAssets();
  // Eski chunk'lar (dev/prod karışık hash'ler) temizlenir
  try {
    if (only === "webview") rmDirSync("media/webview");
  } catch {
    /* yoksay */
  }
  const prodArgs = production ? ["--production"] : [];
  if (watch && !only) {
    // İzleme modunda iki parça ayrı process'te çalışır
    await Promise.all([spawnBuild("ext", ["--watch"]), spawnBuild("webview", ["--watch"])]);
    return;
  }
  if (watch) {
    const ctxs = [];
    if (!only || only === "ext") {
      ctxs.push(await esbuild.context(extConfig));
    }
    if (!only || only === "webview") {
      ctxs.push(await esbuild.context(webviewConfig));
    }
    await Promise.all(ctxs.map((c) => c.watch()));
    console.log("Watching...");
    return;
  }
  if (!only) {
    // NOT: iki büyük bundle aynı process'te art arda derlenince esbuild
    // natif tarafta sessizce çöküyor (özellikle mermaid sonrası).
    // Tek tek derlenen parçalar sorunsuz, o yüzden ayrı process kullanılır.
    await spawnBuild("ext", prodArgs);
    await spawnBuild("webview", prodArgs);
    console.log("Build complete.");
    return;
  }
  if (!only || only === "ext") {
    await esbuild.build(extConfig);
  }
  if (!only || only === "webview") {
    await esbuild.build(webviewConfig);
  }
  if (only === "test-bundle") {
    const testOutput = path.resolve("dist-test");
    if (path.dirname(testOutput) !== process.cwd()) throw new Error("Test output must be inside workspace");
    rmDirSync(testOutput);
    await esbuild.build(testBundleConfig);
  }
  console.log("Build complete.");
}

run().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
