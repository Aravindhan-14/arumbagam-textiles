/* ============================================================
   demo SAREES - wired printing
   ------------------------------------------------------------
   The shop's printers (a TVS LP 46 Lite for labels, a BP-80 style
   receipt printer for bills) are plugged into the billing PC by
   USB, so the browser cannot reach them on its own. Jobs go to
   the print bridge inside tools/serve.js, which hands them to
   the Windows spooler:

     driver  - the page is drawn as artwork and printed through
               the printer's own Windows driver, so whatever
               command language the printer speaks is the
               driver's problem. No dialog, no pop-up.
     raw     - ESC/POS bytes straight down the wire, for receipt
               printers that prefer them.
     browser - last resort: the normal print dialog, used when
               the app is opened away from the shop PC.
   ============================================================ */

const API = "/api/print";
const LS = {
  mode: "demo.printMode",
  receipt: "demo.printerReceipt",
  label: "demo.printerLabel",
  raw: "demo.printerRaw",
  rotate: "demo.labelRotate"
};

const state = {
  mode: localStorage.getItem(LS.mode) || "auto",        // auto | wired | browser
  receiptPrinter: localStorage.getItem(LS.receipt) || "",
  labelPrinter: localStorage.getItem(LS.label) || "",
  rawReceipts: localStorage.getItem(LS.raw) === "1",
  labelRotate: Number(localStorage.getItem(LS.rotate)) || 0,
  width: 58,
  bridge: { checked: false, ok: false, printers: [], error: "" }
};

/* ---------- settings ---------- */
export const printerMode = () => state.mode;
export function setPrinterMode(m) { state.mode = m; localStorage.setItem(LS.mode, m); announce(); }
export function setPaperWidth(mm) { state.width = [58, 80, 100].includes(Number(mm)) ? Number(mm) : 58; }
export const paperWidth = () => state.width;
/** Characters per line for the current paper width (Font A). */
export const lineChars = () => (state.width >= 100 ? 64 : state.width === 80 ? 48 : 32);
/** Printable dots for the current paper width. */
export const lineDots = () => (state.width >= 100 ? 800 : state.width === 80 ? 576 : 384);

export const receiptPrinter = () => state.receiptPrinter || defaultPrinter();
/**
 * Stickers must never go to the bill printer by accident, so when no label
 * printer has been chosen yet, a label printer is looked for by name first.
 */
export const labelPrinter = () => state.labelPrinter || guessLabelPrinter() || receiptPrinter();
export function setReceiptPrinter(name) { state.receiptPrinter = name || ""; localStorage.setItem(LS.receipt, state.receiptPrinter); announce(); }
export function setLabelPrinter(name) { state.labelPrinter = name || ""; localStorage.setItem(LS.label, state.labelPrinter); announce(); }
export const rawReceipts = () => state.rawReceipts;
export function setRawReceipts(on) { state.rawReceipts = !!on; localStorage.setItem(LS.raw, on ? "1" : "0"); announce(); }
/** Some rolls feed sideways; this turns the sticker artwork to match. */
export const labelRotation = () => state.labelRotate;
export function setLabelRotation(deg) {
  state.labelRotate = [0, 90, 180, 270].includes(Number(deg)) ? Number(deg) : 0;
  localStorage.setItem(LS.rotate, String(state.labelRotate));
}

export const printers = () => state.bridge.printers;
export const bridgeReady = () => state.bridge.ok;
export const bridgeError = () => state.bridge.error;
const defaultPrinter = () => (state.bridge.printers.find((p) => p.default) || state.bridge.printers[0] || {}).name || "";

/* Names Windows gives label printers: "TVS LP 46 Lite", "TSC TE244", ... */
const LABEL_NAMES = /\b(lp\s*4[0-9]|label|tspl|tsc|te2[0-9]{2}|zebra|zd[0-9]|gc4[0-9]{2})\b/i;
const guessLabelPrinter = () => (state.bridge.printers.find((p) => LABEL_NAMES.test(p.name)) || {}).name || "";

function announce() {
  window.dispatchEvent(new CustomEvent("printer-status", { detail: { connected: isConnected() } }));
}

