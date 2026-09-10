/* ============================================================
   VYRA SAREES - Reports
   ============================================================ */
import { state, can, canSeeCost, costOf, lowStockProducts, outOfStockProducts, stockValue, totalStockUnits } from "../store.js";
import { C, queryRange } from "../db.js";
import { icon, emptyState, statCard, ok, err, warn, busy, toast } from "../ui.js";
import {
  esc, money, money0, num, toNum, round2, fmtDate, dateInput, startOfDay, endOfDay,
  addDays, startOfWeek, startOfMonth, sum, groupBy, download, toCsv
} from "../utils.js";

export const title = "Reports";

const TABS = [
  { k: "sales", label: "Sales" },
  { k: "products", label: "Products" },
  { k: "categories", label: "Categories" },
  { k: "customers", label: "Customers" },
  { k: "staff", label: "Staff" },
  { k: "gst", label: "GST" },
  { k: "inventory", label: "Inventory" },
  { k: "profit", label: "Profit", cost: true }
];

export async function mount(view, { go }) {
  let tab = "sales";
  let from = startOfMonth(), to = endOfDay();
  let sales = [], purchases = [], returns = [], loaded = false;

  view.innerHTML = `
    <div class="chips" id="rp-range">
      ${[["today", "Today"], ["week", "This Week"], ["month", "This Month"], ["last", "Last Month"], ["custom", "Custom"]]
      .map(([k, l]) => `<button class="chip ${k === "month" ? "on" : ""}" data-r="${k}">${l}</button>`).join("")}
    </div>
    <div class="flex mb hidden" id="rp-custom">
      <input type="date" class="inp" id="rp-from" value="${dateInput(from)}">
      <input type="date" class="inp" id="rp-to" value="${dateInput(to)}">
      <button class="btn btn-primary btn-sm" id="rp-apply">Go</button>
    </div>
    <div class="small muted mb" id="rp-period"></div>
    <div class="chips" id="rp-tabs">
      ${TABS.filter((t) => !t.cost || canSeeCost()).map((t) => `<button class="chip ${t.k === tab ? "on" : ""}" data-t="${t.k}">${t.label}</button>`).join("")}
    </div>
    <div id="rp-body"></div>`;

  const body = view.querySelector("#rp-body");
  const periodEl = view.querySelector("#rp-period");

  const setRange = (k) => {
    const now = new Date();
    if (k === "today") { from = startOfDay(now); to = endOfDay(now); }
    else if (k === "week") { from = startOfWeek(now); to = endOfDay(now); }
    else if (k === "month") { from = startOfMonth(now); to = endOfDay(now); }
    else if (k === "last") {
      const s = startOfMonth(now); from = startOfMonth(addDays(s, -1)); to = endOfDay(addDays(s, -1));
    }
  };

  const load = async () => {
    body.innerHTML = `<div class="empty">${icon("clock")}<b>Loading…</b></div>`;
    periodEl.textContent = `${fmtDate(from)} — ${fmtDate(to)}`;
    try {
      [sales, purchases, returns] = await Promise.all([
        queryRange(C.sales, from, to).catch(() => []),
        queryRange(C.purchases, from, to).catch(() => []),
        queryRange(C.returns, from, to).catch(() => [])
      ]);
      sales = sales.filter((s) => s.status !== "cancelled");
      if (!can("sales.viewAll")) sales = sales.filter((s) => s.staffId === state.user?.uid);
      loaded = true;
    } catch (e) { body.innerHTML = emptyState("Could not load reports", e.message, "alert"); return; }
    paint();
  };

  const paint = () => {
    if (!loaded) return;
    body.innerHTML = ({
      sales: salesReport, products: productReport, categories: categoryReport,
      customers: customerReport, staff: staffReport, gst: gstReport,
      inventory: inventoryReport, profit: profitReport
    }[tab] || salesReport)({ sales, purchases, returns, from, to });

    const btn = body.querySelector("#rp-export");
    if (btn) btn.onclick = () => exportTab(tab, { sales, purchases, returns, from, to });
  };

  view.querySelector("#rp-range").onclick = (e) => {
    const b = e.target.closest("[data-r]"); if (!b) return;
    view.querySelectorAll("#rp-range .chip").forEach((c) => c.classList.toggle("on", c === b));
    view.querySelector("#rp-custom").classList.toggle("hidden", b.dataset.r !== "custom");
    if (b.dataset.r !== "custom") { setRange(b.dataset.r); load(); }
  };
  view.querySelector("#rp-apply").onclick = () => {
    from = startOfDay(new Date(view.querySelector("#rp-from").value));
    to = endOfDay(new Date(view.querySelector("#rp-to").value));
    if (isNaN(from) || isNaN(to)) return warn("Choose both dates");
    load();
  };
  view.querySelector("#rp-tabs").onclick = (e) => {
    const b = e.target.closest("[data-t]"); if (!b) return;
    view.querySelectorAll("#rp-tabs .chip").forEach((c) => c.classList.toggle("on", c === b));
    tab = b.dataset.t; paint();
  };

  await load();
}

