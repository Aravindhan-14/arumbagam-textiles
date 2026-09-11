/* ============================================================
   VYRA SAREES - QR & barcode generation
   ------------------------------------------------------------
   Uses qrcodejs + JsBarcode (loaded from CDN in index.html) and
   renders onto canvases, which can be shown on screen, saved as
   PNG, or converted to ESC/POS raster data for the printer.
   ============================================================ */
import { esc } from "../utils.js";

const DPMM = 8;    // 203 dpi thermal head - 8 dots per mm
const PAD_MM = 2.5;  // quiet border kept clear on every sticker edge

/* ---------- QR ---------- */
export function qrCanvas(text, size = 220) {
  return new Promise((resolve, reject) => {
    if (typeof window.QRCode === "undefined") return reject(new Error("QR library not loaded"));
    const holder = document.createElement("div");
    holder.style.cssText = "position:absolute;left:-9999px;top:0";
    document.body.appendChild(holder);
    try {
      // eslint-disable-next-line no-new
      new window.QRCode(holder, {
        text: String(text),
        width: size, height: size,
        colorDark: "#000000", colorLight: "#ffffff",
        correctLevel: window.QRCode.CorrectLevel.M
      });
    } catch (e) { holder.remove(); return reject(e); }

    const finish = () => {
      const c = holder.querySelector("canvas");
      if (c) {
        const out = document.createElement("canvas");
        out.width = size; out.height = size;
        const ctx = out.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
        ctx.drawImage(c, 0, 0, size, size);
        holder.remove(); return resolve(out);
      }
      const img = holder.querySelector("img");
      if (img) {
        const draw = () => {
          const out = document.createElement("canvas");
          out.width = size; out.height = size;
          const ctx = out.getContext("2d");
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
          ctx.drawImage(img, 0, 0, size, size);
          holder.remove(); resolve(out);
        };
        if (img.complete && img.naturalWidth) draw(); else img.onload = draw;
        return;
      }
      holder.remove(); reject(new Error("QR render failed"));
    };
    setTimeout(finish, 30);
  });
}

export async function qrDataUrl(text, size = 220) {
  const c = await qrCanvas(text, size);
  return c.toDataURL("image/png");
}

/* ---------- Barcode ---------- */
export function barcodeCanvas(value, opts = {}) {
  if (typeof window.JsBarcode === "undefined") throw new Error("Barcode library not loaded");
  const canvas = document.createElement("canvas");
  const v = String(value || "").trim();
  const format = opts.format || (/^\d{13}$/.test(v) ? "EAN13" : /^\d{12}$/.test(v) ? "UPC" : "CODE128");
  try {
    window.JsBarcode(canvas, v, {
      format,
      width: opts.width || 2,
      height: opts.height || 60,
      displayValue: opts.displayValue !== false,
      fontSize: opts.fontSize || 14,
      textMargin: 2,
      margin: opts.margin ?? 6,
      background: "#ffffff",
      lineColor: "#000000"
    });
  } catch {
    window.JsBarcode(canvas, v, {
      format: "CODE128", width: opts.width || 2, height: opts.height || 60,
      displayValue: opts.displayValue !== false, fontSize: opts.fontSize || 14,
      margin: opts.margin ?? 6, background: "#ffffff", lineColor: "#000000"
    });
  }
  return canvas;
}
export const barcodeDataUrl = (value, opts) => barcodeCanvas(value, opts).toDataURL("image/png");

/* ---------- QR payload ---------- */
/** Compact, scanner-friendly payload that still identifies the product. */
export function qrPayload(product) {
  return product.barcode || product.sku || product.productCode || product.id;
}
/** Human-readable detail block, used on the QR preview screen. */
export function qrDetail(product) {
  return [
    `Product ID: ${product.productCode || product.id}`,
    `SKU: ${product.sku || "-"}`,
    `Product: ${product.productName || "-"}`
  ].join("\n");
}

/* ---------- Sticker label ---------- */
/**
 * Draw one product sticker onto a canvas at printer resolution.
 * opts = { widthMm, heightMm, type:"qr"|"barcode", showPrice, shopName }
 */
