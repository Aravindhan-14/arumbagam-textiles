/* ============================================================
   ARUMBAGAM - Dashboard
   ============================================================ */
import { state, on, lowStockProducts, outOfStockProducts, totalStockUnits, stockValue, can, canSeeCost } from "../store.js";
import { queryRange, recent, listDocs, C } from "../db.js";
import { icon, statCard, emptyState, toast } from "../ui.js";
import { esc, money0, money, startOfDay, endOfDay, toNum, round2, fmtTime, ago, sum, fmtDate } from "../utils.js";

export const title = "Dashboard";

export async function mount(view, { go }) {
  const paint = async () => {
    view.innerHTML = skeleton();
    const [sales, purchases, unpaid] = await Promise.all([
      queryRange(C.sales, startOfDay(), endOfDay()).catch(() => []),
      recent(C.purchases, 5).catch(() => []),
      // Every bill still carrying a balance, whenever it was written. The
      // running total on each customer can fall behind - a till that was
      // offline, a bill from before dues were counted - and a pending amount
      // that quietly reads zero is the one thing the shop must never be
      // shown, so the bills are asked as well.
      listDocs(C.sales, { where: [["paymentStatus", "in", ["credit", "partial"]]], limit: 2000 })
        .catch(() => null)
    ]);
    const active = sales.filter((s) => s.status !== "cancelled");
    const todayTotal = sum(active, (s) => s.grandTotal);
    const low = lowStockProducts(), out = outOfStockProducts();
    const dues = state.customers.filter((c) => toNum(c.outstanding) > 0);
    const dueTotal = sum(dues, (c) => c.outstanding);

    const onCredit = unpaid === null ? null : round2(sum(
      unpaid.filter((s) => s.status !== "cancelled" && s.customerId),
      (s) => Math.max(0, toNum(s.grandTotal) - toNum(s.amountReceived))
    ));
    // Collections come off the running total and not off the bill, so the
    // bills reading higher is normal. Lower is not, and neither is a zero
    // sitting under bills that are plainly unpaid.
    const shortfall = onCredit !== null && onCredit > dueTotal + 0.01 ? round2(onCredit - dueTotal) : 0;

    view.innerHTML = `
      ${setupCard()}
      <div class="card" style="background:linear-gradient(135deg,var(--maroon),var(--maroon-d));color:#fff;border:none">
        <div class="small" style="opacity:.8;letter-spacing:1.5px;text-transform:uppercase">Today · ${fmtDate(new Date())}</div>
        <div style="font-size:32px;font-weight:700;margin:4px 0 2px">${money0(todayTotal)}</div>
        <div class="small" style="opacity:.85">${active.length} bill${active.length === 1 ? "" : "s"} · ${sum(active, (s) => (s.items || []).length)} items sold</div>
      </div>

      <div class="stats mb">
        ${statCard("Today's Bills", active.length, sales.length > active.length ? `${sales.length - active.length} cancelled` : "")}
        ${statCard("Products", state.products.length, `${totalStockUnits()} pcs in stock`)}
        ${statCard("Low Stock", low.length, "at or below minimum", low.length ? "warn" : "")}
        ${statCard("Out of Stock", out.length, "needs restocking", out.length ? "danger" : "")}
        ${statCard("Customers", state.customers.length, `${dues.length} with dues`)}
        ${statCard("Pending Payments", money0(dueTotal),
    shortfall ? `${money0(onCredit)} on credit in bills` : "customer outstanding",
    shortfall ? "danger" : dueTotal > 0 ? "warn" : "")}
        ${canSeeCost() ? statCard("Stock Value", money0(stockValue()), "at purchase cost") : ""}
        ${canSeeCost() ? statCard("Suppliers", state.suppliers.length, `${money0(sum(state.suppliers, (s) => s.outstanding))} payable`) : ""}
      </div>

      <div class="sec-title">Quick Actions</div>
      <div class="quick mb">
        ${can("sales.create") ? `<button data-go="#/billing">${icon("bill")}New Bill</button>` : ""}
        <button data-go="#/scan">${icon("scan")}Scan Product</button>
        ${can("products.create") ? `<button data-act="add-product">${icon("plus")}Add Product</button>` : ""}
        ${can("inventory.view") ? `<button data-go="#/inventory">${icon("stack")}Add Stock</button>` : ""}
        ${can("labels.print") ? `<button data-go="#/labels">${icon("qr")}Print QR</button>` : ""}
        <button data-go="#/sales">${icon("rupee")}Sales History</button>
      </div>

      ${alerts(low, out, dues, shortfall, onCredit)}

      <div class="sec-title">Recent Bills</div>
      <ul class="list card pad0" id="dash-bills">
        ${active.length ? active.slice(0, 6).map(billRow).join("") : emptyState("No bills yet today", "Tap New Bill to start selling", "bill")}
      </ul>

      ${purchases.length ? `<div class="sec-title">Recent Purchases</div>
        <ul class="list card pad0">${purchases.map(purchaseRow).join("")}</ul>` : ""}
    `;

    view.querySelectorAll("[data-go]").forEach((b) => { b.onclick = () => go(b.dataset.go); });
    const addBtn = view.querySelector('[data-act="add-product"]');
    if (addBtn) addBtn.onclick = async () => {
      if (!can("products.create")) return toast("Only the shop owner can add products");
      const { openProductEditor } = await import("./_shared.js");
      openProductEditor(null, () => paint());
    };
    view.querySelectorAll("[data-sale]").forEach((el) => {
      el.onclick = () => go(`#/sales?id=${el.dataset.sale}`);
    });
    view.querySelectorAll("[data-alert]").forEach((el) => { el.onclick = () => go(el.dataset.alert); });
  };

  await paint();
  const off = on("products", () => { /* stock cards refresh on next visit */ });
  return () => off();
}

