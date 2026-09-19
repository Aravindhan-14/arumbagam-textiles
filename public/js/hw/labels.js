/* ============================================================
   VYRA SAREES - product stickers
   ------------------------------------------------------------
   Everything about the sticker roll lives here, and nothing else
   does. The shop's roll carries two 50 x 25 mm stickers side by
   side, so the page the printer feeds is one 100 x 25 mm ROW,
   never a single sticker. Ten labels are five rows of two.

       one sticker      50 x 25 mm     400 x 200 dots
       one row (x2)    100 x 25 mm     800 x 200 dots

   Artwork is drawn at the print head's own 203 dpi, one dot per
   pixel, and sent at its true physical size, so what is measured
   on screen is what comes off the roll. Every sticker is clipped
   to its own edges and its content is centred inside them, so a
   roll that runs a millimetre out of step shows an even margin
   rather than text crossing onto the sticker next door.
   ============================================================ */
import { qrCanvas, barcodeCanvas, qrPayload } from "../codes/codes.js";
import { printCanvasRun, labelPrinter, labelRotation } from "./printer.js";
import { toInt, toNum } from "../utils.js";

const DPMM = 8;        // 203 dpi print head, 8 dots per millimetre
const PAD_Y_MM = 2.5;  // quiet border kept clear along the top and bottom
const PAD_X_MM = 5;    // a wider one at the sides, so nothing crowds the edge
const mm = (v) => Math.round(v * DPMM);

/* ============================================================
   The roll, as the shop has it
   ============================================================ */
export function labelPlan(settings = {}) {
  const widthMm = Math.max(10, toNum(settings.labelWidthMm, 50));
  const heightMm = Math.max(10, toNum(settings.labelHeightMm, 25));
  const across = Math.min(4, Math.max(1, toInt(settings.labelsPerRow, 2)));
  const gapMm = Math.max(0, toNum(settings.labelGapMm, 0));
  return {
    widthMm,
    heightMm,
    across,
    gapMm,
    rowWidthMm: widthMm * across + gapMm * (across - 1),
    shiftXMm: toNum(settings.labelShiftXMm, 0),
    shiftYMm: toNum(settings.labelShiftYMm, 0),
    showPrice: settings.labelShowPrice !== false,
    shopName: settings.labelShowShopName ? (settings.businessName || "") : ""
  };
}

/* ============================================================
   One sticker
   ============================================================ */
/** type is "qr" or "barcode". The canvas is exactly the sticker. */
export async function buildLabel(product, plan, type = "qr") {
  const W = mm(plan.widthMm);
  const H = mm(plan.heightMm);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";

  const padX = mm(PAD_X_MM);
  const padY = mm(PAD_Y_MM);
  const safeW = W - padX * 2;
  const safeH = H - padY * 2;

  // Nothing may leave the sticker, whatever the product is called.
  ctx.save();
  ctx.beginPath();
  ctx.rect(padX, padY, safeW, safeH);
  ctx.clip();

  const code = qrPayload(product);
  const price = "Rs." + Math.round(toNum(product.sellingPrice));

  if (type === "barcode") {
    const rows = [
      { text: product.productName || "", px: H * 0.10, bold: true },
      // The code is set at the price's size so it reads from a distance, and
      // kept thin and light so the price is still the louder of the two.
      ...(product.sku ? [{ text: product.sku, px: H * 0.125, code: true }] : []),
      ...(plan.showPrice ? [{ text: price, px: H * 0.125, heavy: true }] : [])
    ];
    const text = measure(ctx, rows, safeW);
    const barH = Math.max(mm(4), safeH - text.height - mm(1));
    const bars = barcodeCanvas(code, { height: barH, width: 2, displayValue: false, margin: 0 });
    const bw = Math.min(safeW, bars.width);
    const bh = Math.round(bars.height * (bw / bars.width));

    let y = padY + Math.max(0, Math.round((safeH - (text.height + bh + mm(1))) / 2));
    y = write(ctx, text.rows[0], padX, y, safeW, "center");
    ctx.drawImage(bars, padX + Math.round((safeW - bw) / 2), y, bw, bh);
    y += bh + mm(1);
    for (const row of text.rows.slice(1)) y = write(ctx, row, padX, y, safeW, "center");
  } else {
    // A square code beside its text, the pair centred as one block.
    const qs = Math.min(Math.round(safeH * 0.86), Math.round(safeW * 0.34));
    const img = await qrCanvas(code, qs);
    const bridge = mm(1.5);

    const rows = [
      ...(plan.shopName ? [{ text: plan.shopName, px: H * 0.072, bold: true }] : []),
      { text: product.productName || "", px: H * 0.095, bold: true },
      ...(metaOf(product) ? [{ text: metaOf(product), px: H * 0.068 }] : []),
      ...(product.sku ? [{ text: product.sku, px: H * 0.125, code: true }] : []),
      ...(plan.showPrice ? [{ text: price, px: H * 0.125, heavy: true, gapBefore: H * 0.015 }] : [])
    ];
    const text = measure(ctx, rows, safeW - qs - bridge);
    const blockW = qs + bridge + Math.ceil(text.width);
    const x = padX + Math.max(0, Math.round((safeW - blockW) / 2));

    ctx.drawImage(img, x, padY + Math.round((safeH - qs) / 2), qs, qs);
    let y = padY + Math.max(0, Math.round((safeH - text.height) / 2));
    for (const row of text.rows) y = write(ctx, row, x + qs + bridge, y, safeW - qs - bridge);
  }

  ctx.restore();
  return canvas;
}