export async function labelCanvas(product, opts = {}) {
  const wMm = opts.widthMm || 50;
  const hMm = opts.heightMm || 30;
  const W = Math.round(wMm * DPMM);
  const H = Math.round(hMm * DPMM);
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";

  // Everything is laid inside a quiet border, and the whole sticker is
  // clipped, so nothing can ever reach its neighbour on the roll.
  const pad = Math.round(PAD_MM * DPMM);
  const safeW = W - pad * 2;
  const safeH = H - pad * 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad, pad, safeW, safeH);
  ctx.clip();

  const type = opts.type || "qr";
  const code = qrPayload(product);
  const price = "Rs." + Math.round(Number(product.sellingPrice) || 0);

  if (type === "qr") {
    // Square, so it is the sticker's height that limits it - and it is kept
    // well short of that, because a scanner needs the quiet zone around it
    // as much as the sticker needs its edge.
    const qs = Math.min(Math.round(safeH * 0.84), Math.round(safeW * 0.34));
    const qc = await qrCanvas(code, qs);
    const bridge = Math.round(1.5 * DPMM);

    const rows = [];
    if (opts.shopName) rows.push({ text: opts.shopName, px: H * 0.072, bold: true });
    rows.push({ text: product.productName || "", px: H * 0.095, bold: true });
    const meta = [product.colour, product.size].filter(Boolean).join(" · ");
    if (meta) rows.push({ text: meta, px: H * 0.068 });
    if (product.sku) rows.push({ text: product.sku, px: H * 0.072, mono: true });
    if (opts.showPrice !== false) rows.push({ text: price, px: H * 0.10, bold: true, gapBefore: H * 0.015 });

    // The code and its text are one block, and that block is centred in the
    // sticker. A sticker that comes off the roll a millimetre out of step
    // then shows as an even margin either side, instead of text running off
    // the edge on one of them.
    const measured = measureStack(ctx, rows, safeW - qs - bridge);
    const blockW = qs + bridge + Math.ceil(measured.width);
    const x0 = pad + Math.max(0, Math.round((safeW - blockW) / 2));

    ctx.drawImage(qc, x0, pad + Math.round((safeH - qs) / 2), qs, qs);
    drawStack(ctx, measured.rows, x0 + qs + bridge, pad, safeW - qs - bridge, safeH);
  } else {
    const rows = [{ text: product.productName || "", px: H * 0.09, bold: true, align: "center" }];
    if (product.sku) rows.push({ text: product.sku, px: H * 0.065, mono: true, align: "center" });
    if (opts.showPrice !== false) rows.push({ text: price, px: H * 0.095, bold: true, align: "center" });

    // Measure the text first; whatever is left over is the barcode's.
    const measured = measureStack(ctx, rows, safeW);
    const barH = Math.max(Math.round(H * 0.18), safeH - measured.height - Math.round(H * 0.08));
    const bc = barcodeCanvas(code, {
      height: barH, width: 2, displayValue: false, margin: 0
    });
    const bw = Math.min(safeW, bc.width);
    const bh = Math.round(bc.height * (bw / bc.width));

    const blockH = measured.height + bh + Math.round(H * 0.02);
    let y = pad + Math.max(0, Math.round((safeH - blockH) / 2));
    y = drawRow(ctx, measured.rows[0], pad, y, safeW);                  // name
    ctx.drawImage(bc, pad + Math.round((safeW - bw) / 2), y, bw, bh);
    y += bh + Math.round(H * 0.02);
    for (const row of measured.rows.slice(1)) y = drawRow(ctx, row, pad, y, safeW);
  }

  ctx.restore();
  return canvas;
}

/* ---------- text that always fits ---------- */
const fontOf = (r) => `${r.bold ? "bold " : ""}${Math.round(r.px)}px ${r.mono ? '"Consolas",monospace' : "Arial, sans-serif"}`;

/**
 * Shrink a line until it fits the width, and only then clip it short.
 * Text on a 50mm sticker has nowhere to overflow to, so it must give way.
 */