const skeleton = () => `<div class="card" style="height:110px"></div><div class="stats">
  ${Array(6).fill('<div class="stat" style="height:74px"></div>').join("")}</div>`;

/** Shown until the shop owner saves the business details for the first time. */
function setupCard() {
  if (!state.user || state.user.role !== "admin") return "";
  const s = state.settings || {};
  const steps = [
    { done: !!s._configured, label: "Save your business details & GST", go: "#/settings" },
    { done: state.categories.length > 0, label: "Add product categories", go: "#/categories" },
    { done: state.products.length > 0, label: "Add your first products", go: "#/products" }
  ];
  if (steps.every((x) => x.done)) return "";
  return `<div class="card" style="border-color:var(--gold)">
    <div class="card-head"><h3>Finish setting up</h3><span class="pill warn">${steps.filter((x) => x.done).length}/${steps.length}</span></div>
    ${steps.map((x) => `<div class="row" style="padding:9px 0;border:none" data-alert="${x.go}">
      <div class="thumb" style="width:26px;height:26px;border:none;background:var(--${x.done ? "ok" : "warn"}-bg);color:var(--${x.done ? "ok" : "warn"})">
        ${icon(x.done ? "check" : "plus")}</div>
      <div class="mid"><b style="font-weight:${x.done ? 400 : 600};${x.done ? "opacity:.6" : ""}">${esc(x.label)}</b></div>
    </div>`).join("")}
    <p class="form-note mb0">Saving your business details also closes the one-time setup window in the security rules.</p>
  </div>`;
}

function alerts(low, out, dues, shortfall = 0, onCredit = 0) {
  const items = [];
  if (shortfall) {
    items.push({
      cls: "danger", ic: "rupee",
      t: `${money(onCredit)} sold on credit is not on the customers`,
      s: `Only ${money(sum(dues, (d) => d.outstanding))} is on record - open Customers and recheck`,
      go: "#/customers"
    });
  }
  const stockGo = (f) => (can("inventory.view") ? `#/inventory?filter=${f}` : `#/products?filter=${f}`);
  if (out.length) items.push({ cls: "danger", ic: "alert", t: `${out.length} product${out.length > 1 ? "s" : ""} out of stock`, s: out.slice(0, 3).map((p) => p.productName).join(", "), go: stockGo("out") });
  if (low.length) items.push({ cls: "warn", ic: "alert", t: `${low.length} product${low.length > 1 ? "s" : ""} running low`, s: low.slice(0, 3).map((p) => `${p.productName} (${p.stock})`).join(", "), go: stockGo("low") });
  if (dues.length) items.push({ cls: "info", ic: "rupee", t: `${dues.length} customer${dues.length > 1 ? "s" : ""} with pending payment`, s: money(sum(dues, (d) => d.outstanding)) + " outstanding", go: "#/customers?filter=due" });
  if (!items.length) return "";
  return `<div class="sec-title">Alerts</div>
    <ul class="list card pad0">
      ${items.map((a) => `<li class="row" data-alert="${a.go}">
        <div class="thumb" style="background:var(--${a.cls}-bg);color:var(--${a.cls});border:none">${icon(a.ic)}</div>
        <div class="mid"><b>${esc(a.t)}</b><small>${esc(a.s)}</small></div>
        <div class="end">${icon("back", "")}</div></li>`).join("")}
    </ul>`;
}

const billRow = (s) => `<li class="row" data-sale="${s.id}">
  <div class="thumb">${icon("bill")}</div>
  <div class="mid"><b>${esc(s.invoiceNumber || "-")}</b>
    <small>${esc(s.customerName || "Walk-in")} · ${fmtTime(s.createdAt)}</small></div>
  <div class="end"><b>${money(s.grandTotal)}</b>
    <small class="pill ${s.paymentStatus === "paid" ? "ok" : "warn"}">${esc(s.paymentStatus || "paid")}</small></div></li>`;

const purchaseRow = (p) => `<li class="row">
  <div class="thumb">${icon("cart")}</div>
  <div class="mid"><b>${esc(p.purchaseNumber || "-")}</b><small>${esc(p.supplierName || "-")} · ${ago(p.createdAt)}</small></div>
  <div class="end"><b>${money(p.grandTotal)}</b><small>${(p.items || []).length} items</small></div></li>`;
