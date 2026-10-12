/* ============================================================
   ARUMBAGAM - Billing / POS
   ============================================================ */
import { state, findByCode, searchProducts, can, customerById } from "../store.js";
import { createSale, nextInvoiceNumber, peekBlockSize } from "../db.js";
import {
  icon, openSheet, emptyState, toast, ok, err, warn, busy, confirmDialog, formData
} from "../ui.js";
import {
  esc, fileUrl, money, num, toNum, toInt, round2, computeBill, debounce, fmtDate, fmtTime
} from "../utils.js";
import { pickProduct, pickCustomer, openCustomerEditor } from "./_shared.js";
import { setScanHandler } from "../app.js";
import { printSale, receiptHtml } from "../hw/documents.js";

export const title = "New Bill";

const CART_KEY = "demo.cart";
const PAYMENT_METHODS = ["Cash", "UPI", "Card", "Bank Transfer", "Credit", "Other"];

let cart = [];
let customer = null;
let billDiscount = 0;
let note = "";
/* GST for THIS bill. Starts from the shop setting and can be switched off
   for a single bill (an estimate, a no-GST customer) without changing it
   for everybody. null means "not decided yet - follow the setting". */
let gstOn = null;
const gstDefault = () => state.settings?.gstEnabled !== false;
const gstActive = () => (gstOn === null ? gstDefault() : gstOn);

/* ---------- persistence so a page change never loses the cart ---------- */
function saveCart() {
  try {
    sessionStorage.setItem(CART_KEY, JSON.stringify({
      cart: cart.map(({ product, ...l }) => l), customerId: customer?.id || "", billDiscount, note, gstOn
    }));
  } catch {}
}
function loadCart() {
  try {
    const d = JSON.parse(sessionStorage.getItem(CART_KEY) || "null");
    if (!d) return;
    cart = (d.cart || []).map((l) => ({ ...l, product: state.products.find((p) => p.id === l.productId) || null }))
      .filter((l) => l.product);
    customer = d.customerId ? customerById(d.customerId) : null;
    billDiscount = toNum(d.billDiscount);
    note = d.note || "";
    gstOn = d.gstOn === undefined ? null : d.gstOn;
  } catch {}
}
function clearCart() { cart = []; customer = null; billDiscount = 0; note = ""; gstOn = null; sessionStorage.removeItem(CART_KEY); }

/* ============================================================
   Mount
   ============================================================ */