/* ============================================================
   Report renderers
   ============================================================ */
function salesReport({ sales, purchases, returns }) {
  const total = sum(sales, (s) => s.grandTotal);
  const collected = sum(sales, (s) => s.amountReceived);
  const byDay = [...groupBy(sales, (s) => s.dayKey || dateInput(s.createdAt?.toDate?.() || new Date())).entries()]
    .sort((a, b) => b[0].localeCompare(a[0]));
  const byMethod = [...groupBy(sales, (s) => s.paymentMethod || "Other").entries()];

  return `
    <div class="stats mb">
      ${statCard("Bills", sales.length, "in period")}
      ${statCard("Net Sales", money0(total), "after discount")}
      ${statCard("Collected", money0(collected), money0(total - collected) + " pending", total - collected > 0 ? "warn" : "ok")}
      ${statCard("Discount", money0(sum(sales, (s) => s.discount)), "given away")}
      ${statCard("GST", money0(sum(sales, (s) => s.tax)), "collected")}
      ${statCard("Items sold", sum(sales, (s) => s.totalQty || sum(s.items || [], (i) => i.qty)), "pieces")}
      ${statCard("Purchases", money0(sum(purchases, (p) => p.grandTotal)), `${purchases.length} entries`)}
      ${statCard("Returns", money0(sum(returns, (r) => r.returnValue)), `${returns.length} entries`, returns.length ? "warn" : "")}
    </div>

    <div class="sec-title">Payment mix</div>
    <div class="card pad0 tbl-wrap"><table class="tbl">
      <thead><tr><th>Method</th><th class="num">Bills</th><th class="num">Amount</th><th class="num">Share</th></tr></thead>
      <tbody>${byMethod.sort((a, b) => sum(b[1], (x) => x.grandTotal) - sum(a[1], (x) => x.grandTotal)).map(([m, rows]) => {
        const amt = sum(rows, (r) => r.grandTotal);
        return `<tr><td>${esc(m)}</td><td class="num">${rows.length}</td><td class="num">${num(amt)}</td>
          <td class="num">${total ? ((amt / total) * 100).toFixed(1) : 0}%</td></tr>`;
      }).join("")}</tbody></table></div>

    <div class="sec-title">Day by day</div>
    <div class="card pad0 tbl-wrap"><table class="tbl">
      <thead><tr><th>Date</th><th class="num">Bills</th><th class="num">Sales</th><th class="num">Discount</th><th class="num">GST</th></tr></thead>
      <tbody>${byDay.map(([d, rows]) => `<tr>
        <td>${esc(d)}</td><td class="num">${rows.length}</td>
        <td class="num">${num(sum(rows, (r) => r.grandTotal))}</td>
        <td class="num">${num(sum(rows, (r) => r.discount))}</td>
        <td class="num">${num(sum(rows, (r) => r.tax))}</td></tr>`).join("")}</tbody></table></div>
    <button class="btn btn-soft btn-sm mt" id="rp-export">${icon("download")} Export CSV</button>`;
}

function lineItems(sales) {
  const rows = [];
  sales.forEach((s) => (s.items || []).forEach((i) => rows.push({ ...i, sale: s })));
  return rows;
}

/* Bills do not store what the shop paid - that stays in the owner-only cost
   record - so profit is worked out against the cost on file today. */
const lineCost = (i) => costOf(i.productId) * toNum(i.qty);
const lineProfit = (i) => round2(toNum(i.netAmount) - toNum(i.taxAmount) - lineCost(i));