function fitRow(ctx, row, maxWidth) {
  const out = { ...row, text: String(row.text || "") };
  const floor = Math.max(6, row.px * 0.62);
  while (out.px > floor) {
    ctx.font = fontOf(out);
    if (ctx.measureText(out.text).width <= maxWidth) return out;
    out.px -= 1;
  }
  ctx.font = fontOf(out);
  out.text = fit(ctx, out.text, maxWidth);
  return out;
}

function measureStack(ctx, rows, maxWidth) {
  const fitted = rows.map((r) => fitRow(ctx, r, maxWidth));
  const height = fitted.reduce((a, r) => a + r.px * 1.3 + (r.gapBefore || 0), 0);
  const width = fitted.reduce((a, r) => {
    ctx.font = fontOf(r);
    return Math.max(a, ctx.measureText(r.text).width);
  }, 0);
  return { rows: fitted, height, width };
}

function drawRow(ctx, row, x, y, boxWidth) {
  y += row.gapBefore || 0;
  ctx.font = fontOf(row);
  ctx.textAlign = row.align === "center" ? "center" : "left";
  ctx.fillText(row.text, row.align === "center" ? x + boxWidth / 2 : x, y);
  ctx.textAlign = "left";
  return y + row.px * 1.3;
}

/** Lay a column of lines out, centred in the space and squeezed if too tall. */
function drawStack(ctx, rows, x, top, maxWidth, maxHeight) {
  let m = measureStack(ctx, rows, maxWidth);
  if (m.height > maxHeight) {
    const shrink = maxHeight / m.height;
    m = measureStack(ctx, rows.map((r) => ({ ...r, px: r.px * shrink, gapBefore: (r.gapBefore || 0) * shrink })), maxWidth);
  }
  let y = top + Math.max(0, (maxHeight - m.height) / 2);
  for (const row of m.rows) y = drawRow(ctx, row, x, y, maxWidth);
}

/**
 * One printed row of the label roll.
 * The roll carries two stickers side by side, so a row is the real page the
 * printer feeds: the same product's sticker repeated across it, with the
 * roll's gap in between.
 * opts = labelCanvas's, plus { across, gapMm }
 */
export async function labelRowCanvas(product, opts = {}) {
  const across = Math.max(1, Math.round(opts.across || 1));
  const one = await labelCanvas(product, opts);
  const gap = Math.round(Math.max(0, opts.gapMm ?? 0) * DPMM);
  const dx = Math.round((opts.shiftXMm || 0) * DPMM);
  const dy = Math.round((opts.shiftYMm || 0) * DPMM);
  if (across === 1 && !dx && !dy) return one;

  const cell = one.width + gap;
  const canvas = document.createElement("canvas");
  canvas.width = one.width * across + gap * (across - 1);
  canvas.height = one.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Every sticker in the row carries the same artwork, so the pattern can be
  // slid sideways and simply repeats: one spare copy at each end means a
  // sideways nudge never leaves a bald patch. That nudge is how a roll whose
  // stickers do not start where the paper starts is brought back into line.
  for (let i = -1; i <= across; i++) ctx.drawImage(one, i * cell + dx, dy);
  return canvas;
}

/**
 * A measuring print: one row drawn with its own ruler.
 * Printed and held against a tape it answers the only question that
 * matters - is the paper coming out of the printer the size the app
 * thinks it is? Each sticker carries a frame on its true edge, corner
 * marks, and a scale in centimetres.
 */
