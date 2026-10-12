const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** Extension host (Node) */
const extConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: !production,
  minify: production,
};

/** Webview (browser) */
const webviewConfig = {
  entryPoints: ["src/webview/main.ts"],
  bundle: true,
  outfile: "media/webview.js",
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  sourcemap: !production,
  minify: production,
  loader: { ".css": "text" },
};

async function run() {
  if (watch) {
    const extCtx = await esbuild.context(extConfig);
    const webCtx = await esbuild.context(webviewConfig);
    await extCtx.watch();
    await webCtx.watch();
    console.log("Watching...");
  } else {
    await esbuild.build(extConfig);
    await esbuild.build(webviewConfig);
    console.log("Build complete.");
  }
}

run().catch(() => process.exit(1));
