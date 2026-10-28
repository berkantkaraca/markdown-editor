const { spawnSync } = require("node:child_process");
const result = spawnSync(process.execPath, ["--test", "--test-name-pattern=büyük dosya performans", "test/browser.cjs"], {
  stdio: "inherit", env: { ...process.env, KARACA_PERF_LABEL: process.env.KARACA_PERF_LABEL || "current" },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