export function calibrationRowCanvas({ widthMm = 50, heightMm = 25, across = 2, gapMm = 0, shiftXMm = 0, shiftYMm = 0 } = {}) {
  const rowMm = labelRowWidthMm({ widthMm, across, gapMm });
  const W = Math.round(rowMm * DPMM);
  const H = Math.round(heightMm * DPMM);
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.textBaseline = "top";

  const lw = Math.round(widthMm * DPMM);
  const gap = Math.round(gapMm * DPMM);
  const dx = Math.round(shiftXMm * DPMM);
  const dy = Math.round(shiftYMm * DPMM);

  ctx.translate(dx, dy);
  for (let i = -1; i <= across; i++) {
    const x0 = i * (lw + gap);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 0, lw, H);
    ctx.clip();

    // The frame sits on the sticker's own edge: if it prints inside the
    // sticker, the size is right; if it is cut off, it is not.
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 + 1, 1, lw - 2, H - 2);

    // Corner marks, 5mm along each edge.
    const armLen = 5 * DPMM;
    ctx.lineWidth = 3;
    [[0, 0, 1, 1], [lw, 0, -1, 1], [0, H, 1, -1], [lw, H, -1, -1]].forEach(([cx, cy, sx, sy]) => {
      ctx.beginPath();
      ctx.moveTo(x0 + cx + sx * armLen, cy);
      ctx.lineTo(x0 + cx, cy);
      ctx.lineTo(x0 + cx, cy + sy * armLen);
      ctx.stroke();
    });

    // Ruler along the bottom: a tick every millimetre, taller every 5 and 10.
    const base = H - Math.round(2 * DPMM);
    ctx.lineWidth = 1;
    for (let mm = 0; mm <= widthMm; mm++) {
      const x = x0 + Math.round(mm * DPMM);
      const len = mm % 10 === 0 ? 5 * DPMM * 0.8 : mm % 5 === 0 ? 3 * DPMM * 0.6 : DPMM;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, base);
      ctx.lineTo(x + 0.5, base - len);
      ctx.stroke();
      if (mm % 10 === 0 && mm > 0 && mm < widthMm) {
        ctx.font = `${Math.round(2.2 * DPMM)}px Arial, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(String(mm / 10), x, base + 1);
        ctx.textAlign = "left";
      }
    }

    ctx.font = `bold ${Math.round(3 * DPMM)}px Arial, sans-serif`;
    ctx.fillText(`${widthMm} x ${heightMm} mm`, x0 + Math.round(3 * DPMM), Math.round(3 * DPMM));
    ctx.font = `${Math.round(2.2 * DPMM)}px Arial, sans-serif`;
    ctx.fillText(`label ${i + 1} of ${across}`, x0 + Math.round(3 * DPMM), Math.round(7 * DPMM));
    ctx.fillText(`row ${rowMm} mm`, x0 + Math.round(3 * DPMM), Math.round(10 * DPMM));
    ctx.restore();
  }
  return canvas;
}

/** Width in mm of one printed row for the given label settings. */
export function labelRowWidthMm({ widthMm = 50, across = 1, gapMm = 0 } = {}) {
  const n = Math.max(1, Math.round(across));
  return widthMm * n + gapMm * (n - 1);
}

function fit(ctx, text, maxWidth) {
  let s = String(text || "");
  if (ctx.measureText(s).width <= maxWidth) return s;
  while (s.length > 1 && ctx.measureText(s + "…").width > maxWidth) s = s.slice(0, -1);
  return s + "…";
}

/* ---------- on-screen preview markup ---------- */
export function labelPreviewHtml(product, settings = {}, type = "qr") {
  return `<div class="label-cell">
    ${settings.labelShowShopName ? `<div class="sk">${esc(settings.businessName || "")}</div>` : ""}
    <div class="nm">${esc(product.productName || "")}</div>
    <div data-code-slot data-type="${type}" data-value="${esc(qrPayload(product))}"></div>
    <div class="sk">${esc(product.sku || "")}</div>
    <div class="pr">Rs.${Math.round(Number(product.sellingPrice) || 0)}</div>
  </div>`;
}

/** Fill every [data-code-slot] in a container with a rendered code. */
export async function hydrateCodeSlots(root, size = 90) {
  const slots = [...root.querySelectorAll("[data-code-slot]")];
  for (const slot of slots) {
    if (slot.dataset.done) continue;
    const value = slot.dataset.value;
    try {
      const c = slot.dataset.type === "barcode"
        ? barcodeCanvas(value, { height: 44, width: 1.6, fontSize: 11, margin: 2 })
        : await qrCanvas(value, size);
      c.style.maxWidth = "100%"; c.style.height = "auto";
      slot.innerHTML = ""; slot.appendChild(c);
      slot.dataset.done = "1";
    } catch (e) { slot.textContent = value; }
  }
}
