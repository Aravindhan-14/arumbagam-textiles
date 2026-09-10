/* ============================================================
   VYRA SAREES - Purchases (stock in from suppliers)
   ============================================================ */
import { state, can, costOf, findByCode, supplierById } from "../store.js";
import { C, queryRange, recent, createPurchase, nextPurchaseNumber } from "../db.js";
import { icon, openSheet, emptyState, statCard, ok, err, warn, busy, confirmDialog, toast } from "../ui.js";
import {
  esc, money, money0, num, toNum, toInt, round2, computeBill, fmtDate, fmtDateTime,
  startOfMonth, endOfDay, sum, download, toCsv, dateInput
} from "../utils.js";
import { pickProduct, pickSupplier, openProductEditor } from "./_shared.js";
import { setScanHandler } from "../app.js";

export const title = "Purchases";

let lines = [];          // { product, qty, rate, gstRate, discount }
let supplier = null;
let invoiceRef = "", paidAmount = 0, purchaseDate = dateInput();

export async function mount(view, { sub, go }) {
  if (!can("purchases.manage")) { view.innerHTML = emptyState("Not permitted", "Ask the shop owner for access", "alert"); return; }
  if (sub[0] === "new") return newPurchase(view, go);
  return listPurchases(view, go);
}

/* ============================================================
   History
   ============================================================ */
async function listPurchases(view, go) {
  view.innerHTML = `<div class="empty">${icon("clock")}<b>Loading…</b></div>`;
  let rows = [];
  try { rows = await queryRange(C.purchases, startOfMonth(), endOfDay()); }
  catch { rows = await recent(C.purchases, 50).catch(() => []); }

  const total = sum(rows, (r) => r.grandTotal);
  const due = sum(rows, (r) => toNum(r.grandTotal) - toNum(r.amountPaid));

  view.innerHTML = `
    <div class="stats mb">
      ${statCard("This Month", rows.length, "purchases")}
      ${statCard("Value", money0(total), "stock bought")}
      ${statCard("Paid", money0(sum(rows, (r) => r.amountPaid)), "to suppliers")}
      ${statCard("Payable", money0(due), "outstanding", due > 0 ? "warn" : "")}
    </div>
    <button class="btn btn-primary btn-block btn-lg mb" id="pu-new">${icon("plus")} New Purchase</button>
    <div class="sec-title">Recent purchases</div>
    <ul class="list card pad0" id="pu-list">
      ${rows.length ? rows.map((p) => `
        <li class="row" data-id="${p.id}">
          <div class="thumb">${icon("cart")}</div>
          <div class="mid"><b>${esc(p.purchaseNumber || "-")}</b>
            <small>${esc(p.supplierName || "-")} · ${fmtDate(p.createdAt)} · ${(p.items || []).length} items</small></div>
          <div class="end"><b>${money(p.grandTotal)}</b>
            <small class="pill ${p.paymentStatus === "paid" ? "ok" : "warn"}">${esc(p.paymentStatus || "")}</small></div>
        </li>`).join("") : emptyState("No purchases this month", "Record stock arriving from suppliers", "cart")}
    </ul>
    ${rows.length ? `<button class="btn btn-soft btn-sm mt" id="pu-export">${icon("download")} Export CSV</button>` : ""}`;

  view.querySelector("#pu-new").onclick = () => go("#/purchases/new");
  view.querySelector("#pu-list").onclick = (e) => {
    const li = e.target.closest("[data-id]");
    if (li) viewPurchase(rows.find((r) => r.id === li.dataset.id));
  };
  const ex = view.querySelector("#pu-export");
  if (ex) ex.onclick = () => {
    download(`vyra-purchases-${Date.now()}.csv`, toCsv(rows, [
      { label: "Number", key: "purchaseNumber" }, { label: "Date", get: (r) => fmtDate(r.createdAt) },
      { label: "Supplier", key: "supplierName" }, { label: "Invoice ref", key: "invoiceRef" },
      { label: "Items", get: (r) => (r.items || []).length },
      { label: "Subtotal", key: "subtotal" }, { label: "GST", key: "tax" },
      { label: "Total", key: "grandTotal" }, { label: "Paid", key: "amountPaid" },
      { label: "Status", key: "paymentStatus" }
    ]));
    ok("Purchases exported");
  };
}