/* ---------- the bridge ---------- */
/** Ask the local server which printers Windows can see. */
export async function detectPrinters({ force = false } = {}) {
  if (state.bridge.checked && !force) return state.bridge;
  state.bridge.checked = true;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(API + "/printers", { signal: ctl.signal, cache: "no-store" });
    clearTimeout(t);

    // Another server is on this address - Live Server, or an older demo
    // SAREES window - and it answers with a page instead of an answer. Say so
    // plainly: printing still works, through the browser's print box.
    const type = r.headers.get("content-type") || "";
    if (!r.ok || !type.includes("json")) {
      state.bridge.ok = false;
      state.bridge.printers = [];
      state.bridge.error = "This address has no printer helper, so the browser print box is used. For printing with no dialog, open the app from START demo SAREES on the shop PC.";
      announce();
      return state.bridge;
    }

    const data = await r.json();
    state.bridge.printers = Array.isArray(data.printers) ? data.printers : [];
    state.bridge.ok = !!data.ok && state.bridge.printers.length > 0;
    state.bridge.error = data.ok
      ? (state.bridge.printers.length ? "" : "Windows has no printer installed on this PC.")
      : (data.error || "The print helper is not answering.");
  } catch {
    state.bridge.ok = false;
    state.bridge.printers = [];
    state.bridge.error = /^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.)/.test(location.origin)
      ? "The demo SAREES window is not running. Open START demo SAREES on the billing PC."
      : "This page is not served by the shop PC, so wired printing is unavailable.";
  }
  announce();
  return state.bridge;
}

/** True when jobs can go out over the wire right now. */
export const isConnected = () => state.mode !== "browser" && state.bridge.ok;
export const printerName = () => receiptPrinter();
export const supportsWiredPrinting = () => state.bridge.ok;

/** Browser printing is used when it was asked for, or when there is no bridge. */
export function usesBrowserPrint() {
  if (state.mode === "browser") return true;
  if (state.mode === "wired") return false;
  return !state.bridge.ok;
}

