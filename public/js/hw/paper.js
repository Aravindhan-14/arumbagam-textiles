/* ============================================================
   VYRA SAREES - paper documents drawn as artwork
   ------------------------------------------------------------
   A label printer such as the TVS LP 46 Lite does not understand
   ESC/POS, so a bill cannot simply be a stream of receipt codes.
   PaperDoc offers the same shape as the Escpos builder, but
   paints onto a canvas instead. The finished page then goes to
   the printer through its own Windows driver, which every
   printer in the shop understands.

   Because the two builders share an interface, one receipt
   layout in documents.js serves both.
   ============================================================ */
import { qrCanvas, barcodeCanvas } from "../codes/codes.js";
import { printCanvas } from "./printer.js";

const DPMM = 8;              // 203 dpi print head - 8 dots per mm
const MARGIN_MM = 2;

export class PaperDoc {
  constructor(width = 80, { dpmm = DPMM } = {}) {
    this.width = width;                                   // paper width in mm
    this.dpmm = dpmm;
    this.pad = Math.round(MARGIN_MM * dpmm);
    this.W = Math.round(width * dpmm);
    this.inner = this.W - this.pad * 2;
    this.cols = width >= 100 ? 64 : width === 80 ? 48 : 32;
    this.dots = this.inner;
    this.ops = [];
    this.buf = "";
    this.st = { align: "left", bold: false, w: 1, h: 1, underline: false };
  }

  /* ---------- recording ---------- */
  get style() { return { ...this.st }; }
  push(op) { this.ops.push(op); return this; }

  raw() { return this; }                                  // ESC/POS control codes: nothing to draw
  bytes() { return this; }

  text(str = "") {
    this.buf += String(str);
    let i = this.buf.indexOf("\n");
    while (i >= 0) {
      this.push({ t: "text", s: this.buf.slice(0, i), st: this.style });
      this.buf = this.buf.slice(i + 1);
      i = this.buf.indexOf("\n");
    }
    return this;
  }
  line(str = "") { return this.text(str + "\n"); }
  flush() { if (this.buf) { this.push({ t: "text", s: this.buf, st: this.style }); this.buf = ""; } return this; }
  feed(n = 1) { this.flush(); return this.push({ t: "feed", n: Math.max(1, n) }); }

  align(a) { this.flush(); this.st.align = a === "center" ? "center" : a === "right" ? "right" : "left"; return this; }
  bold(on) { this.flush(); this.st.bold = !!on; return this; }
  underline(on) { this.flush(); this.st.underline = !!on; return this; }
  size(w = 1, h = 1) { this.flush(); this.st.w = Math.max(1, w); this.st.h = Math.max(1, h); return this; }
  invert() { return this; }

  rule(ch = "-") { return this.line(ch.repeat(Math.floor(this.cols / this.st.w))); }
  lr(left, right) {
    const cols = Math.floor(this.cols / this.st.w);
    const l = String(left), r = String(right).replace(/₹/g, "Rs.");
    const pad = Math.max(1, cols - l.length - r.length);
    return this.line(l + " ".repeat(pad) + r);
  }
  row3(name, qty, amount) {
    const cols = Math.floor(this.cols / this.st.w);
    const qw = 5, aw = cols >= 48 ? 12 : 9;
    const nw = cols - qw - aw;
    const n = String(name).slice(0, nw).padEnd(nw);
    const q = String(qty).padStart(qw);
    const a = String(amount).replace(/₹/g, "").padStart(aw);
    return this.line(n + q + a);
  }
  center(str) { this.align("center"); this.line(str); return this.align("left"); }

  qr(data, moduleSize = 6) {
    this.flush();
    const size = Math.min(this.inner, Math.round(moduleSize * this.dpmm * 4.5));
    return this.push({ t: "qr", data: String(data), size });
  }
  barcode128(value, height = 60, hri = true) {
    this.flush();
    return this.push({ t: "barcode", value: String(value), height, hri });
  }
  image(canvas) { this.flush(); return this.push({ t: "img", canvas }); }

  cut() { this.flush(); return this.push({ t: "feed", n: 2 }); }
  drawer() { return this; }

