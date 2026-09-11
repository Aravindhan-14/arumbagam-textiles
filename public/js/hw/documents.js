/* ============================================================
   VYRA SAREES - printable documents
   ------------------------------------------------------------
   Builds the bill, an HTML twin used for on-screen preview and
   browser printing, and the QR / barcode sticker jobs. The same
   layout code drives both builders: artwork for the wired
   printer, ESC/POS bytes for a receipt printer asked to take
   them raw.
   ============================================================ */
import {
  Escpos, sendBytes, printHtmlFallback, printCanvasRun,
  usesBrowserPrint, rawReceipts, receiptPrinter, labelPrinter, labelRotation
} from "./printer.js";
import { PaperDoc } from "./paper.js";
import { labelRowCanvas, labelRowWidthMm, calibrationRowCanvas } from "../codes/codes.js";
import { esc, fmtDate, fmtTime, num, round2, toInt, toNum } from "../utils.js";

export { usesBrowserPrint } from "./printer.js";

const rs = (n) => "Rs." + num(n);

/**
 * Bills are drawn as artwork and printed through the Windows driver, which
 * is the only thing a label printer such as the TVS LP 46 Lite understands.
 * A receipt printer can be asked for raw ESC/POS instead, in Settings.
 */
export function newReceiptDoc(settings) {
  const width = toNum(settings.printerWidth, 58);
  return rawReceipts() ? new Escpos(width) : new PaperDoc(width);
}

/** Send whichever kind of document the builder produced. */
export async function sendDoc(doc, { printer } = {}) {
  if (doc instanceof Escpos) { await sendBytes(doc.build(), { printer: printer || receiptPrinter() }); return "printer"; }
  await doc.print({ printer: printer || receiptPrinter() });
  return "printer";
}

/* ============================================================
   Receipt - one layout, either builder
   ============================================================ */
export function buildReceipt(sale, settings, { copy = "", doc } = {}) {
  const p = doc || newReceiptDoc(settings);
  // A bill can be raised without GST even when the shop normally charges it,
  // so the bill's own flag decides what gets printed.
  const gst = sale.gstEnabled !== false && settings.gstEnabled !== false;

  p.align("center").bold(true).size(2, 2).line(settings.businessName || "VYRA SAREES").size(1, 1);
  if (settings.businessType) p.line(settings.businessType);
  p.bold(false);
  if (settings.address) wrap(settings.address, p.cols).forEach((l) => p.line(l));
  const contact = [settings.mobile ? "Ph: " + settings.mobile : "", settings.email || ""].filter(Boolean).join("  ");
  if (contact) p.line(contact);
  if (gst && settings.gstin) p.line("GSTIN: " + settings.gstin);
  p.align("left").rule();

  if (copy) p.align("center").line(copy).align("left").rule();

  p.lr("Invoice:", sale.invoiceNumber || "-");
  p.lr("Date:", `${fmtDate(sale.createdAt || new Date())} ${fmtTime(sale.createdAt || new Date())}`);
  if (sale.customerName) p.lr("Customer:", trim(sale.customerName, p.cols - 11));
  if (sale.customerMobile) p.lr("Mobile:", sale.customerMobile);
  if (sale.customerGstin) p.lr("Cust GSTIN:", sale.customerGstin);
  if (sale.staffName) p.lr("Billed by:", trim(sale.staffName, p.cols - 12));
  p.rule();
  p.row3("Item", "Qty", "Amount");
  p.rule();

  (sale.items || []).forEach((it) => {
    p.line(trim(it.productName || it.name || "Item", p.cols));
    const rate = `${num(it.price)}`;
    p.row3(`  @${rate}`, it.qty, num(it.netAmount ?? it.amount));
    const bits = [];
    if (it.sku) bits.push(it.sku);
    if (it.colour) bits.push(it.colour);
    if (it.size) bits.push(it.size);
    if (bits.length) p.line("  " + trim(bits.join(" · "), p.cols - 2));
    if (toNum(it.lineDiscount) > 0) p.lr("  Discount", "-" + num(it.lineDiscount));
  });

  p.rule();
  p.lr("Subtotal", num(sale.subtotal));
  if (toNum(sale.discount) > 0) p.lr("Discount", "-" + num(sale.discount));
  if (gst && toNum(sale.tax) > 0) {
    p.lr("Taxable", num(sale.taxableAmount));
    if (toNum(sale.igst) > 0) p.lr("IGST", num(sale.igst));
    else { p.lr("CGST", num(sale.cgst)); p.lr("SGST", num(sale.sgst)); }
  }
  if (Math.abs(toNum(sale.roundOff)) >= 0.01) p.lr("Round Off", num(sale.roundOff));
  p.rule("=");
  p.bold(true).size(1, 2).lr("TOTAL", rs(sale.grandTotal)).size(1, 1).bold(false);
  p.rule("=");

  p.lr("Payment", String(sale.paymentMethod || "Cash").toUpperCase());
  if (toNum(sale.amountReceived) > 0) p.lr("Received", num(sale.amountReceived));
  const balance = round2(toNum(sale.amountReceived) - toNum(sale.grandTotal));
  if (balance > 0) p.lr("Change", num(balance));
  if (balance < 0) p.lr("Balance Due", num(-balance));
  if (sale.paymentStatus && sale.paymentStatus !== "paid") {
    p.align("center").bold(true).line(`** ${String(sale.paymentStatus).toUpperCase()} **`).bold(false).align("left");
  }

  const totalQty = (sale.items || []).reduce((a, i) => a + toNum(i.qty), 0);
  p.lr("Items", `${(sale.items || []).length} / ${totalQty} pcs`);
  p.rule();

  if (gst && toNum(sale.tax) > 0 && settings.showGstSummary !== false) {
    p.align("center").line("GST SUMMARY").align("left");
    const byRate = new Map();
    (sale.items || []).forEach((it) => {
      const r = toNum(it.gstRate);
      const cur = byRate.get(r) || { taxable: 0, tax: 0 };
      cur.taxable += toNum(it.taxableAmount); cur.tax += toNum(it.taxAmount);
      byRate.set(r, cur);
    });
    [...byRate.entries()].sort((a, b) => a[0] - b[0]).forEach(([r, v]) => {
      p.lr(`${r}%  on ${num(v.taxable)}`, num(v.tax));
    });
    p.rule();
  }

  p.align("center");
  if (settings.showInvoiceQr !== false && sale.invoiceNumber) p.qr(sale.invoiceNumber, 5).feed(1);
  (settings.footerMessage || "Thank You!\nVisit Again").split("\n").forEach((l) => p.line(l.trim()));
  p.feed(1).line(" ").align("left");
  p.cut();
  return p;
}