function viewPurchase(p) {
  if (!p) return;
  openSheet({
    title: p.purchaseNumber || "Purchase",
    body: `
      <div class="tc mb">
        <div style="font-size:28px;font-weight:700">${money(p.grandTotal)}</div>
        <div class="small muted">${esc(p.supplierName || "-")} · ${fmtDateTime(p.createdAt)}</div>
      </div>
      ${p.invoiceRef ? `<div class="card pad0 mb"><div class="row" style="cursor:default">
        <div class="mid"><small>Supplier invoice</small></div><div class="end"><b>${esc(p.invoiceRef)}</b></div></div></div>` : ""}
      <div class="card pad0 tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
          <tbody>${(p.items || []).map((i) => `<tr>
            <td>${esc(i.productName)}<br><span class="mono small muted">${esc(i.sku || "")}</span></td>
            <td class="num">${i.qty}</td><td class="num">${num(i.rate)}</td>
            <td class="num">${num(i.netAmount ?? i.amount)}</td></tr>`).join("")}</tbody>
        </table>
      </div>
      <div class="card mt">
        <div class="trow"><span>Subtotal</span><b>${money(p.subtotal)}</b></div>
        ${toNum(p.discount) ? `<div class="trow"><span>Discount</span><b>-${money(p.discount)}</b></div>` : ""}
        ${toNum(p.tax) ? `<div class="trow"><span>GST</span><b>${money(p.tax)}</b></div>` : ""}
        <div class="trow grand"><span>Total</span><b>${money(p.grandTotal)}</b></div>
        <div class="trow"><span>Paid</span><b>${money(p.amountPaid)}</b></div>
        ${toNum(p.grandTotal) - toNum(p.amountPaid) > 0
      ? `<div class="trow"><span>Balance</span><b style="color:var(--danger)">${money(toNum(p.grandTotal) - toNum(p.amountPaid))}</b></div>` : ""}
      </div>`,
    footer: `<button class="btn btn-soft btn-block" data-close>Close</button>`
  });
}

/* ============================================================
   New purchase
   ============================================================ */