export async function mount(view, { go }) {
  loadCart();

  view.innerHTML = `
    <div class="searchbar">
      <div class="swrap">${icon("search")}
        <input id="bl-q" placeholder="Scan or search product…" data-scan-field="true" autocomplete="off">
      </div>
      <button class="icon-btn" id="bl-pick" title="Browse products">${icon("box")}</button>
    </div>
    <ul class="list card pad0 hidden" id="bl-sug"></ul>

    <div class="card pad0 mb0" id="bl-customer"></div>

    <div class="card pad0" id="bl-cart-card">
      <ul class="list" id="bl-cart"></ul>
      <div class="totals" id="bl-totals"></div>
    </div>

    <div class="btn-row mb">
      <button class="btn btn-soft btn-sm" id="bl-disc">${icon("tag")} Bill discount</button>
      <button class="btn btn-soft btn-sm" id="bl-note">${icon("edit")} Note</button>
      <button class="btn btn-soft btn-sm" id="bl-gst"></button>
      <button class="btn btn-soft btn-sm" id="bl-clear">${icon("trash")} Clear</button>
    </div>
    <div class="small muted tc mb">${peekBlockSize("invoice")} invoice numbers reserved for offline billing</div>

    <div class="paybar" id="bl-paybar">
      <div class="amt"><small>Total payable</small><b id="bl-grand">₹0.00</b></div>
      <button class="btn btn-primary btn-lg" id="bl-pay">${icon("check")} Payment</button>
    </div>`;

  const els = {
    q: view.querySelector("#bl-q"),
    sug: view.querySelector("#bl-sug"),
    cart: view.querySelector("#bl-cart"),
    totals: view.querySelector("#bl-totals"),
    cust: view.querySelector("#bl-customer"),
    grand: view.querySelector("#bl-grand"),
    gst: view.querySelector("#bl-gst"),
    pay: view.querySelector("#bl-pay")
  };

  /* ---------- render ---------- */
  const bill = () => computeBill(cart, {
    gstEnabled: gstActive(),
    gstMode: state.settings?.gstMode || "exclusive",
    billDiscount,
    roundOff: state.settings?.roundOff !== false,
    interState: !!(customer?.gstin && state.settings?.stateCode &&
      String(customer.gstin).slice(0, 2) !== String(state.settings.stateCode))
  });

  function paint() {
    const b = bill();

    els.cust.innerHTML = customer
      ? `<div class="row" id="bl-cust-row">
           <div class="thumb">${esc((customer.name || "?").slice(0, 2).toUpperCase())}</div>
           <div class="mid"><b>${esc(customer.name)}</b><small>${esc(customer.mobile || "No mobile")}${toNum(customer.outstanding) > 0 ? ` · Due ${money(customer.outstanding)}` : ""}</small></div>
           <div class="end"><button class="btn btn-ghost btn-sm" id="bl-cust-clear">Change</button></div>
         </div>`
      : `<div class="row" id="bl-cust-row">
           <div class="thumb">${icon("user")}</div>
           <div class="mid"><b>Walk-in customer</b><small>Tap to attach a customer</small></div>
           <div class="end">${icon("plus")}</div>
         </div>`;

    els.cart.innerHTML = cart.length ? cart.map((l, i) => cartLine(l, b.lines[i], i)).join("")
      : emptyState("Cart is empty", "Scan a tag or search to add products", "cart");

    els.totals.innerHTML = cart.length ? `
      <div class="trow"><span>Subtotal (${cart.length} items)</span><b>${money(b.subtotal)}</b></div>
      ${b.discount > 0 ? `<div class="trow"><span>Discount</span><b>- ${money(b.discount)}</b></div>` : ""}
      ${gstActive() && b.tax > 0 ? `
        <div class="trow"><span>Taxable value</span><b>${money(b.taxableAmount)}</b></div>
        ${b.igst > 0
          ? `<div class="trow"><span>IGST</span><b>${money(b.igst)}</b></div>`
          : `<div class="trow"><span>CGST</span><b>${money(b.cgst)}</b></div>
             <div class="trow"><span>SGST</span><b>${money(b.sgst)}</b></div>`}` : ""}
      ${Math.abs(b.roundOff) >= 0.01 ? `<div class="trow"><span>Round off</span><b>${money(b.roundOff)}</b></div>` : ""}
      <div class="trow grand"><span>Grand Total</span><b>${money(b.grandTotal)}</b></div>` : "";

    els.gst.innerHTML = `${icon(gstActive() ? "check" : "x")} GST ${gstActive() ? "on" : "off"}`;
    els.gst.classList.toggle("btn-primary", gstActive());

    els.grand.textContent = money(b.grandTotal);
    els.pay.disabled = !cart.length;
    saveCart();
  }

  /* ---------- cart operations ---------- */
  function addProduct(p, qty = 1) {
    if (!p) return;
    if ((p.status || "active") !== "active") return warn(`${p.productName} is inactive.`);
    const existing = cart.find((l) => l.productId === p.id);
    const wanted = (existing ? existing.qty : 0) + qty;
    const allowNeg = state.settings?.allowNegativeStock === true;
    if (!allowNeg && wanted > toNum(p.stock)) {
      if (toNum(p.stock) <= 0) { warn("This product is currently out of stock."); return; }
      warn(`Only ${toNum(p.stock)} in stock for ${p.productName}.`);
      return;
    }
    if (existing) existing.qty = wanted;
    else cart.unshift({
      productId: p.id, productName: p.productName, sku: p.sku, barcode: p.barcode,
      colour: p.colour || "", size: p.size || "",
      price: toNum(p.sellingPrice), qty, discount: toNum(p.discount),
      gstRate: toNum(p.gstRate), product: p
    });
    paint();
    toast(`${p.productName} × ${wanted}`);
    if (navigator.vibrate) navigator.vibrate(30);
  }

  function setQty(i, qty) {
    const l = cart[i]; if (!l) return;
    const q = Math.max(0, toInt(qty, 0));
    if (q === 0) { cart.splice(i, 1); paint(); return; }
    const allowNeg = state.settings?.allowNegativeStock === true;
    if (!allowNeg && q > toNum(l.product?.stock)) { warn(`Only ${toNum(l.product?.stock)} in stock.`); paint(); return; }
    l.qty = q; paint();
  }

  /* ---------- events ---------- */
  els.cart.onclick = (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const i = toInt(btn.closest("[data-i]").dataset.i);
    const act = btn.dataset.act;
    if (act === "inc") setQty(i, cart[i].qty + 1);
    if (act === "dec") setQty(i, cart[i].qty - 1);
    if (act === "del") { cart.splice(i, 1); paint(); }
    if (act === "disc") lineDiscountSheet(i, paint);
  };
  els.cart.onchange = (e) => {
    const inp = e.target.closest("[data-qty]");
    if (inp) setQty(toInt(inp.closest("[data-i]").dataset.i), inp.value);
  };

  els.cust.onclick = (e) => {
    if (e.target.closest("#bl-cust-clear")) { customer = null; paint(); return; }
    pickCustomer((c) => { customer = c; paint(); });
  };

  els.q.oninput = debounce(() => {
    const v = els.q.value.trim();
    if (v.length < 2) { els.sug.classList.add("hidden"); return; }
    const list = searchProducts(v, { status: "active" }).slice(0, 8);
    els.sug.innerHTML = list.length ? list.map((p, i) => `
      <li class="row" data-sug="${p.id}">
        <div class="thumb">${p.imageUrl ? `<img src="${esc(fileUrl(p.imageUrl))}">` : esc((p.productName || "?").slice(0, 2).toUpperCase())}</div>
        <div class="mid"><b>${esc(p.productName)}</b><small>${esc(p.sku)} · ${toNum(p.stock)} in stock</small></div>
        <div class="end"><b>${money(p.sellingPrice)}</b></div></li>`).join("")
      : `<li class="row" style="cursor:default"><div class="mid muted">No match for "${esc(v)}"</div></li>`;
    els.sug.classList.remove("hidden");
  }, 140);

  els.sug.onclick = (e) => {
    const li = e.target.closest("[data-sug]"); if (!li) return;
    addProduct(state.products.find((p) => p.id === li.dataset.sug));
    els.q.value = ""; els.sug.classList.add("hidden"); els.q.focus();
  };
  els.q.onkeydown = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const v = els.q.value.trim(); if (!v) return;
    const p = findByCode(v) || searchProducts(v, { status: "active" })[0];
    if (p) { addProduct(p); els.q.value = ""; els.sug.classList.add("hidden"); }
    else warn("Product not found. Please check the QR/Barcode.");
  };

  view.querySelector("#bl-pick").onclick = () => pickProduct((p) => addProduct(p));
  view.querySelector("#bl-disc").onclick = () => billDiscountSheet(paint);
  view.querySelector("#bl-note").onclick = async () => {
    openSheet({
      title: "Bill note",
      body: `<label class="field"><span>Note printed on the bill</span><textarea id="bn">${esc(note)}</textarea></label>`,
      footer: `<button class="btn btn-soft" data-close>Cancel</button><button class="btn btn-primary" id="bn-ok">Save</button>`,
      onMount(a) { a.root.querySelector("#bn-ok").onclick = () => { note = a.root.querySelector("#bn").value; a.close(); paint(); }; }
    });
  };
  view.querySelector("#bl-gst").onclick = () => {
    gstOn = !gstActive();
    paint();
    toast(gstOn ? "GST will be charged on this bill" : "This bill is billed without GST");
  };
  view.querySelector("#bl-clear").onclick = async () => {
    if (!cart.length) return;
    if (await confirmDialog("Clear this bill and start again?", { okText: "Clear", danger: true })) { clearCart(); paint(); }
  };
  els.pay.onclick = () => paymentSheet(bill(), () => { clearCart(); paint(); }, go);

  setScanHandler((code) => {
    const p = findByCode(code);
    if (p) addProduct(p);
    else warn(`No product matches ${code}. Please check the QR/Barcode.`);
  });

  /* a product opened from elsewhere can queue itself into the bill */
  const pending = sessionStorage.getItem("demo.pendingScan");
  if (pending) { sessionStorage.removeItem("demo.pendingScan"); const p = findByCode(pending); if (p) addProduct(p); }

  paint();
  return () => { saveCart(); };
}

