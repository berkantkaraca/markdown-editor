const { spawnSync } = require("node:child_process");
for (const engine of ["chromium", "firefox", "webkit"]) {
  console.log(`\nBrowser: ${engine}`);
  const result = spawnSync(process.execPath, ["--test", "test/browser.cjs"], {
    stdio: "inherit", env: { ...process.env, KARACA_BROWSER: engine },
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
