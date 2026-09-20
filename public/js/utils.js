/* ============================================================
   demo SAREES - shared helpers
   ============================================================ */

/* ---------- money ---------- */
const inr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export const money = (n) => "₹" + inr.format(round2(Number(n) || 0));
export const money0 = (n) => "₹" + inr0.format(Math.round(Number(n) || 0));
export const num = (n) => inr.format(round2(Number(n) || 0));
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const toNum = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
export const toInt = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

/* ---------- dates ---------- */
export const pad = (n, w = 2) => String(n).padStart(w, "0");

export function dayKey(d = new Date()) {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}
export function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export function endOfDay(d = new Date()) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function startOfWeek(d = new Date()) {           // Monday start
  const x = startOfDay(d); const day = (x.getDay() + 6) % 7; return addDays(x, -day);
}
export function startOfMonth(d = new Date()) { const x = startOfDay(d); x.setDate(1); return x; }

export function fmtDate(v) {
  const d = toDate(v); if (!d) return "-";
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}
export function fmtTime(v) {
  const d = toDate(v); if (!d) return "-";
  let h = d.getHours(); const m = pad(d.getMinutes()); const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12; return `${pad(h)}:${m} ${ap}`;
}
export function fmtDateTime(v) { const d = toDate(v); return d ? `${fmtDate(d)}  ${fmtTime(d)}` : "-"; }

/** ISO string | Date | epoch number | Firestore Timestamp -> Date */
export function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  if (typeof v.toDate === "function") return v.toDate();          // Firestore Timestamp
  if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
  const d = new Date(v); return isNaN(d.getTime()) ? null : d;
}
export function ago(v) {
  const d = toDate(v); if (!d) return "";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 604800) return Math.floor(s / 86400) + "d ago";
  return fmtDate(d);
}
/** yyyy-mm-dd for <input type="date"> */
export const dateInput = (d = new Date()) => dayKey(d);

/* ---------- strings ---------- */
export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
export const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const upper = (s) => String(s || "").trim().toUpperCase();
export const titleCase = (s) => String(s || "").replace(/\w\S*/g, (t) => t[0].toUpperCase() + t.slice(1).toLowerCase());

/** Build lowercase search tokens for a product-ish record. */
export function searchTokens(...parts) {
  const set = new Set();
  parts.filter(Boolean).forEach((p) => {
    const s = String(p).toLowerCase().trim();
    if (!s) return;
    set.add(s);
    s.split(/[^a-z0-9]+/).forEach((w) => { if (w.length > 1) set.add(w); });
  });
  return [...set].slice(0, 40);
}

/** Case-insensitive multi-term match against a record's text blob. */
export function matches(blob, query) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return true;
  const hay = String(blob || "").toLowerCase();
  return q.split(/\s+/).every((t) => hay.includes(t));
}

/* ---------- ids & codes ---------- */
export const uid = (n = 8) => Math.random().toString(36).slice(2, 2 + n).toUpperCase();

/** VYS-SAR-00125 */
export function buildSku(prefix, catCode, seq) {
  return `${upper(prefix || "VYS")}-${upper(catCode || "GEN")}-${pad(seq, 5)}`;
}
/** INV-000001 */
export function buildDocNo(prefix, seq, width = 6) {
  return `${upper(prefix || "INV")}-${pad(seq, width)}`;
}
/**
 * EAN-13 style numeric barcode derived from a sequence, with check digit.
 * Prefix 890 = India GS1 country code block (internal use only).
 */
export function buildBarcode(seq) {
  const base = ("890" + pad(seq, 9)).slice(0, 12);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  return base + check;
}

/* ---------- billing math ---------- */
/**
 * Compute a full bill from cart lines.
 * line = { qty, price, discount (per-unit rupees), gstRate }
 * opts = { gstEnabled, gstMode:"inclusive"|"exclusive", billDiscount, interState, roundOff }
 */