/* ============================================================
   Cart line markup
   ============================================================ */
function cartLine(l, calc, i) {
  const meta = [l.sku, l.colour, l.size].filter(Boolean).join(" · ");
  return `<li class="cart-item" data-i="${i}">
    <div class="ci-mid">
      <b>${esc(l.productName)}</b>
      <small>${esc(meta)}</small>
      <div class="flex" style="gap:8px">
        <div class="qty">
          <button data-act="dec" aria-label="Less">−</button>
          <input data-qty type="number" inputmode="numeric" value="${l.qty}" min="0">
          <button data-act="inc" aria-label="More">+</button>
        </div>
        <button class="btn btn-ghost btn-sm" data-act="disc" style="padding:6px 4px">
          ${money(l.price)}${toNum(l.discount) > 0 ? ` −${money(l.discount)}` : ""}
        </button>
      </div>
    </div>
    <div class="ci-end">
      <b>${money(calc ? calc.netAmount : l.qty * l.price)}</b>
      ${toNum(l.gstRate) ? `<small class="muted">GST ${toNum(l.gstRate)}%</small>` : ""}
      <button class="del" data-act="del">Remove</button>
    </div>
  </li>`;
}

/* ============================================================
   Discount sheets
   ============================================================ */
function lineDiscountSheet(i, paint) {
  const l = cart[i];
  const cap = capPct();
  openSheet({
    title: l.productName,
    body: `
      <div class="grid2">
        <label class="field"><span>Unit price (₹)</span>
          <input id="ld-price" type="number" inputmode="decimal" step="0.01" value="${l.price}" ${can("sales.editPrice") ? "" : "disabled"}></label>
        <label class="field"><span>Quantity</span>
          <input id="ld-qty" type="number" inputmode="numeric" step="1" min="1" value="${l.qty}"></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Discount per piece (₹)</span>
          <input id="ld-disc" type="number" inputmode="decimal" step="0.01" min="0" value="${l.discount || 0}"></label>
        <label class="field"><span>Discount %</span>
          <input id="ld-pct" type="number" inputmode="decimal" step="0.1" min="0" value="${l.price ? round2((toNum(l.discount) / l.price) * 100) : 0}"></label>
      </div>
      ${cap < 100 ? `<p class="form-note">Your maximum discount is ${cap}%.</p>` : ""}
      <label class="field"><span>GST rate</span>
        <select id="ld-gst">${[0, 3, 5, 12, 18, 28].map((r) => `<option value="${r}" ${toNum(l.gstRate) === r ? "selected" : ""}>${r}%</option>`).join("")}</select></label>
      <div class="small muted">In stock: ${toNum(l.product?.stock)} pcs</div>
      <div id="ld-err" class="form-error hidden"></div>`,
    footer: `<button class="btn btn-soft" data-close>Cancel</button>
             <button class="btn btn-primary" id="ld-ok">Apply</button>`,
    onMount(a) {
      const price = a.root.querySelector("#ld-price");
      const disc = a.root.querySelector("#ld-disc");
      const pct = a.root.querySelector("#ld-pct");
      disc.oninput = () => { pct.value = toNum(price.value) ? round2((toNum(disc.value) / toNum(price.value)) * 100) : 0; };
      pct.oninput = () => { disc.value = round2(toNum(price.value) * toNum(pct.value) / 100); };
      a.root.querySelector("#ld-ok").onclick = () => {
        const box = a.root.querySelector("#ld-err");
        if (toNum(pct.value) > cap) {
          box.textContent = `Discount above ${cap}% needs the shop owner's approval.`;
          box.classList.remove("hidden"); return;
        }
        l.price = toNum(price.value, l.price);
        l.qty = Math.max(1, toInt(a.root.querySelector("#ld-qty").value, l.qty));
        l.discount = Math.min(toNum(disc.value), l.price);
        l.gstRate = toNum(a.root.querySelector("#ld-gst").value);
        a.close(); paint();
      };
    }
  });
}