function newPurchase(view, go) {
  lines = []; supplier = null; invoiceRef = ""; paidAmount = 0; purchaseDate = dateInput();

  view.innerHTML = `
    <div class="card pad0 mb0" id="pn-supplier"></div>
    <div class="grid2">
      <label class="field"><span>Supplier invoice no.</span><input id="pn-ref" placeholder="Optional"></label>
      <label class="field"><span>Purchase date</span><input id="pn-date" type="date" value="${purchaseDate}"></label>
    </div>

    <div class="btn-row mb">
      <button class="btn btn-primary" id="pn-add">${icon("plus")} Add item</button>
      <button class="btn btn-soft" id="pn-newprod">${icon("box")} New product</button>
    </div>

    <div class="card pad0">
      <ul class="list" id="pn-lines"></ul>
      <div class="totals" id="pn-totals"></div>
    </div>

    <label class="field"><span>Amount paid now (₹)</span>
      <input id="pn-paid" type="number" inputmode="decimal" step="0.01" min="0" value="0"></label>

    <div class="btn-row mt">
      <button class="btn btn-soft" id="pn-cancel">Cancel</button>
      <button class="btn btn-ok" id="pn-save">${icon("check")} Save &amp; add stock</button>
    </div>`;

  const el = {
    sup: view.querySelector("#pn-supplier"),
    lines: view.querySelector("#pn-lines"),
    totals: view.querySelector("#pn-totals")
  };

  const bill = () => computeBill(
    lines.map((l) => ({ qty: l.qty, price: l.rate, discount: l.discount, gstRate: l.gstRate })),
    { gstEnabled: state.settings?.gstEnabled !== false, gstMode: "exclusive", billDiscount: 0, roundOff: true }
  );

  function paint() {
    el.sup.innerHTML = supplier
      ? `<div class="row" id="pn-sup-row"><div class="thumb">${esc((supplier.name || "?").slice(0, 2).toUpperCase())}</div>
         <div class="mid"><b>${esc(supplier.name)}</b><small>${esc(supplier.mobile || "")}</small></div>
         <div class="end"><button class="btn btn-ghost btn-sm">Change</button></div></div>`
      : `<div class="row" id="pn-sup-row"><div class="thumb">${icon("truck")}</div>
         <div class="mid"><b>Select supplier</b><small>Required</small></div><div class="end">${icon("plus")}</div></div>`;

    const b = bill();
    el.lines.innerHTML = lines.length ? lines.map((l, i) => `
      <li class="cart-item" data-i="${i}">
        <div class="ci-mid">
          <b>${esc(l.product.productName)}</b>
          <small>${esc(l.product.sku || "")} · stock ${toNum(l.product.stock)} → ${toNum(l.product.stock) + toNum(l.qty)}</small>
          <div class="flex" style="gap:8px">
            <div class="qty">
              <button data-act="dec">−</button>
              <input data-qty type="number" inputmode="numeric" value="${l.qty}" min="1">
              <button data-act="inc">+</button>
            </div>
            <button class="btn btn-ghost btn-sm" data-act="edit" style="padding:6px 4px">@ ${money(l.rate)} · GST ${l.gstRate}%</button>
          </div>
        </div>
        <div class="ci-end"><b>${money(b.lines[i].netAmount)}</b>
          <button class="del" data-act="del">Remove</button></div>
      </li>`).join("") : emptyState("No items yet", "Add the products you purchased", "cart");

    el.totals.innerHTML = lines.length ? `
      <div class="trow"><span>Subtotal</span><b>${money(b.subtotal)}</b></div>
      ${b.discount ? `<div class="trow"><span>Discount</span><b>-${money(b.discount)}</b></div>` : ""}
      ${b.tax ? `<div class="trow"><span>GST</span><b>${money(b.tax)}</b></div>` : ""}
      <div class="trow grand"><span>Total</span><b>${money(b.grandTotal)}</b></div>` : "";
  }

  const addLine = (p, qty = 1) => {
    const ex = lines.find((l) => l.product.id === p.id);
    if (ex) ex.qty += qty;
    else lines.unshift({
      product: p, qty,
      rate: costOf(p.id) || round2(toNum(p.sellingPrice) * 0.7),
      gstRate: toNum(p.gstRate), discount: 0
    });
    paint();
  };

  el.sup.onclick = () => pickSupplier((s) => { supplier = s; paint(); });
  view.querySelector("#pn-add").onclick = () => pickProduct((p) => addLine(p));
  view.querySelector("#pn-newprod").onclick = () => openProductEditor(null, (p) => addLine(p));
  view.querySelector("#pn-cancel").onclick = async () => {
    if (lines.length && !await confirmDialog("Discard this purchase?", { okText: "Discard", danger: true })) return;
    go("#/purchases");
  };

  el.lines.onclick = (e) => {
    const btn = e.target.closest("[data-act]"); if (!btn) return;
    const i = toInt(btn.closest("[data-i]").dataset.i);
    const act = btn.dataset.act;
    if (act === "inc") lines[i].qty++;
    if (act === "dec") lines[i].qty = Math.max(1, lines[i].qty - 1);
    if (act === "del") lines.splice(i, 1);
    if (act === "edit") return editLine(i, paint);
    paint();
  };
  el.lines.onchange = (e) => {
    const inp = e.target.closest("[data-qty]"); if (!inp) return;
    const i = toInt(inp.closest("[data-i]").dataset.i);
    lines[i].qty = Math.max(1, toInt(inp.value, 1)); paint();
  };

  setScanHandler((code) => {
    const p = findByCode(code);
    if (p) { addLine(p); toast(`${p.productName} added`); }
    else warn("No product matches that code");
  });

  view.querySelector("#pn-save").onclick = async () => {
    if (!supplier) return warn("Please select a supplier.");
    if (!lines.length) return warn("Add at least one item.");
    const b = bill();
    const paid = toNum(view.querySelector("#pn-paid").value);
    if (paid > b.grandTotal + 0.01) return warn("Amount paid is more than the purchase total.");
    if (!await confirmDialog(`Save this purchase of ${money(b.grandTotal)}? Stock will be increased.`, { okText: "Save" })) return;

    try {
      busy(true, "Saving purchase…");
      const settings = state.settings || {};
      const purchaseNumber = await nextPurchaseNumber(settings);
      const items = lines.map((l, i) => ({
        productId: l.product.id, productName: l.product.productName, sku: l.product.sku || "",
        qty: l.qty, rate: l.rate, discount: l.discount, gstRate: l.gstRate,
        amount: b.lines[i].amount, netAmount: b.lines[i].netAmount,
        taxableAmount: b.lines[i].taxableAmount, taxAmount: b.lines[i].taxAmount
      }));
      const payload = {
        purchaseNumber,
        supplierId: supplier.id, supplierName: supplier.name, supplierGstin: supplier.gstin || "",
        invoiceRef: view.querySelector("#pn-ref").value.trim(),
        purchaseDate: view.querySelector("#pn-date").value,
        items,
        subtotal: b.subtotal, discount: b.discount, taxableAmount: b.taxableAmount,
        cgst: b.cgst, sgst: b.sgst, igst: b.igst, tax: b.tax,
        roundOff: b.roundOff, grandTotal: b.grandTotal,
        amountPaid: paid,
        paymentStatus: paid >= b.grandTotal - 0.009 ? "paid" : paid > 0 ? "partial" : "pending",
        staffId: state.user?.uid || "", staffName: state.user?.name || "",
        totalQty: items.reduce((a, i) => a + toNum(i.qty), 0)
      };
      await createPurchase(payload, lines);
      ok(`${purchaseNumber} saved · stock updated`);
      lines = []; supplier = null;
      go("#/purchases");
    } catch (e) { console.error(e); err(e.message || "Could not save the purchase."); }
    finally { busy(false); }
  };

  paint();
}