async function post(path, body) {
  const r = await fetch(API + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const out = await r.json().catch(() => ({ ok: false, error: "The printer did not answer." }));
  if (!out.ok) throw new Error(out.error || "The printer refused the job.");
  return out;
}

const dataUrlToBase64 = (u) => String(u).replace(/^data:image\/\w+;base64,/, "");

function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/**
 * Print artwork through the Windows driver. The page is sized in
 * millimetres, so a sticker comes out at exactly the label size and a
 * bill at the roll's width.
 */
export async function printCanvas(canvas, { widthMm, heightMm, copies = 1, printer, rotate = 0, title = "demo SAREES" } = {}) {
  const wMm = widthMm || state.width;
  const hMm = heightMm || Math.round((canvas.height / canvas.width) * wMm);
  if (usesBrowserPrint()) return printCanvasViaBrowser(canvas, wMm, hMm, copies, title);
  await post("/image", {
    printer: printer || receiptPrinter(),
    png: dataUrlToBase64(canvas.toDataURL("image/png")),
    widthMm: wMm, heightMm: hMm, copies, rotate
  });
  return "wired";
}

/**
 * Print a run of stickers in one job: pages = [{ canvas, copies }].
 * All of them are the same size, which is what a label roll wants.
 */
export async function printCanvasRun(pages, { widthMm, heightMm, printer, rotate = 0, title = "demo SAREES" } = {}) {
  const wMm = widthMm || state.width;
  if (!pages.length) return "wired";
  if (usesBrowserPrint()) {
    const flat = [];
    pages.forEach(({ canvas, copies = 1 }) => {
      for (let i = 0; i < Math.max(1, copies); i++) flat.push(canvas);
    });
    return printPagesInPage(flat, {
      widthMm: wMm,
      heightMm: heightMm || Math.round((flat[0].height / flat[0].width) * wMm)
    });
  }
  await post("/image", {
    printer: printer || labelPrinter(),
    widthMm: wMm,
    heightMm: heightMm || Math.round((pages[0].canvas.height / pages[0].canvas.width) * wMm),
    rotate,
    pages: pages.map(({ canvas, copies = 1 }) => ({
      png: dataUrlToBase64(canvas.toDataURL("image/png")),
      copies: Math.max(1, copies)
    }))
  });
  return "wired";
}

/** Send ESC/POS bytes down the wire untouched. */
export async function sendBytes(bytes, { printer, copies = 1 } = {}) {
  if (!state.bridge.ok) {
    throw new Error("The shop printer is not reachable. Open the app on the billing PC, or set Print mode to Browser print.");
  }
  await post("/raw", { printer: printer || receiptPrinter(), base64: bytesToBase64(bytes), copies });
  return "wired";
}

/* ---------- browser fallbacks ---------- */
function printCanvasViaBrowser(canvas, wMm, hMm, copies, title) {
  const src = canvas.toDataURL("image/png");
  const pages = [];
  for (let i = 0; i < Math.max(1, copies); i++) pages.push(`<div class="pg"><img src="${src}" alt=""></div>`);
  printHtmlFallback(pages.join(""), title, {
    page: `${wMm}mm ${hMm}mm`,
    margin: "0",
    css: `.pg{width:${wMm}mm;height:${hMm}mm;overflow:hidden;page-break-after:always;break-after:page}
          .pg:last-child{page-break-after:auto;break-after:auto}
          .pg img{width:100%;height:100%;max-width:none;object-fit:contain;display:block}`
  });
  return "browser";
}

/**
 * Printing without the shop PC's helper: the rows are laid into this very
 * page and the browser's own print is used. No pop-up window (phones block
 * those) and no "about:blank" address, and the page box is set to the exact
 * row size, so the roll comes out right as long as the print box is set to
 * the label paper with no margins and no scaling.
 */
export async function printPagesInPage(canvases, { widthMm, heightMm } = {}) {
  document.getElementById("demo-print-area")?.remove();
  document.getElementById("demo-print-style")?.remove();

  const area = document.createElement("div");
  area.id = "demo-print-area";

  // Wait for the artwork to be decoded, or the first page prints blank.
  await Promise.all(canvases.map((c) => new Promise((done) => {
    const img = new Image();
    img.onload = img.onerror = () => done();
    img.src = c.toDataURL("image/png");
    const page = document.createElement("div");
    page.className = "demo-pg";
    page.appendChild(img);
    area.appendChild(page);
  })));

  const style = document.createElement("style");
  style.id = "demo-print-style";
  style.textContent = `
    #demo-print-area{display:none}
    @media print{
      @page{size:${widthMm}mm ${heightMm}mm;margin:0}

      /* The app shell is a full-height layout; left as it is, its height
         alone would push out extra empty pages. */
      html,body{margin:0!important;padding:0!important;background:#fff!important;
                width:${widthMm}mm!important;height:auto!important;min-height:0!important;
                max-height:none!important;overflow:visible!important}
      body>*{display:none!important}

      /* font-size/line-height are zeroed so no stray text line can add a
         fraction of a millimetre and spill onto a page of its own. */
      #demo-print-area{display:block!important;margin:0;padding:0;border:0;
                       font-size:0;line-height:0}

      .demo-pg{display:block;box-sizing:border-box;
               width:${widthMm}mm;height:${heightMm}mm;
               margin:0;padding:0;border:0;overflow:hidden;
               font-size:0;line-height:0;
               break-inside:avoid;page-break-inside:avoid}

      /* Break BEFORE each row after the first, never after the last one -
         a trailing break is what produced the empty page. */
      .demo-pg + .demo-pg{break-before:page;page-break-before:always}

      /* 1:1 with the artwork: no smoothing, so the bars and QR modules stay
         hard-edged and scannable. */
      .demo-pg img{display:block;width:100%;height:100%;max-width:none;
                   object-fit:fill;margin:0;padding:0;border:0;
                   image-rendering:-webkit-optimize-contrast;image-rendering:crisp-edges;
                   -webkit-print-color-adjust:exact;print-color-adjust:exact}
    }`;

  document.body.appendChild(style);
  document.body.appendChild(area);

  const clean = () => {
    area.remove(); style.remove();
    window.removeEventListener("afterprint", clean);
  };
  window.addEventListener("afterprint", clean);
  setTimeout(() => window.print(), 80);
  setTimeout(clean, 120000);       // in case afterprint never arrives
  return "browser";
}

/**
 * Opens the job in a window and calls print(), so any printer installed in
 * Windows can be picked from the print dialog.
 * `page` / `margin` set the CSS @page box - stickers need their own size.
 */
export function printHtmlFallback(html, title = "Receipt", { page, margin, css = "" } = {}) {
  const w = window.open("", "_blank", "width=380,height=640");
  if (!w) { alert("Please allow pop-ups to use browser printing."); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>
      @page{size:${page || `${state.width}mm auto`};margin:${margin || "3mm"}}
      body{font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:1.45;margin:0;color:#000}
      .c{text-align:center}.r{text-align:right}.b{font-weight:700}
      hr{border:none;border-top:1px dashed #000;margin:5px 0}
      table{width:100%;border-collapse:collapse}td{padding:1px 0;vertical-align:top}
      .big{font-size:15px;font-weight:700}
      img,canvas{max-width:100%}
      ${css}
    </style></head><body>${html}</body></html>`);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 350);
}

export function printerStatus() {
  if (state.mode === "browser") return { ok: true, text: "Browser print dialog" };
  if (state.bridge.ok) {
    const r = receiptPrinter(), l = labelPrinter();
    return { ok: true, text: r === l ? "Wired · " + r : "Bills → " + r + " · Labels → " + l };
  }
  if (!state.bridge.checked) return { ok: false, text: "Looking for the printer…" };
  return { ok: false, text: state.bridge.error || "No wired printer found" };
}

/* ============================================================
   ESC/POS builder - used for raw receipt printing
   ============================================================ */
export class Escpos {
  constructor(width = state.width) {
    this.parts = [];
    this.width = width;
    this.cols = width >= 100 ? 64 : width === 80 ? 48 : 32;
    this.dots = width >= 100 ? 800 : width === 80 ? 576 : 384;
    this.raw([0x1b, 0x40]);                 // ESC @  initialise
    this.raw([0x1b, 0x74, 0x00]);           // ESC t  codepage CP437
  }
  raw(arr) { this.parts.push(Uint8Array.from(arr)); return this; }
  bytes(u8) { this.parts.push(u8); return this; }

  /** ESC/POS printers are single-byte; fold the text down to printable ASCII. */
  encode(str) {
    const s = String(str)
      .replace(/₹/g, "Rs.")
      .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
      .replace(/[–—]/g, "-").replace(/ /g, " ");
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out[i] = c < 256 ? c : 63; }
    return out;
  }
  text(str = "") { return this.bytes(this.encode(str)); }
  line(str = "") { return this.text(str + "\n"); }
  feed(n = 1) { return this.raw([0x1b, 0x64, n]); }

  align(a) { return this.raw([0x1b, 0x61, a === "center" ? 1 : a === "right" ? 2 : 0]); }
  bold(on) { return this.raw([0x1b, 0x45, on ? 1 : 0]); }
  underline(on) { return this.raw([0x1b, 0x2d, on ? 1 : 0]); }
  /** w/h are 1 or 2 (double). */
  size(w = 1, h = 1) { return this.raw([0x1d, 0x21, ((w - 1) << 4) | (h - 1)]); }
  invert(on) { return this.raw([0x1d, 0x42, on ? 1 : 0]); }

  rule(ch = "-") { return this.line(ch.repeat(this.cols)); }
  /** Left text + right text padded to the full line width. */
  lr(left, right) {
    const l = String(left), r = String(right).replace(/₹/g, "Rs.");
    const pad = Math.max(1, this.cols - l.length - r.length);
    return this.line(l + " ".repeat(pad) + r);
  }
  /** Three columns: name (flex), qty (5), amount (10). */
  row3(name, qty, amount) {
    const qw = 5, aw = this.cols >= 48 ? 12 : 9;
    const nw = this.cols - qw - aw;
    const n = String(name).slice(0, nw).padEnd(nw);
    const q = String(qty).padStart(qw);
    const a = String(amount).replace(/₹/g, "").padStart(aw);
    return this.line(n + q + a);
  }
  center(str) { this.align("center"); this.line(str); return this.align("left"); }

  /** Native ESC/POS QR (falls back to a raster image when unsupported). */
  qr(data, moduleSize = 6) {
    const d = this.encode(data);
    const len = d.length + 3;
    this.raw([0x1d, 0x28, 0x6b, 4, 0, 49, 65, 50, 0]);              // model 2
    this.raw([0x1d, 0x28, 0x6b, 3, 0, 49, 67, moduleSize]);          // module size
    this.raw([0x1d, 0x28, 0x6b, 3, 0, 49, 69, 49]);                  // error correction M
    this.raw([0x1d, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 49, 80, 48]);
    this.bytes(d);
    this.raw([0x1d, 0x28, 0x6b, 3, 0, 49, 81, 48]);                  // print
    return this;
  }

  /** Native CODE128 barcode. */
  barcode128(value, height = 60, hri = true) {
    this.raw([0x1d, 0x68, height]);                 // height
    this.raw([0x1d, 0x77, 2]);                      // module width
    this.raw([0x1d, 0x48, hri ? 2 : 0]);            // HRI below
    const payload = this.encode("{B" + String(value));
    this.raw([0x1d, 0x6b, 73, payload.length]);
    this.bytes(payload);
    this.raw([0x0a]);
    return this;
  }

  /** GS v 0 raster image from a canvas (used for logos and label sheets). */
  image(canvas, threshold = 170) {
    const w = Math.min(canvas.width, this.dots);
    const h = canvas.height;
    const bytesPerRow = Math.ceil(w / 8);
    const ctx = canvas.getContext("2d");
    const img = ctx.getImageData(0, 0, w, h).data;
    const data = new Uint8Array(bytesPerRow * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * canvas.width + x) * 4;
        const a = img[i + 3];
        const lum = a < 40 ? 255 : (img[i] * 0.299 + img[i + 1] * 0.587 + img[i + 2] * 0.114);
        if (lum < threshold) data[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    this.raw([0x1d, 0x76, 0x30, 0x00,
      bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff,
      h & 0xff, (h >> 8) & 0xff]);
    this.bytes(data);
    return this;
  }

  cut() { return this.feed(3).raw([0x1d, 0x56, 66, 0]); }
  drawer() { return this.raw([0x1b, 0x70, 0, 25, 250]); }

  build() {
    const total = this.parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    this.parts.forEach((p) => { out.set(p, o); o += p.length; });
    return out;
  }
  async print(opts) { return sendBytes(this.build(), opts); }
}