export async function printSale(sale, settings, opts = {}) {
  if (usesBrowserPrint()) {
    printHtmlFallback(receiptHtml(sale, settings, opts), sale.invoiceNumber || "Receipt");
    return "browser";
  }
  await sendDoc(buildReceipt(sale, settings, opts));
  return "printer";
}

/* ============================================================
   Receipt - HTML twin (preview + browser printing)
   ============================================================ */
export function receiptHtml(sale, settings, { copy = "" } = {}) {
  const gst = sale.gstEnabled !== false && settings.gstEnabled !== false;
  const rows = (sale.items || []).map((it) => `
    <tr><td colspan="3">${esc(it.productName || it.name || "Item")}</td></tr>
    <tr>
      <td>&nbsp;&nbsp;@${num(it.price)}${it.sku ? ` <span style="opacity:.7">${esc(it.sku)}</span>` : ""}</td>
      <td class="r">${it.qty}</td>
      <td class="r">${num(it.netAmount ?? it.amount)}</td>
    </tr>`).join("");

  const gstBlock = gst && toNum(sale.tax) > 0 ? `
    <tr><td>Taxable</td><td class="r" colspan="2">${num(sale.taxableAmount)}</td></tr>
    ${toNum(sale.igst) > 0
      ? `<tr><td>IGST</td><td class="r" colspan="2">${num(sale.igst)}</td></tr>`
      : `<tr><td>CGST</td><td class="r" colspan="2">${num(sale.cgst)}</td></tr>
         <tr><td>SGST</td><td class="r" colspan="2">${num(sale.sgst)}</td></tr>`}` : "";

  return `
  <div class="c b big">${esc(settings.businessName || "VYRA SAREES")}</div>
  <div class="c">${esc(settings.businessType || "")}</div>
  ${settings.address ? `<div class="c">${esc(settings.address)}</div>` : ""}
  ${settings.mobile ? `<div class="c">Ph: ${esc(settings.mobile)}</div>` : ""}
  ${gst && settings.gstin ? `<div class="c">GSTIN: ${esc(settings.gstin)}</div>` : ""}
  <hr>
  ${copy ? `<div class="c b">${esc(copy)}</div><hr>` : ""}
  <table>
    <tr><td>Invoice</td><td class="r">${esc(sale.invoiceNumber || "-")}</td></tr>
    <tr><td>Date</td><td class="r">${fmtDate(sale.createdAt || new Date())} ${fmtTime(sale.createdAt || new Date())}</td></tr>
    ${sale.customerName ? `<tr><td>Customer</td><td class="r">${esc(sale.customerName)}</td></tr>` : ""}
    ${sale.customerMobile ? `<tr><td>Mobile</td><td class="r">${esc(sale.customerMobile)}</td></tr>` : ""}
    ${sale.staffName ? `<tr><td>Billed by</td><td class="r">${esc(sale.staffName)}</td></tr>` : ""}
  </table>
  <hr>
  <table>
    <tr class="b"><td>Item</td><td class="r">Qty</td><td class="r">Amount</td></tr>
    ${rows}
  </table>
  <hr>
  <table>
    <tr><td>Subtotal</td><td class="r" colspan="2">${num(sale.subtotal)}</td></tr>
    ${toNum(sale.discount) > 0 ? `<tr><td>Discount</td><td class="r" colspan="2">-${num(sale.discount)}</td></tr>` : ""}
    ${gstBlock}
    ${Math.abs(toNum(sale.roundOff)) >= 0.01 ? `<tr><td>Round Off</td><td class="r" colspan="2">${num(sale.roundOff)}</td></tr>` : ""}
  </table>
  <hr>
  <table><tr class="big"><td class="b">TOTAL</td><td class="r b">${rs(sale.grandTotal)}</td></tr></table>
  <hr>
  <table>
    <tr><td>Payment</td><td class="r">${esc(String(sale.paymentMethod || "Cash").toUpperCase())}</td></tr>
    ${toNum(sale.amountReceived) > 0 ? `<tr><td>Received</td><td class="r">${num(sale.amountReceived)}</td></tr>` : ""}
    ${toNum(sale.amountReceived) - toNum(sale.grandTotal) > 0
      ? `<tr><td>Change</td><td class="r">${num(toNum(sale.amountReceived) - toNum(sale.grandTotal))}</td></tr>` : ""}
    ${toNum(sale.grandTotal) - toNum(sale.amountReceived) > 0
      ? `<tr class="b"><td>Balance Due</td><td class="r">${num(toNum(sale.grandTotal) - toNum(sale.amountReceived))}</td></tr>` : ""}
  </table>
  <hr>
  <div class="c">${esc(settings.footerMessage || "Thank You!").replace(/\n/g, "<br>")}</div>`;
}