export function computeBill(lines, opts = {}) {
  const gstEnabled = opts.gstEnabled !== false;
  const inclusive = opts.gstMode === "inclusive";
  const billDiscount = Math.max(0, toNum(opts.billDiscount));

  let gross = 0, lineDiscount = 0;
  const rows = lines.map((l) => {
    const qty = toNum(l.qty, 0);
    const price = toNum(l.price, 0);
    const disc = toNum(l.discount, 0) * qty;      // per-unit discount x qty
    const amount = round2(qty * price);
    gross += amount; lineDiscount += disc;
    return { ...l, qty, price, amount: round2(amount), lineDiscount: round2(disc) };
  });
  gross = round2(gross); lineDiscount = round2(lineDiscount);

  const afterLine = Math.max(0, round2(gross - lineDiscount));
  const cappedBill = Math.min(billDiscount, afterLine);
  const totalDiscount = round2(lineDiscount + cappedBill);
  const net = Math.max(0, round2(gross - totalDiscount));

  // Spread the bill-level discount proportionally so per-line GST stays correct.
  let taxable = 0, tax = 0;
  const share = afterLine > 0 ? cappedBill / afterLine : 0;
  rows.forEach((r) => {
    const lineNet = round2((r.amount - r.lineDiscount) * (1 - share));
    const rate = gstEnabled ? toNum(r.gstRate, 0) : 0;
    let base, t;
    if (inclusive && rate > 0) { base = round2(lineNet / (1 + rate / 100)); t = round2(lineNet - base); }
    else { base = lineNet; t = round2(lineNet * rate / 100); }
    r.netAmount = lineNet; r.taxableAmount = base; r.taxAmount = t; r.gstRate = rate;
    taxable += base; tax += t;
  });
  taxable = round2(taxable); tax = round2(tax);

  const beforeRound = inclusive ? net : round2(taxable + tax);
  const grand = opts.roundOff === false ? beforeRound : Math.round(beforeRound);
  const roundOff = round2(grand - beforeRound);

  const inter = !!opts.interState;
  return {
    lines: rows,
    subtotal: gross,
    lineDiscount, billDiscount: round2(cappedBill), discount: totalDiscount,
    taxableAmount: taxable,
    cgst: inter ? 0 : round2(tax / 2),
    sgst: inter ? 0 : round2(tax / 2),
    igst: inter ? tax : 0,
    tax, roundOff, grandTotal: round2(grand)
  };
}

/* ---------- stock helpers ---------- */
export function stockStatus(p) {
  const s = toNum(p.stock, 0), min = toNum(p.minimumStock, 0);
  if (s <= 0) return { key: "out", label: "Out of Stock", cls: "danger" };
  if (min > 0 && s <= min) return { key: "low", label: "Low Stock", cls: "warn" };
  return { key: "ok", label: "In Stock", cls: "ok" };
}

/* ---------- misc ---------- */
export function debounce(fn, ms = 250) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const sum = (arr, f) => arr.reduce((a, b) => a + (f ? toNum(f(b)) : toNum(b)), 0);
export function groupBy(arr, keyFn) {
  const m = new Map();
  arr.forEach((x) => { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
  return m;
}
export function download(filename, content, mime = "text/csv;charset=utf-8;") {
  const blob = new Blob(["﻿" + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 400);
}
export function toCsv(rows, headers) {
  const cell = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const head = headers.map((h) => cell(h.label)).join(",");
  const body = rows.map((r) => headers.map((h) => cell(typeof h.get === "function" ? h.get(r) : r[h.key])).join(",")).join("\n");
  return head + "\n" + body;
}
export const validMobile = (s) => /^[0-9]{10}$/.test(String(s || "").replace(/\D/g, ""));
export const validGstin = (s) => /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(upper(s));
export const validEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || "").trim());

/* ---------- uploaded files ---------- */
/* Firebase Storage hands back a complete https download URL, so there is
   nothing to prefix - this stays as the one place image paths pass through. */
export const fileUrl = (u) => u || "";