function productReport({ sales }) {
  const g = groupBy(lineItems(sales), (i) => i.productId || i.productName);
  const rows = [...g.entries()].map(([, items]) => ({
    name: items[0].productName, sku: items[0].sku,
    qty: sum(items, (i) => i.qty),
    amount: round2(sum(items, (i) => toNum(i.netAmount ?? i.amount))),
    profit: round2(sum(items, lineProfit))
  })).sort((a, b) => b.amount - a.amount);

  return `<div class="sec-title">Product-wise sales (${rows.length})</div>
    ${rows.length ? `<div class="card pad0 tbl-wrap"><table class="tbl">
      <thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Sales</th>${canSeeCost() ? '<th class="num">Profit</th>' : ""}</tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(r.name)}<br><span class="mono small muted">${esc(r.sku || "")}</span></td>
        <td class="num">${r.qty}</td><td class="num">${num(r.amount)}</td>
        ${canSeeCost() ? `<td class="num" style="color:var(--${r.profit >= 0 ? "ok" : "danger"})">${num(r.profit)}</td>` : ""}</tr>`).join("")}</tbody>
    </table></div>` : emptyState("No sales in this period", "", "chart")}
    <button class="btn btn-soft btn-sm mt" id="rp-export">${icon("download")} Export CSV</button>`;
}

function categoryReport({ sales }) {
  const items = lineItems(sales).map((i) => {
    const p = state.products.find((x) => x.id === i.productId);
    return { ...i, cat: p?.categoryName || "Uncategorised" };
  });
  const rows = [...groupBy(items, (i) => i.cat).entries()].map(([cat, list]) => ({
    cat, qty: sum(list, (i) => i.qty), amount: round2(sum(list, (i) => toNum(i.netAmount ?? i.amount)))
  })).sort((a, b) => b.amount - a.amount);
  const total = sum(rows, (r) => r.amount);

  return `<div class="sec-title">Category-wise sales</div>
    ${rows.length ? `<div class="card pad0 tbl-wrap"><table class="tbl">
      <thead><tr><th>Category</th><th class="num">Qty</th><th class="num">Sales</th><th class="num">Share</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(r.cat)}</td><td class="num">${r.qty}</td>
        <td class="num">${num(r.amount)}</td><td class="num">${total ? ((r.amount / total) * 100).toFixed(1) : 0}%</td></tr>`).join("")}</tbody>
    </table></div>` : emptyState("No sales in this period", "", "chart")}
    <button class="btn btn-soft btn-sm mt" id="rp-export">${icon("download")} Export CSV</button>`;
}

function customerReport({ sales }) {
  const rows = [...groupBy(sales, (s) => s.customerId || "walkin").entries()].map(([id, list]) => ({
    name: id === "walkin" ? "Walk-in customers" : (list[0].customerName || "-"),
    mobile: list[0].customerMobile || "",
    bills: list.length,
    amount: round2(sum(list, (s) => s.grandTotal)),
    due: round2(sum(list, (s) => toNum(s.grandTotal) - toNum(s.amountReceived)))
  })).sort((a, b) => b.amount - a.amount);

  return `<div class="sec-title">Customer-wise sales</div>
    ${rows.length ? `<div class="card pad0 tbl-wrap"><table class="tbl">
      <thead><tr><th>Customer</th><th class="num">Bills</th><th class="num">Sales</th><th class="num">Due</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(r.name)}<br><span class="small muted">${esc(r.mobile)}</span></td>
        <td class="num">${r.bills}</td><td class="num">${num(r.amount)}</td>
        <td class="num" style="color:var(--${r.due > 0 ? "danger" : "muted"})">${num(r.due)}</td></tr>`).join("")}</tbody>
    </table></div>` : emptyState("No sales in this period", "", "users")}
    <button class="btn btn-soft btn-sm mt" id="rp-export">${icon("download")} Export CSV</button>`;
}

function staffReport({ sales }) {
  const rows = [...groupBy(sales, (s) => s.staffId || "-").entries()].map(([, list]) => ({
    name: list[0].staffName || "Unknown",
    bills: list.length,
    amount: round2(sum(list, (s) => s.grandTotal)),
    discount: round2(sum(list, (s) => s.discount)),
    avg: round2(sum(list, (s) => s.grandTotal) / list.length)
  })).sort((a, b) => b.amount - a.amount);

  return `<div class="sec-title">Staff-wise sales</div>
    ${rows.length ? `<div class="card pad0 tbl-wrap"><table class="tbl">
      <thead><tr><th>Staff</th><th class="num">Bills</th><th class="num">Sales</th><th class="num">Discount</th><th class="num">Avg bill</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.bills}</td>
        <td class="num">${num(r.amount)}</td><td class="num">${num(r.discount)}</td><td class="num">${num(r.avg)}</td></tr>`).join("")}</tbody>
    </table></div>` : emptyState("No sales in this period", "", "user")}
    <button class="btn btn-soft btn-sm mt" id="rp-export">${icon("download")} Export CSV</button>`;
}