/* ============================================================
   QR / barcode sticker printing
   ============================================================ */
/**
 * jobs = [{ product, qty, type:"qr"|"barcode" }]
 *
 * The label roll carries several stickers side by side, so the page the
 * printer feeds is a whole *row* - the same product's sticker repeated
 * across it. Each row therefore yields `labelsPerRow` stickers, and a run
 * of 10 labels on a two-up roll is 5 rows. Everything is drawn as artwork,
 * so it prints through the label printer's own Windows driver.
 */
export async function printLabels(jobs, settings, onProgress) {
  const widthMm = toNum(settings.labelWidthMm, 50);
  const heightMm = toNum(settings.labelHeightMm, 25);
  const across = Math.max(1, toInt(settings.labelsPerRow, 1));
  const gapMm = Math.max(0, toNum(settings.labelGapMm, 0));
  const rowWidthMm = labelRowWidthMm({ widthMm, across, gapMm });
  const total = jobs.reduce((a, j) => a + toNum(j.qty, 1), 0);

  const pages = [];
  let drawn = 0;
  for (const job of jobs) {
    const canvas = await labelRowCanvas(job.product, {
      widthMm, heightMm, across, gapMm,
      shiftXMm: toNum(settings.labelShiftXMm, 0),
      shiftYMm: toNum(settings.labelShiftYMm, 0),
      type: job.type || "qr",
      showPrice: settings.labelShowPrice !== false,
      shopName: settings.labelShowShopName ? settings.businessName : ""
    });
    // A row prints `across` stickers at once, so an odd count rounds up:
    // the last row still comes out full.
    const wanted = Math.max(1, toNum(job.qty, 1));
    const rows = Math.ceil(wanted / across);
    pages.push({ canvas, copies: rows });
    drawn = Math.min(total, drawn + rows * across);
    if (onProgress) onProgress(drawn, total);
  }

  await printCanvasRun(pages, {
    widthMm: rowWidthMm,
    heightMm,
    rotate: labelRotation(),
    printer: labelPrinter(),
    title: "VYRA SAREES labels"
  });
  return total;
}