const metaOf = (p) => [p.colour, p.size].filter(Boolean).join(" · ");

/* ============================================================
   One row - the page the printer actually feeds
   ============================================================ */
export async function buildRow(product, plan, type = "qr") {
  const one = await buildLabel(product, plan, type);
  const cell = one.width + mm(plan.gapMm);
  const canvas = document.createElement("canvas");
  canvas.width = one.width * plan.across + mm(plan.gapMm) * (plan.across - 1);
  canvas.height = one.height;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Each sticker in the row carries the same artwork, so the pattern repeats
  // and can be slid sideways to line up with a roll whose stickers do not
  // start where the paper does. A spare copy at each end fills the ends.
  const dx = mm(plan.shiftXMm);
  const dy = mm(plan.shiftYMm);
  for (let i = -1; i <= plan.across; i++) ctx.drawImage(one, i * cell + dx, dy);
  return canvas;
}

/* ============================================================
   The measuring row - a ruler at the row's true size
   ============================================================ */
export function buildSizeTest(plan) {
  const W = mm(plan.rowWidthMm);
  const H = mm(plan.heightMm);
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.textBaseline = "top";
  ctx.translate(mm(plan.shiftXMm), mm(plan.shiftYMm));

  const lw = mm(plan.widthMm);
  const cell = lw + mm(plan.gapMm);

  for (let i = -1; i <= plan.across; i++) {
    const x0 = i * cell;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 0, lw, H);
    ctx.clip();

    // A frame on the sticker's own edge: inside the sticker means the size is
    // right, cut off means it is not.
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 + 1, 1, lw - 2, H - 2);

    ctx.lineWidth = 3;
    const arm = mm(5);
    [[0, 0, 1, 1], [lw, 0, -1, 1], [0, H, 1, -1], [lw, H, -1, -1]].forEach(([cx, cy, sx, sy]) => {
      ctx.beginPath();
      ctx.moveTo(x0 + cx + sx * arm, cy);
      ctx.lineTo(x0 + cx, cy);
      ctx.lineTo(x0 + cx, cy + sy * arm);
      ctx.stroke();
    });

    ctx.lineWidth = 1;
    const base = H - mm(2);
    for (let t = 0; t <= plan.widthMm; t++) {
      const x = x0 + mm(t);
      const len = t % 10 === 0 ? mm(4) : t % 5 === 0 ? mm(2) : mm(1);
      ctx.beginPath();
      ctx.moveTo(x + 0.5, base);
      ctx.lineTo(x + 0.5, base - len);
      ctx.stroke();
      if (t % 10 === 0 && t > 0 && t < plan.widthMm) {
        ctx.font = `${mm(2.2)}px Arial, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(String(t / 10), x, base + 1);
        ctx.textAlign = "left";
      }
    }

    ctx.font = `bold ${mm(3)}px Arial, sans-serif`;
    ctx.fillText(`${plan.widthMm} x ${plan.heightMm} mm`, x0 + mm(3), mm(2.5));
    ctx.font = `${mm(2.2)}px Arial, sans-serif`;
    ctx.fillText(`row ${plan.rowWidthMm} mm, ${plan.across} across`, x0 + mm(3), mm(6.5));
    ctx.restore();
  }
  return canvas;
}

/* ============================================================
   Printing
   ============================================================ */
/**
 * jobs = [{ product, qty, type }]
 * A row prints `across` stickers at once, so an odd count rounds up and the
 * last row still comes out full.
 */
export async function printLabels(jobs, settings, onProgress) {
  const plan = labelPlan(settings);
  const total = jobs.reduce((a, j) => a + Math.max(1, toNum(j.qty, 1)), 0);
  const pages = [];
  let done = 0;

  for (const job of jobs) {
    if (!job.product) continue;
    const canvas = await buildRow(job.product, plan, job.type || "qr");
    const wanted = Math.max(1, toNum(job.qty, 1));
    const rows = Math.ceil(wanted / plan.across);
    pages.push({ canvas, copies: rows });
    done = Math.min(total, done + rows * plan.across);
    if (onProgress) onProgress(done, total);
  }

  await send(pages, plan, "VYRA SAREES labels");
  return total;
}

/** One product, one row. */
export async function printProductLabel(product, settings, type = "qr", copies = 1) {
  return printLabels([{ product, qty: copies, type }], settings);
}

/** One measuring row, for setting the printer up. */
export async function printSizeTest(settings) {
  const plan = labelPlan(settings);
  await send([{ canvas: buildSizeTest(plan), copies: 1 }], plan, "VYRA SAREES size test");
  return plan;
}

function send(pages, plan, title) {
  return printCanvasRun(pages, {
    widthMm: plan.rowWidthMm,
    heightMm: plan.heightMm,
    rotate: labelRotation(),
    printer: labelPrinter(),
    title
  });
}

/* ============================================================
   Text that always fits
   ------------------------------------------------------------
   A sticker has nowhere to overflow to, so a line that is too
   wide gives way: it shrinks first, and is cut short only when
   shrinking is no longer decent.
   ============================================================ */
const fontOf = (r) => {
  const weight = r.heavy ? "900 " : (r.bold || r.code) ? "bold " : "";
  const family = r.mono ? '"Consolas",monospace'
    : r.code ? '"Segoe UI","Helvetica Neue",Arial,sans-serif'
      : r.heavy ? '"Arial Black","Arial Bold",Arial,sans-serif'
        : "Arial, sans-serif";
  return `${weight}${Math.round(r.px)}px ${family}`;
};

function fitOne(ctx, row, maxWidth) {
  const out = { ...row, text: String(row.text || "") };
  const floor = Math.max(6, row.px * 0.62);
  while (out.px > floor) {
    ctx.font = fontOf(out);
    if (ctx.measureText(out.text).width <= maxWidth) return out;
    out.px -= 1;
  }
  ctx.font = fontOf(out);
  let t = out.text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
  out.text = t === out.text ? t : t + "…";
  return out;
}

function measure(ctx, rows, maxWidth) {
  const fitted = rows.map((r) => fitOne(ctx, r, maxWidth));
  return {
    rows: fitted,
    height: fitted.reduce((a, r) => a + r.px * 1.3 + (r.gapBefore || 0), 0),
    width: fitted.reduce((a, r) => { ctx.font = fontOf(r); return Math.max(a, ctx.measureText(r.text).width); }, 0)
  };
}

function write(ctx, row, x, y, boxWidth, align = "left") {
  y += row.gapBefore || 0;
  ctx.font = fontOf(row);
  ctx.textAlign = align === "center" ? "center" : "left";
  ctx.fillText(row.text, align === "center" ? x + boxWidth / 2 : x, y);
  ctx.textAlign = "left";
  return y + row.px * 1.3;
}