function gstReport({ sales, purchases }) {
  const items = lineItems(sales);
  const rows = [...groupBy(items, (i) => toNum(i.gstRate)).entries()].map(([rate, list]) => {
    const taxable = round2(sum(list, (i) => i.taxableAmount));
    const tax = round2(sum(list, (i) => i.taxAmount));
    return { rate, taxable, tax, cgst: round2(tax / 2), sgst: round2(tax / 2) };
  }).sort((a, b) => a.rate - b.rate);

  const outputTax = sum(rows, (r) => r.tax);
  const inputTax = sum(purchases, (p) => p.tax);

  return `
    <div class="stats mb">
      ${statCard("Output GST", money0(outputTax), "collected on sales")}
      ${statCard("Input GST", money0(inputTax), "paid on purchases")}
      ${statCard("Net payable", money0(Math.max(0, outputTax - inputTax)), "output − input", outputTax - inputTax > 0 ? "warn" : "ok")}
      ${statCard("Taxable value", money0(sum(rows, (r) => r.taxable)), "of sales")}
    </div>
    <div class="sec-title">Rate-wise breakup (sales)</div>
    ${rows.length ? `<div class="card pad0 tbl-wrap"><table class="tbl">
      <thead><tr><th>Rate</th><th class="num">Taxable</th><th class="num">CGST</th><th class="num">SGST</th><th class="num">Total tax</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${r.rate}%</td><td class="num">${num(r.taxable)}</td>
        <td class="num">${num(r.cgst)}</td><td class="num">${num(r.sgst)}</td><td class="num">${num(r.tax)}</td></tr>`).join("")}</tbody>
    </table></div>` : emptyState("No GST recorded in this period", "", "file")}
    <p class="form-note mt">Business GSTIN: ${esc(state.settings?.gstin || "not configured")}. This summary is for reference; file returns from your accounting records.</p>
    <button class="btn btn-soft btn-sm mt" id="rp-export">${icon("download")} Export CSV</button>`;
}

function inventoryReport() {
  const low = lowStockProducts(), out = outOfStockProducts();
  const rows = [...state.products].filter((p) => (p.status || "active") === "active")
    .sort((a, b) => toNum(a.stock) - toNum(b.stock)).slice(0, 200);
  return `
    <div class="stats mb">
      ${statCard("Products", state.products.length, "active + inactive")}
      ${statCard("Units", totalStockUnits(), "in stock")}
      ${canSeeCost() ? statCard("Stock value", money0(stockValue()), "at cost") : ""}
      ${statCard("Needs action", low.length + out.length, `${out.length} out · ${low.length} low`, low.length + out.length ? "warn" : "ok")}
    </div>
    <div class="sec-title">Stock position</div>
    <div class="card pad0 tbl-wrap"><table class="tbl">
      <thead><tr><th>Product</th><th class="num">Stock</th><th class="num">Min</th>${canSeeCost() ? '<th class="num">Value</th>' : ""}</tr></thead>
      <tbody>${rows.map((p) => `<tr>
        <td>${esc(p.productName)}<br><span class="mono small muted">${esc(p.sku || "")}</span></td>
        <td class="num" style="color:var(--${toNum(p.stock) <= 0 ? "danger" : toNum(p.stock) <= toNum(p.minimumStock) ? "warn" : "text"})">${toNum(p.stock)}</td>
        <td class="num">${toNum(p.minimumStock)}</td>
        ${canSeeCost() ? `<td class="num">${num(toNum(p.stock) * costOf(p.id))}</td>` : ""}</tr>`).join("")}</tbody>
    </table></div>
    <button class="btn btn-soft btn-sm mt" id="rp-export">${icon("download")} Export CSV</button>`;
}

function profitReport({ sales, purchases }) {
  if (!canSeeCost()) return emptyState("Not permitted", "Profit reports are limited to the shop owner", "alert");
  const items = lineItems(sales);
  const withCost = items.filter((i) => costOf(i.productId) > 0);
  const revenue = round2(sum(items, (i) => toNum(i.netAmount) - toNum(i.taxAmount)));
  const cost = round2(sum(withCost, lineCost));
  const profit = round2(revenue - cost);
  const coverage = items.length ? Math.round((withCost.length / items.length) * 100) : 0;

  const rows = [...groupBy(withCost, (i) => i.productId).entries()].map(([, list]) => ({
    name: list[0].productName, sku: list[0].sku,
    qty: sum(list, (i) => i.qty),
    revenue: round2(sum(list, (i) => toNum(i.netAmount) - toNum(i.taxAmount))),
    cost: round2(sum(list, lineCost))
  })).map((r) => ({ ...r, profit: round2(r.revenue - r.cost) })).sort((a, b) => b.profit - a.profit);

  return `
    <div class="stats mb">
      ${statCard("Revenue", money0(revenue), "net of GST")}
      ${statCard("Cost of goods", money0(cost), "purchase value")}
      ${statCard("Gross profit", money0(profit), revenue ? ((profit / revenue) * 100).toFixed(1) + "% margin" : "", profit >= 0 ? "ok" : "danger")}
      ${statCard("Purchases", money0(sum(purchases, (p) => p.grandTotal)), "stock bought in period")}
    </div>
    ${coverage < 100 ? `<p class="form-note">${coverage}% of sold items have a purchase price on record. Add purchase prices from the product screen for a complete picture.</p>` : ""}
    <div class="sec-title">Most profitable products</div>
    ${rows.length ? `<div class="card pad0 tbl-wrap"><table class="tbl">
      <thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Revenue</th><th class="num">Cost</th><th class="num">Profit</th></tr></thead>
      <tbody>${rows.slice(0, 60).map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.qty}</td>
        <td class="num">${num(r.revenue)}</td><td class="num">${num(r.cost)}</td>
        <td class="num" style="color:var(--${r.profit >= 0 ? "ok" : "danger"})">${num(r.profit)}</td></tr>`).join("")}</tbody>
    </table></div>` : emptyState("No costed sales in this period", "Record purchase prices on products", "chart")}
    <button class="btn btn-soft btn-sm mt" id="rp-export">${icon("download")} Export CSV</button>`;
}