/**
 * Print one measuring row: the same path, the same size, but carrying a
 * ruler instead of a product. Held against a tape it says straight away
 * whether the printer is putting the row out at its true size.
 */
export async function printCalibration(settings) {
  const widthMm = toNum(settings.labelWidthMm, 50);
  const heightMm = toNum(settings.labelHeightMm, 25);
  const across = Math.max(1, toInt(settings.labelsPerRow, 1));
  const gapMm = Math.max(0, toNum(settings.labelGapMm, 0));
  const canvas = calibrationRowCanvas({
    widthMm, heightMm, across, gapMm,
    shiftXMm: toNum(settings.labelShiftXMm, 0),
    shiftYMm: toNum(settings.labelShiftYMm, 0)
  });

  await printCanvasRun([{ canvas, copies: 1 }], {
    widthMm: labelRowWidthMm({ widthMm, across, gapMm }),
    heightMm,
    rotate: labelRotation(),
    printer: labelPrinter(),
    title: "VYRA SAREES size test"
  });
  return { widthMm, heightMm, across, rowMm: labelRowWidthMm({ widthMm, across, gapMm }) };
}

/** Print one 58/80mm-wide QR block for a single product (receipt printer style). */
export async function printProductQr(product, settings, copies = 1, type = "qr") {
  await printLabels([{ product, qty: copies, type }], settings);
}

/* ============================================================
   Small receipts: payment / return acknowledgement
   ============================================================ */
export async function printReturnSlip(ret, settings) {
  const p = newReceiptDoc(settings);
  p.align("center").bold(true).size(2, 1).line(settings.businessName || "VYRA SAREES").size(1, 1)
    .line(ret.type === "EXCHANGE" ? "EXCHANGE SLIP" : "RETURN SLIP").bold(false).align("left").rule();
  p.lr("No:", ret.returnNumber || "-");
  p.lr("Date:", fmtDate(new Date()) + " " + fmtTime(new Date()));
  if (ret.invoiceNumber) p.lr("Against:", ret.invoiceNumber);
  if (ret.customerName) p.lr("Customer:", trim(ret.customerName, p.cols - 11));
  p.rule().line("RETURNED").rule();
  (ret.returnedItems || []).forEach((it) => p.row3(trim(it.productName, p.cols - 15), it.qty, num(it.amount)));
  if ((ret.newItems || []).length) {
    p.rule().line("ISSUED").rule();
    (ret.newItems || []).forEach((it) => p.row3(trim(it.productName, p.cols - 15), it.qty, num(it.amount)));
  }
  p.rule();
  p.lr("Return value", num(ret.returnValue));
  if (toNum(ret.newValue) > 0) p.lr("New value", num(ret.newValue));
  if (toNum(ret.differenceAmount) > 0) p.bold(true).lr("Customer pays", rs(ret.differenceAmount)).bold(false);
  if (toNum(ret.refundAmount) > 0) p.bold(true).lr(ret.mode === "credit" ? "Credit note" : "Refund", rs(ret.refundAmount)).bold(false);
  if (ret.reason) p.line("Reason: " + ret.reason);
  p.rule().align("center").line("Thank You").feed(1).align("left").cut();
  await sendDoc(p);
}

/* ---------- text helpers ---------- */
function trim(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "." : s; }
function wrap(text, cols) {
  const out = [];
  String(text).split("\n").forEach((para) => {
    let line = "";
    para.split(/\s+/).forEach((w) => {
      if ((line + " " + w).trim().length > cols) { if (line) out.push(line.trim()); line = w; }
      else line += " " + w;
    });
    if (line.trim()) out.push(line.trim());
  });
  return out;
}