  /* ---------- painting ---------- */
  /** Resolve the codes, which need a round trip through their libraries. */
  async prepare() {
    for (const op of this.ops) {
      if (op.t === "qr" && !op.canvas) op.canvas = await qrCanvas(op.data, op.size);
      if (op.t === "barcode" && !op.canvas) {
        op.canvas = barcodeCanvas(op.value, {
          height: op.height * 1.6,
          width: 2,
          displayValue: op.hri !== false,
          fontSize: Math.round(this.dpmm * 2.6),
          margin: 4
        });
      }
    }
    return this;
  }

  /** Font size at which `cols` characters fill the printable width. */
  metrics(ctx) {
    ctx.font = '100px "Consolas","Courier New",monospace';
    const advance = ctx.measureText("0".repeat(10)).width / 10 / 100;
    const fontPx = Math.floor(this.inner / this.cols / advance);
    return { fontPx, lineH: Math.round(fontPx * 1.32) };
  }

  /** Walk the ops once, either measuring (draw = null) or painting. */
  run(ctx, m, draw) {
    let y = this.pad;
    for (const op of this.ops) {
      if (op.t === "text") {
        const st = op.st;
        const lineH = m.lineH * st.h;
        const cols = Math.max(1, Math.floor(this.cols / st.w));
        const chunks = wrap(op.s, cols);
        for (const s of chunks) {
          if (draw && s) {
            ctx.save();
            ctx.font = `${st.bold ? "bold " : ""}${m.fontPx}px "Consolas","Courier New",monospace`;
            ctx.textBaseline = "top";
            // ESC/POS multiplies the character cell, so height and width
            // stretch independently - a scale, not a bigger font.
            ctx.scale(st.w, st.h);
            const w = ctx.measureText(s).width;
            const slack = this.inner - w * st.w;
            const off = st.align === "center" ? slack / 2 : st.align === "right" ? slack : 0;
            const x = (this.pad + off) / st.w;
            ctx.fillText(s, x, (y + lineH * 0.12) / st.h);
            if (st.underline) {
              ctx.fillRect(x, (y + lineH * 0.92) / st.h, w, Math.max(1, m.fontPx * 0.06) / st.h);
            }
            ctx.restore();
          }
          y += lineH;
        }
        continue;
      }
      if (op.t === "feed") { y += m.lineH * op.n * 0.7; continue; }
      if (op.t === "qr" || op.t === "barcode" || op.t === "img") {
        const c = op.canvas;
        if (!c) continue;
        const w = Math.min(this.inner, c.width);
        const h = Math.round(c.height * (w / c.width));
        if (draw) ctx.drawImage(c, this.pad + (this.inner - w) / 2, y, w, h);
        y += h + Math.round(m.lineH * 0.25);
      }
    }
    return y + this.pad;
  }

  async render() {
    await this.prepare();
    this.flush();
    const probe = document.createElement("canvas").getContext("2d");
    const m = this.metrics(probe);
    const height = Math.max(this.dpmm * 10, Math.ceil(this.run(probe, m, false)));

    const canvas = document.createElement("canvas");
    canvas.width = this.W;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";
    this.run(ctx, m, true);
    return canvas;
  }

  /** Height of the finished page in millimetres. */
  heightMm(canvas) { return Math.max(10, Math.ceil(canvas.height / this.dpmm)); }

  async print(opts = {}) {
    const canvas = await this.render();
    return printCanvas(canvas, {
      widthMm: this.width,
      heightMm: this.heightMm(canvas),
      ...opts
    });
  }
}

/** Break a line that is wider than the paper, keeping words whole. */
function wrap(text, cols) {
  const s = String(text);
  if (s.length <= cols) return [s];
  const out = [];
  let line = "";
  for (const word of s.split(" ")) {
    if (!line.length) { line = word; continue; }
    if ((line + " " + word).length <= cols) { line += " " + word; continue; }
    out.push(line); line = word;
  }
  if (line) out.push(line);
  return out.flatMap((l) => (l.length <= cols ? [l] : l.match(new RegExp(`.{1,${cols}}`, "g")) || [l]));
}
