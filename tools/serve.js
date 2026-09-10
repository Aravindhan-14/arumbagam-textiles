/* ============================================================
   VYRA SAREES - tiny static file server
   ------------------------------------------------------------
   The app is a plain set of files that talk straight to Firebase,
   but a browser will not run ES modules or a service worker off
   file:// - it needs an http:// address. This serves the public
   folder and nothing else, with no packages to install.

       node tools/serve.js [port]

   Other phones on the same Wi-Fi can open it too: the address is
   printed when it starts.
   ============================================================ */
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.join(__dirname, "..", "public");
const PORT = Number(process.argv[2] || process.env.PORT || 5000);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

function send(res, code, body, type = "text/plain; charset=utf-8") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-cache" });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent((req.url || "/").split("?")[0]);
  if (rel.endsWith("/")) rel += "index.html";

  const file = path.join(ROOT, path.normalize(rel));
  // Never serve anything outside the public folder.
  if (!file.startsWith(ROOT)) return send(res, 403, "Forbidden");

  fs.readFile(file, (err, data) => {
    if (err) {
      // Unknown path: hand back the app shell so the #/hash router can work.
      return fs.readFile(path.join(ROOT, "index.html"), (e2, shell) =>
        e2 ? send(res, 404, "Not found") : send(res, 200, shell, TYPES[".html"]));
    }
    send(res, 200, data, TYPES[path.extname(file).toLowerCase()] || "application/octet-stream");
  });
});

server.listen(PORT, () => {
  const nets = Object.values(os.networkInterfaces()).flat()
    .filter((n) => n && n.family === "IPv4" && !n.internal)
    .map((n) => n.address);

  console.log("");
  console.log("  VYRA SAREES is running");
  console.log("  ---------------------------------------");
  console.log(`  This PC        http://localhost:${PORT}`);
  nets.forEach((ip) => console.log(`  Phone / tablet http://${ip}:${PORT}`));
  console.log("");
  console.log("  Keep this window open while the shop is billing.");
  console.log("  Press Ctrl+C to stop.");
  console.log("");
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") console.error(`\n  Port ${PORT} is already in use. The app may already be running.\n`);
  else console.error(e.message);
  process.exit(1);
});