function billDiscountSheet(paint) {
  const b = computeBill(cart, { gstEnabled: false, billDiscount: 0 });
  const cap = capPct();
  openSheet({
    title: "Bill discount",
    body: `
      <div class="trow mb"><span>Bill value</span><b>${money(b.subtotal - b.lineDiscount)}</b></div>
      <div class="grid2">
        <label class="field"><span>Discount amount (₹)</span>
          <input id="bd-amt" type="number" inputmode="decimal" step="0.01" min="0" value="${billDiscount || ""}"></label>
        <label class="field"><span>Discount %</span>
          <input id="bd-pct" type="number" inputmode="decimal" step="0.1" min="0"></label>
      </div>
      ${cap < 100 ? `<p class="form-note">Your maximum discount is ${cap}%.</p>` : ""}
      <div class="flex fwrap">
        ${[5, 10, 15, 20].filter((x) => x <= cap).map((x) => `<button class="chip" data-q="${x}">${x}%</button>`).join("")}
      </div>
      <div id="bd-err" class="form-error hidden"></div>`,
    footer: `<button class="btn btn-soft" data-close>Cancel</button>
             <button class="btn btn-primary" id="bd-ok">Apply</button>`,
    onMount(a) {
      const base = b.subtotal - b.lineDiscount;
      const amt = a.root.querySelector("#bd-amt"), pct = a.root.querySelector("#bd-pct");
      if (billDiscount && base) pct.value = round2((billDiscount / base) * 100);
      amt.oninput = () => { pct.value = base ? round2((toNum(amt.value) / base) * 100) : 0; };
      pct.oninput = () => { amt.value = round2(base * toNum(pct.value) / 100); };
      a.root.querySelectorAll("[data-q]").forEach((btn) => {
        btn.onclick = () => { pct.value = btn.dataset.q; amt.value = round2(base * toNum(btn.dataset.q) / 100); };
      });
      a.root.querySelector("#bd-ok").onclick = () => {
        const box = a.root.querySelector("#bd-err");
        if (base && (toNum(amt.value) / base) * 100 > cap + 0.001) {
          box.textContent = `Discount above ${cap}% needs the shop owner's approval.`;
          box.classList.remove("hidden"); return;
        }
        billDiscount = Math.max(0, Math.min(toNum(amt.value), base));
        a.close(); paint();
      };
    }
  });
}

