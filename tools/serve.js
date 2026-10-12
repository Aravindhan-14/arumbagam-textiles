/* ============================================================
   ARUMBAGAM - tiny static file server
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
const { execFile } = require("child_process");
const crypto = require("crypto");

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

function sendJson(res, code, obj) {
  send(res, code, JSON.stringify(obj), "application/json; charset=utf-8");
}

/* ============================================================
   Wired printing
   ------------------------------------------------------------
   The printer is plugged into this PC by USB, so the browser
   cannot reach it on its own. These endpoints hand the job to
   the Windows spooler through tools/print.ps1, which means the
   billing screen can print with no dialog - from this PC and
   from any phone on the shop's Wi-Fi.
   ============================================================ */
const PS_SCRIPT = path.join(__dirname, "print.ps1");
const IS_WINDOWS = process.platform === "win32";
const JOB_LIMIT = 24 * 1024 * 1024;   // a full-page label PNG, with room to spare

function runPrintHelper(args) {
  return new Promise((resolve) => {
    if (!IS_WINDOWS) {
      return resolve({ ok: false, error: "Wired printing needs Windows. Use browser printing instead." });
    }
    execFile("powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", PS_SCRIPT, ...args],
      { windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        // PowerShell can add a banner or warnings of its own, so pick out
        // the line that is actually the helper's answer.
        for (const line of String(stdout || "").split(/\r?\n/).reverse()) {
          const s = line.trim();
          if (!s.startsWith("{")) continue;
          try { return resolve(JSON.parse(s)); } catch { /* keep looking */ }
        }
        const detail = String(stderr || "").trim() || String(stdout || "").trim() || (err && err.message) || "";
        resolve({ ok: false, error: detail || "The print helper did not answer." });
      });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > JOB_LIMIT) { reject(new Error("That print job is too large.")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch { reject(new Error("The print job could not be read.")); }
    });
    req.on("error", reject);
  });
}

const tmpJob = (ext) => path.join(os.tmpdir(), `demo-${crypto.randomBytes(6).toString("hex")}.${ext}`);

/**
 * Print artwork through the printer's own Windows driver.
 * A job carries either one page, or a run of them in `pages` - a hundred
 * stickers then become one spooled job instead of a hundred.
 */
async function printImage(job) {
  const pages = Array.isArray(job.pages) && job.pages.length
    ? job.pages
    : [{ png: job.png, copies: job.copies }];

  const written = [];
  for (const page of pages) {
    const b64 = String(page.png || "").replace(/^data:image\/\w+;base64,/, "");
    if (!b64) continue;
    const file = tmpJob("png");
    fs.writeFileSync(file, Buffer.from(b64, "base64"));
    written.push({ file, copies: Math.max(1, Number(page.copies) || 1) });
  }
  if (!written.length) throw new Error("The print job had no page in it.");

  const manifest = tmpJob("txt");
  fs.writeFileSync(manifest, written.map((p) => `${p.copies}\t${p.file}`).join("\r\n"), "utf8");

  try {
    return await runPrintHelper([
      "-Mode", "image",
      "-Printer", String(job.printer || ""),
      "-Manifest", manifest,
      "-WidthMm", String(Number(job.widthMm) || 0),
      "-HeightMm", String(Number(job.heightMm) || 0),
      "-Rotate", String([0, 90, 180, 270].includes(Number(job.rotate)) ? Number(job.rotate) : 0)
    ]);
  } finally {
    setTimeout(() => {
      [manifest, ...written.map((p) => p.file)].forEach((f) => { try { fs.unlinkSync(f); } catch {} });
    }, 20000);
  }
}

/** Hand ESC/POS or TSPL bytes to the printer untouched. */
async function printRaw(job) {
  const b64 = String(job.base64 || "");
  if (!b64) throw new Error("The print job had no data in it.");
  const file = tmpJob("bin");
  fs.writeFileSync(file, Buffer.from(b64, "base64"));
  try {
    return await runPrintHelper([
      "-Mode", "raw",
      "-Printer", String(job.printer || ""),
      "-File", file,
      "-Copies", String(Math.max(1, Number(job.copies) || 1))
    ]);
  } finally {
    setTimeout(() => { try { fs.unlinkSync(file); } catch {} }, 20000);
  }
}

async function handleApi(req, res, pathname) {
  // Answered without touching Windows, so START ARUMBAGAM can tell in an
  // instant whether the window it found is this version or an older one.
  if (pathname === "/api/health" && req.method === "GET") {
    return sendJson(res, 200, { ok: true, app: "demo-sarees", printBridge: IS_WINDOWS, port: PORT });
  }

  if (pathname === "/api/print/printers" && req.method === "GET") {
    const out = await runPrintHelper(["-Mode", "list"]);
    const printers = Array.isArray(out.printers) ? out.printers : out.printers ? [out.printers] : [];
    return sendJson(res, 200, { ...out, printers, platform: process.platform });
  }

  if ((pathname === "/api/print/image" || pathname === "/api/print/raw") && req.method === "POST") {
    let out;
    try {
      const job = await readBody(req);
      out = pathname.endsWith("/image") ? await printImage(job) : await printRaw(job);
    } catch (e) {
      out = { ok: false, error: e.message };
    }
    return sendJson(res, out.ok ? 200 : 500, out);
  }

  return sendJson(res, 404, { ok: false, error: "Unknown print endpoint." });
}

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent((req.url || "/").split("?")[0]);

  if (rel.startsWith("/api/")) return void handleApi(req, res, rel);
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
  console.log("  ARUMBAGAM is running");
  console.log("  ---------------------------------------");
  console.log(`  This PC        http://localhost:${PORT}`);
  nets.forEach((ip) => console.log(`  Phone / tablet http://${ip}:${PORT}`));
  console.log("");
  console.log(IS_WINDOWS
    ? "  Printing       wired - jobs go to the USB printer through Windows"
    : "  Printing       browser dialog only (wired printing needs Windows)");
  console.log("  Keep this window open while the shop is billing.");
  console.log("  Press Ctrl+C to stop.");
  console.log("");
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") console.error(`\n  Port ${PORT} is already in use. The app may already be running.\n`);
  else console.error(e.message);
  process.exit(1);
});
