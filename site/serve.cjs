const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const root = path.resolve(__dirname, "../out/web");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf" };
function createServer() {
  return http.createServer((req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      const file = path.resolve(root, "." + pathname, ...(pathname.endsWith("/") ? ["index.html"] : []));
      if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
      if (fs.statSync(file).isDirectory()) { res.writeHead(308, { Location: pathname + "/" }).end(); return; }
      res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" }).end(fs.readFileSync(file));
    } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
  });
}
if (require.main === module) {
  if (!fs.existsSync(path.join(root, "editor/index.html"))) {
    console.error("Run npm run build:web before starting the preview.");
    process.exitCode = 1;
  } else {
    const port = Number(process.env.PORT ?? 4179);
    createServer().listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}/`));
  }
}
module.exports = { createServer };