const capPct = () => (state.user?.role === "admin" ? 100 : toNum(state.settings?.maxStaffDiscountPct, 10));

/* ============================================================
   Payment & save
   ============================================================ */
function paymentSheet(b, onDone, go) {
  let method = "Cash";
  let received = b.grandTotal;

  openSheet({
    title: "Payment",
    body: `
      <div class="trow grand mb"><span>Amount payable</span><b>${money(b.grandTotal)}</b></div>

      <div class="sec-title">Payment method</div>
      <div class="flex fwrap mb" id="pm-methods">
        ${PAYMENT_METHODS.map((m) => `<button class="chip ${m === "Cash" ? "on" : ""}" data-m="${m}">${m}</button>`).join("")}
      </div>

      <label class="field"><span>Amount received (₹)</span>
        <input id="pm-recv" type="number" inputmode="decimal" step="0.01" min="0" value="${b.grandTotal}"></label>
      <div class="flex fwrap mb" id="pm-quick">
        ${quickCash(b.grandTotal).map((v) => `<button class="chip" data-c="${v}">₹${v}</button>`).join("")}
        <button class="chip" data-c="${b.grandTotal}">Exact</button>
        <button class="chip" data-c="0">No payment</button>
      </div>

      <div class="card" style="background:var(--surface-2)">
        <div class="trow"><span id="pm-bal-label">Change to return</span><b id="pm-bal">₹0.00</b></div>
        <div class="trow"><span>Payment status</span><b id="pm-status">Paid</b></div>
      </div>

      ${customer ? "" : `<p class="form-note">No customer attached. Credit sales need a customer.</p>`}
      <div id="pm-err" class="form-error hidden"></div>`,
    footer: `<button class="btn btn-soft" data-close>Back</button>
             <button class="btn btn-ok" id="pm-save">${icon("check")} Save &amp; Print</button>`,
    onMount(a) {
      const recv = a.root.querySelector("#pm-recv");
      const balEl = a.root.querySelector("#pm-bal");
      const balLabel = a.root.querySelector("#pm-bal-label");
      const statusEl = a.root.querySelector("#pm-status");

      const refresh = () => {
        received = toNum(recv.value);
        const diff = round2(received - b.grandTotal);
        balLabel.textContent = diff >= 0 ? "Change to return" : "Balance due";
        balEl.textContent = money(Math.abs(diff));
        balEl.style.color = diff < 0 ? "var(--danger)" : "var(--ok)";
        statusEl.textContent = statusOf(received, b.grandTotal);
      };
      recv.oninput = refresh; refresh();

      a.root.querySelector("#pm-methods").onclick = (e) => {
        const btn = e.target.closest("[data-m]"); if (!btn) return;
        method = btn.dataset.m;
        a.root.querySelectorAll("#pm-methods .chip").forEach((c) => c.classList.toggle("on", c === btn));
        if (method === "Credit") recv.value = 0;
        refresh();
      };
      a.root.querySelector("#pm-quick").onclick = (e) => {
        const btn = e.target.closest("[data-c]"); if (!btn) return;
        recv.value = btn.dataset.c; refresh();
      };

      a.root.querySelector("#pm-save").onclick = async () => {
        const box = a.root.querySelector("#pm-err");
        const fail = (m) => { box.textContent = m; box.classList.remove("hidden"); };
        box.classList.add("hidden");
        const status = statusOf(received, b.grandTotal);
        if (status !== "paid" && !customer) return fail("Attach a customer before saving a credit or part-paid bill.");
        await saveBill(b, { method, received, status }, a, onDone, go);
      };
    }
  });
}