/* ---------- exports ---------- */
function exportTab(tab, { sales, purchases, from, to }) {
  const stamp = `${dateInput(from)}_${dateInput(to)}`;
  const items = lineItems(sales);
  let rows = [], headers = [], name = tab;

  if (tab === "sales") {
    rows = sales; name = "sales";
    headers = [
      { label: "Invoice", key: "invoiceNumber" }, { label: "Date", get: (s) => fmtDate(s.createdAt) },
      { label: "Customer", key: "customerName" }, { label: "Staff", key: "staffName" },
      { label: "Subtotal", key: "subtotal" }, { label: "Discount", key: "discount" },
      { label: "Taxable", key: "taxableAmount" }, { label: "GST", key: "tax" },
      { label: "Total", key: "grandTotal" }, { label: "Received", key: "amountReceived" },
      { label: "Method", key: "paymentMethod" }
    ];
  } else if (tab === "inventory") {
    rows = state.products; name = "inventory";
    headers = [
      { label: "SKU", key: "sku" }, { label: "Product", key: "productName" },
      { label: "Category", key: "categoryName" }, { label: "Stock", key: "stock" },
      { label: "Minimum", key: "minimumStock" },
      ...(canSeeCost() ? [{ label: "Cost", get: (p) => costOf(p.id) }] : []),
      { label: "Selling", key: "sellingPrice" },
      ...(canSeeCost() ? [{ label: "Value", get: (p) => (toNum(p.stock) * costOf(p.id)).toFixed(2) }] : [])
    ];
  } else {
    rows = items; name = tab;
    headers = [
      { label: "Date", get: (i) => fmtDate(i.sale.createdAt) },
      { label: "Invoice", get: (i) => i.sale.invoiceNumber },
      { label: "Customer", get: (i) => i.sale.customerName },
      { label: "Staff", get: (i) => i.sale.staffName },
      { label: "SKU", key: "sku" }, { label: "Product", key: "productName" },
      { label: "Qty", key: "qty" }, { label: "Rate", key: "price" },
      { label: "Net", key: "netAmount" }, { label: "GST%", key: "gstRate" },
      { label: "Taxable", key: "taxableAmount" }, { label: "Tax", key: "taxAmount" },
      ...(canSeeCost() ? [{ label: "Cost", get: (i) => costOf(i.productId) }] : [])
    ];
  }
  download(`vyra-${name}-${stamp}.csv`, toCsv(rows, headers));
  ok("Report exported");
}
