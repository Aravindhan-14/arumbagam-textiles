/* ============================================================
   VYRA SAREES - Bluetooth thermal printer (ESC/POS)
   ------------------------------------------------------------
   Primary transport is Web Bluetooth (Chrome on Android), which
   talks straight to the printer's serial GATT characteristic.
   Two fallbacks are provided for phones/browsers without it:
     - RawBT  : hands the raw ESC/POS bytes to the RawBT app
     - Browser: renders the receipt and calls window.print()
   ============================================================ */

/* Serial-over-GATT service UUIDs used by common 58/80mm printers. */
const SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",   // most Chinese ESC/POS printers
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb",   // HM-10 style modules
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",   // Microchip / ISSC (Zebra, some Epson)
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2"
];

const CHUNK = 180;
const state = {
  device: null,
  characteristic: null,
  width: 58,            // paper width in mm
  name: "",
  mode: localStorage.getItem("vyra.printMode") || "auto"   // auto | bluetooth | rawbt | browser
};

export const supportsWebBluetooth = () => !!navigator.bluetooth;
export const isConnected = () => !!state.characteristic;
export const printerName = () => state.name;
export const printerMode = () => state.mode;
export function setPrinterMode(m) { state.mode = m; localStorage.setItem("vyra.printMode", m); }
export function setPaperWidth(mm) { state.width = Number(mm) === 80 ? 80 : 58; }
export const paperWidth = () => state.width;
/** Characters per line for the current paper width (Font A). */
export const lineChars = () => (state.width === 80 ? 48 : 32);
/** Printable dots for the current paper width. */
export const lineDots = () => (state.width === 80 ? 576 : 384);

/* ---------- connection ---------- */
export async function connectPrinter() {
  if (!navigator.bluetooth) throw new Error("This browser does not support Bluetooth printing. Use Chrome on Android, or switch to RawBT in Settings.");

  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: SERVICES
  });
  state.device = device;
  state.name = device.name || "Thermal printer";
  device.addEventListener("gattserverdisconnected", () => {
    state.characteristic = null;
    window.dispatchEvent(new CustomEvent("printer-status", { detail: { connected: false } }));
  });

  const server = await device.gatt.connect();
  let chosen = null;
  const services = await server.getPrimaryServices();
  for (const svc of services) {
    let chars = [];
    try { chars = await svc.getCharacteristics(); } catch { continue; }
    for (const ch of chars) {
      if (ch.properties.write || ch.properties.writeWithoutResponse) { chosen = ch; break; }
    }
    if (chosen) break;
  }
  if (!chosen) { try { device.gatt.disconnect(); } catch {} throw new Error("No writable channel found on this device. Is it an ESC/POS printer?"); }

  state.characteristic = chosen;
  localStorage.setItem("vyra.printerName", state.name);
  window.dispatchEvent(new CustomEvent("printer-status", { detail: { connected: true, name: state.name } }));
  return state.name;
}

export function disconnectPrinter() {
  try { state.device?.gatt?.disconnect(); } catch {}
  state.characteristic = null; state.device = null;
  window.dispatchEvent(new CustomEvent("printer-status", { detail: { connected: false } }));
}

async function writeRaw(bytes) {
  const ch = state.characteristic;
  if (!ch) throw new Error("Printer is not connected. Please connect the Bluetooth thermal printer.");
  const write = ch.properties.writeWithoutResponse && ch.writeValueWithoutResponse
    ? (b) => ch.writeValueWithoutResponse(b)
    : (b) => ch.writeValue(b);
  for (let i = 0; i < bytes.length; i += CHUNK) {
    await write(bytes.slice(i, i + CHUNK));
    await new Promise((r) => setTimeout(r, 18));
  }
}

/** Send ESC/POS bytes through whichever transport is available. */
export async function sendBytes(bytes) {
  const mode = state.mode;
  if (mode === "rawbt") return sendViaRawBT(bytes);
  if (mode === "bluetooth" || state.characteristic) return writeRaw(bytes);
  if (navigator.bluetooth) { await connectPrinter(); return writeRaw(bytes); }
  // The rawbt: link only leads anywhere on Android; elsewhere say so plainly
  // instead of appearing to print and doing nothing.
  if (/android/i.test(navigator.userAgent)) return sendViaRawBT(bytes);
  throw new Error('No thermal printer is connected. Connect the Bluetooth printer, or set Print mode to "Browser print" in Settings.');
}

/** Hand the job to the RawBT Android app (rawbt:base64,...). */
export function sendViaRawBT(bytes) {
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  const url = "rawbt:base64," + btoa(bin);
  const a = document.createElement("a");
  a.href = url; a.style.display = "none";
  document.body.appendChild(a); a.click();
  setTimeout(() => a.remove(), 800);
}

/* ============================================================
   ESC/POS builder
   ============================================================ */
export class Escpos {
  constructor(width = state.width) {
    this.parts = [];
    this.width = width;
    this.cols = width === 80 ? 48 : 32;
    this.dots = width === 80 ? 576 : 384;
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
      .replace(/[–—]/g, "-").replace(/ /g, " ");
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
    const qw = 5, aw = this.cols === 48 ? 12 : 9;
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
  async print() { return sendBytes(this.build()); }
}

/* ---------- browser print fallback ---------- */
/**
 * Opens the job in a window and calls print(), so any printer installed in
 * Windows (USB label printers included) can be used from the print dialog.
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
  if (state.characteristic) return { ok: true, text: `Connected · ${state.name}` };
  if (state.mode === "rawbt") return { ok: true, text: "RawBT app (Android)" };
  if (state.mode === "browser") return { ok: true, text: "Browser print" };
  if (!navigator.bluetooth) return { ok: false, text: "Web Bluetooth unavailable - use RawBT" };
  return { ok: false, text: "Not connected" };
}
