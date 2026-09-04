/* ============================================================
   VYRA SAREES - QR & barcode generation
   ------------------------------------------------------------
   Uses qrcodejs + JsBarcode (loaded from CDN in index.html) and
   renders onto canvases, which can be shown on screen, saved as
   PNG, or converted to ESC/POS raster data for the printer.
   ============================================================ */
import { esc } from "../utils.js";

const DPMM = 8;    // 203 dpi thermal head ≈ 8 dots per mm

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
  const hMm = opts.heightMm || 25;
  const W = Math.round(wMm * DPMM);
  const H = Math.round(hMm * DPMM);
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";

  const pad = Math.round(W * 0.03);
  const type = opts.type || "qr";
  const code = qrPayload(product);

  if (type === "qr") {
    const qs = Math.min(H - pad * 2, Math.round(W * 0.38));
    const qc = await qrCanvas(code, qs);
    ctx.drawImage(qc, pad, Math.round((H - qs) / 2), qs, qs);

    const tx = pad * 2 + qs;
    const tw = W - tx - pad;
    let y = pad + 2;
    if (opts.shopName) {
      ctx.font = `bold ${Math.round(H * 0.11)}px Arial`;
      ctx.fillText(fit(ctx, opts.shopName, tw), tx, y); y += Math.round(H * 0.14);
    }
    ctx.font = `bold ${Math.round(H * 0.14)}px Arial`;
    ctx.fillText(fit(ctx, product.productName || "", tw), tx, y); y += Math.round(H * 0.18);
    ctx.font = `${Math.round(H * 0.11)}px Arial`;
    const meta = [product.colour, product.size].filter(Boolean).join(" · ");
    if (meta) { ctx.fillText(fit(ctx, meta, tw), tx, y); y += Math.round(H * 0.14); }
    ctx.font = `${Math.round(H * 0.115)}px Consolas, monospace`;
    ctx.fillText(fit(ctx, product.sku || "", tw), tx, y); y += Math.round(H * 0.15);
    if (opts.showPrice !== false) {
      ctx.font = `bold ${Math.round(H * 0.17)}px Arial`;
      ctx.fillText("Rs." + Math.round(Number(product.sellingPrice) || 0), tx, y);
    }
  } else {
    let y = pad;
    ctx.font = `bold ${Math.round(H * 0.13)}px Arial`;
    ctx.textAlign = "center";
    ctx.fillText(fit(ctx, product.productName || "", W - pad * 2), W / 2, y);
    y += Math.round(H * 0.17);
    const bc = barcodeCanvas(code, { height: Math.round(H * 0.42), width: 2, fontSize: Math.round(H * 0.13), margin: 0 });
    const bw = Math.min(W - pad * 2, bc.width);
    const bh = Math.round(bc.height * (bw / bc.width));
    ctx.drawImage(bc, (W - bw) / 2, y, bw, bh);
    y += bh + 2;
    ctx.font = `bold ${Math.round(H * 0.15)}px Arial`;
    if (opts.showPrice !== false) ctx.fillText("Rs." + Math.round(Number(product.sellingPrice) || 0), W / 2, y);
    ctx.textAlign = "left";
  }
  return canvas;
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