function editLine(i, paint) {
  const l = lines[i];
  openSheet({
    title: l.product.productName,
    body: `
      <div class="grid2">
        <label class="field"><span>Purchase rate (₹)</span>
          <input id="pl-rate" type="number" inputmode="decimal" step="0.01" min="0" value="${l.rate}"></label>
        <label class="field"><span>Quantity</span>
          <input id="pl-qty" type="number" inputmode="numeric" step="1" min="1" value="${l.qty}"></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Discount per piece (₹)</span>
          <input id="pl-disc" type="number" inputmode="decimal" step="0.01" min="0" value="${l.discount}"></label>
        <label class="field"><span>GST rate</span>
          <select id="pl-gst">${[0, 3, 5, 12, 18, 28].map((r) => `<option value="${r}" ${r === toNum(l.gstRate) ? "selected" : ""}>${r}%</option>`).join("")}</select></label>
      </div>
      <p class="form-note">Selling price is ${money(l.product.sellingPrice)}. The purchase rate is saved back onto the product for profit reporting.</p>`,
    footer: `<button class="btn btn-soft" data-close>Cancel</button><button class="btn btn-primary" id="pl-ok">Apply</button>`,
    onMount(a) {
      a.root.querySelector("#pl-ok").onclick = () => {
        l.rate = toNum(a.root.querySelector("#pl-rate").value);
        l.qty = Math.max(1, toInt(a.root.querySelector("#pl-qty").value, 1));
        l.discount = toNum(a.root.querySelector("#pl-disc").value);
        l.gstRate = toNum(a.root.querySelector("#pl-gst").value);
        a.close(); paint();
      };
    }
  });
}