/**
 * What is owed decides the status, never the button that was pressed. Picking
 * Credit empties the amount, so it lands here as nothing received; but if an
 * amount is then typed, the bill is part-paid or paid, and calling it credit
 * would put a due on the customer that the figures do not back up.
 */
const statusOf = (received, total) => {
  if (received >= total - 0.009) return "paid";
  if (received <= 0) return "credit";
  return "partial";
};

function quickCash(total) {
  const opts = new Set();
  [100, 200, 500, 1000, 2000, 5000].forEach((n) => { if (n >= total) opts.add(n); });
  opts.add(Math.ceil(total / 100) * 100);
  opts.add(Math.ceil(total / 500) * 500);
  return [...opts].filter((n) => n > 0 && n >= total).sort((a, b) => a - b).slice(0, 4);
}

async function saveBill(b, pay, sheet, onDone, go) {
  try {
    busy(true, "Saving bill…");
    const settings = state.settings || {};
    const invoiceNumber = await nextInvoiceNumber(settings);

    const items = b.lines.map((l) => ({
      productId: l.productId, productName: l.productName, sku: l.sku || "", barcode: l.barcode || "",
      colour: l.colour || "", size: l.size || "",
      qty: l.qty, price: l.price, discount: toNum(l.discount),
      lineDiscount: l.lineDiscount, amount: l.amount, netAmount: l.netAmount,
      gstRate: l.gstRate, taxableAmount: l.taxableAmount, taxAmount: l.taxAmount,
      stockAfter: round2(toNum(l.product?.stock) - l.qty)
    }));

    const sale = {
      invoiceNumber,
      customerId: customer?.id || "", customerName: customer?.name || "Walk-in",
      customerMobile: customer?.mobile || "", customerGstin: customer?.gstin || "",
      staffId: state.user?.uid || "", staffName: state.user?.name || "",
      items,
      subtotal: b.subtotal, lineDiscount: b.lineDiscount, billDiscount: b.billDiscount, discount: b.discount,
      taxableAmount: b.taxableAmount, cgst: b.cgst, sgst: b.sgst, igst: b.igst, tax: b.tax,
      roundOff: b.roundOff, grandTotal: b.grandTotal,
      paymentMethod: pay.method, paymentStatus: pay.status,
      amountReceived: round2(pay.received),
      balance: round2(b.grandTotal - pay.received),
      gstEnabled: gstActive(),
      businessGstin: settings.gstin || "",
      note, itemCount: items.length,
      totalQty: items.reduce((a, i) => a + i.qty, 0)
    };

    const saleId = await createSale(sale, cart);
    sheet.close();
    // A null id means the network was down and the bill is waiting in the
    // outbox; it goes to the server by itself when the connection returns.
    ok(saleId ? `${invoiceNumber} saved` : `${invoiceNumber} saved offline · will sync`);
    clearCart(); onDone();

    afterSaleSheet({ ...sale, id: saleId, createdAt: new Date() }, settings, go);
  } catch (e) {
    console.error(e);
    err(e.message || "Could not save the bill.");
  } finally { busy(false); }
}

/* ============================================================
   After-save: print / share
   ============================================================ */
export function afterSaleSheet(sale, settings, go) {
  openSheet({
    title: sale.invoiceNumber,
    body: `
      <div class="tc mb">
        <div style="font-size:30px;font-weight:700;color:var(--ok)">${money(sale.grandTotal)}</div>
        <div class="small muted">${sale.paymentMethod} · ${String(sale.paymentStatus).toUpperCase()} · ${fmtDate(sale.createdAt)} ${fmtTime(sale.createdAt)}</div>
      </div>
      <div class="btn-row mb">
        <button class="btn btn-primary" id="as-print">${icon("print")} Print bill</button>
        <button class="btn btn-soft" id="as-share">${icon("download")} Share</button>
      </div>
      <div class="sec-title">Preview</div>
      <div class="receipt" id="as-preview">${receiptHtml(sale, settings)}</div>`,
    footer: `<button class="btn btn-soft" data-close>Done</button>
             <button class="btn btn-primary" id="as-new">New bill</button>`,
    onMount(a) {
      a.root.querySelector("#as-print").onclick = async () => {
        try { busy(true, "Printing…"); const how = await printSale(sale, settings); ok(how === "browser" ? "Opened print preview" : "Bill sent to printer"); }
        catch (e) { err(e.message); } finally { busy(false); }
      };
      a.root.querySelector("#as-share").onclick = async () => {
        const text = plainReceipt(sale, settings);
        if (navigator.share) { try { await navigator.share({ title: sale.invoiceNumber, text }); } catch {} }
        else { await navigator.clipboard.writeText(text); ok("Bill copied to clipboard"); }
      };
      a.root.querySelector("#as-new").onclick = () => { a.close(); (go || window.demo.go)("#/billing"); };
    }
  });
}

function plainReceipt(sale, settings) {
  const lines = [
    settings.businessName || "ARUMBAGAM",
    settings.address || "", settings.mobile ? "Ph: " + settings.mobile : "", "",
    `Invoice: ${sale.invoiceNumber}`,
    `Date: ${fmtDate(sale.createdAt)} ${fmtTime(sale.createdAt)}`,
    `Customer: ${sale.customerName}`, ""
  ];
  (sale.items || []).forEach((i) => lines.push(`${i.productName} x${i.qty}  ₹${num(i.netAmount)}`));
  lines.push("", `Subtotal: ₹${num(sale.subtotal)}`);
  if (sale.discount) lines.push(`Discount: -₹${num(sale.discount)}`);
  if (sale.tax) lines.push(`GST: ₹${num(sale.tax)}`);
  lines.push(`TOTAL: ₹${num(sale.grandTotal)}`, `Paid by ${sale.paymentMethod}`, "", settings.footerMessage || "Thank you!");
  return lines.filter((l) => l !== undefined).join("\n");
}
