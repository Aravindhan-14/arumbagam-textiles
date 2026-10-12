/* ============================================================
   ARUMBAGAM - Sales history
   ============================================================ */
import { state, can, canSeeCost, costOf } from "../store.js";
import { C, queryRange, cancelSale, getDocById } from "../db.js";
import { icon, openSheet, emptyState, statCard, ok, err, warn, busy, confirmDialog, promptDialog, toast } from "../ui.js";
import {
  esc, money, money0, num, toNum, round2, fmtDate, fmtTime, fmtDateTime, startOfDay, endOfDay, addDays,
  startOfWeek, startOfMonth, dateInput, sum, matches, debounce, download, toCsv
} from "../utils.js";
import { printSale, receiptHtml } from "../hw/documents.js";

export const title = "Sales History";

const RANGES = [
  { k: "today", label: "Today" },
  { k: "yesterday", label: "Yesterday" },
  { k: "week", label: "This Week" },
  { k: "month", label: "This Month" },
  { k: "custom", label: "Custom" }
];

export async function mount(view, { params, go }) {
  let rangeKey = params.range || "today";
  let from = startOfDay(), to = endOfDay();
  let q = "", payFilter = "", sales = [];

  const setRange = (k) => {
    rangeKey = k;
    const now = new Date();
    if (k === "today") { from = startOfDay(now); to = endOfDay(now); }
    else if (k === "yesterday") { from = startOfDay(addDays(now, -1)); to = endOfDay(addDays(now, -1)); }
    else if (k === "week") { from = startOfWeek(now); to = endOfDay(now); }
    else if (k === "month") { from = startOfMonth(now); to = endOfDay(now); }
  };
  setRange(rangeKey);

  view.innerHTML = `
    <div class="chips" id="sl-ranges">
      ${RANGES.map((r) => `<button class="chip ${r.k === rangeKey ? "on" : ""}" data-r="${r.k}">${r.label}</button>`).join("")}
    </div>
    <div class="flex mb hidden" id="sl-custom">
      <input type="date" class="inp" id="sl-from" value="${dateInput(from)}">
      <input type="date" class="inp" id="sl-to" value="${dateInput(to)}">
      <button class="btn btn-primary btn-sm" id="sl-apply">Go</button>
    </div>
    <div class="searchbar">
      <div class="swrap">${icon("search")}<input id="sl-q" placeholder="Invoice, customer, mobile, staff…"></div>
    </div>
    <div class="chips" id="sl-pay">
      ${["", "Cash", "UPI", "Card", "Credit"].map((m) => `<button class="chip ${m === "" ? "on" : ""}" data-p="${m}">${m || "All payments"}</button>`).join("")}
    </div>
    <div class="stats mb" id="sl-stats"></div>
    <ul class="list card pad0" id="sl-list"></ul>
    <button class="btn btn-soft btn-sm mt" id="sl-export">${icon("download")} Export CSV</button>`;

  const listEl = view.querySelector("#sl-list");
  const statsEl = view.querySelector("#sl-stats");

  const load = async () => {
    listEl.innerHTML = `<li class="row" style="cursor:default"><div class="mid muted">Loading…</div></li>`;
    try {
      sales = await queryRange(C.sales, from, to);
    } catch (e) {
      listEl.innerHTML = emptyState("Could not load sales", e.message, "alert");
      return;
    }
    paint();
  };

  const paint = () => {
    let list = sales;
    if (payFilter) list = list.filter((s) => s.paymentMethod === payFilter);
    if (q) list = list.filter((s) => matches([s.invoiceNumber, s.customerName, s.customerMobile, s.staffName].join(" "), q));
    if (!can("sales.viewAll")) list = list.filter((s) => s.staffId === state.user?.uid);

    const active = list.filter((s) => s.status !== "cancelled");
    statsEl.innerHTML = `
      ${statCard("Bills", active.length, list.length > active.length ? `${list.length - active.length} cancelled` : "")}
      ${statCard("Sales", money0(sum(active, (s) => s.grandTotal)), rangeLabel())}
      ${statCard("Discount", money0(sum(active, (s) => s.discount)), "given")}
      ${statCard("Collected", money0(sum(active, (s) => s.amountReceived)), `${money0(sum(active, (s) => toNum(s.grandTotal) - toNum(s.amountReceived)))} pending`)}`;

    listEl.innerHTML = list.length ? list.map((s) => `
      <li class="row" data-id="${s.id}">
        <div class="thumb" style="${s.status === "cancelled" ? "background:var(--danger-bg);color:var(--danger);border:none" : ""}">${icon("bill")}</div>
        <div class="mid"><b>${esc(s.invoiceNumber || "-")}${s.status === "cancelled" ? ' <span class="pill danger">Cancelled</span>' : ""}</b>
          <small>${esc(s.customerName || "Walk-in")} · ${fmtDate(s.createdAt)} ${fmtTime(s.createdAt)}</small></div>
        <div class="end"><b>${money(s.grandTotal)}</b>
          <small class="pill ${s.paymentStatus === "paid" ? "ok" : s.paymentStatus === "partial" ? "warn" : "info"}">${esc(s.paymentMethod || "")}</small></div>
      </li>`).join("") : emptyState("No bills in this period", "Change the date range or filters", "bill");

    listEl.onclick = (e) => {
      const li = e.target.closest("[data-id]");
      if (li) openBill(sales.find((s) => s.id === li.dataset.id), load, go);
    };
  };

  const rangeLabel = () => RANGES.find((r) => r.k === rangeKey)?.label || "";

  view.querySelector("#sl-ranges").onclick = (e) => {
    const b = e.target.closest("[data-r]"); if (!b) return;
    view.querySelectorAll("#sl-ranges .chip").forEach((c) => c.classList.toggle("on", c === b));
    const k = b.dataset.r;
    view.querySelector("#sl-custom").classList.toggle("hidden", k !== "custom");
    if (k !== "custom") { setRange(k); load(); } else rangeKey = "custom";
  };
  view.querySelector("#sl-apply").onclick = () => {
    from = startOfDay(new Date(view.querySelector("#sl-from").value));
    to = endOfDay(new Date(view.querySelector("#sl-to").value));
    if (isNaN(from) || isNaN(to)) return warn("Choose both dates");
    load();
  };
  view.querySelector("#sl-pay").onclick = (e) => {
    const b = e.target.closest("[data-p]"); if (!b) return;
    view.querySelectorAll("#sl-pay .chip").forEach((c) => c.classList.toggle("on", c === b));
    payFilter = b.dataset.p; paint();
  };
  view.querySelector("#sl-q").oninput = debounce((e) => { q = e.target.value.trim(); paint(); }, 150);
  view.querySelector("#sl-export").onclick = () => {
    download(`demo-sales-${dateInput(from)}_${dateInput(to)}.csv`, toCsv(sales, [
      { label: "Invoice", key: "invoiceNumber" },
      { label: "Date", get: (s) => fmtDateTime(s.createdAt) },
      { label: "Customer", key: "customerName" }, { label: "Mobile", key: "customerMobile" },
      { label: "Staff", key: "staffName" }, { label: "Items", key: "itemCount" },
      { label: "Subtotal", key: "subtotal" }, { label: "Discount", key: "discount" },
      { label: "Taxable", key: "taxableAmount" }, { label: "GST", key: "tax" },
      { label: "Total", key: "grandTotal" }, { label: "Received", key: "amountReceived" },
      { label: "Method", key: "paymentMethod" }, { label: "Status", key: "paymentStatus" },
      { label: "Bill status", key: "status" }
    ]));
    ok("Sales exported");
  };

  await load();
  if (params.id) {
    const s = sales.find((x) => x.id === params.id) || await getDocById(C.sales, params.id).catch(() => null);
    if (s) openBill(s, load, go);
  }
}

/* ============================================================
   Bill detail
   ============================================================ */
export function openBill(sale, onChange, go) {
  if (!sale) return err("Bill not found");
  const settings = state.settings || {};
  const cancelled = sale.status === "cancelled";
  // Bills do not carry what the shop paid, so profit is worked out against
  // the cost on file - and only for the owner, who is the only one who has it.
  const profit = canSeeCost()
    ? round2((sale.items || []).reduce(
        (a, i) => a + (toNum(i.netAmount) - toNum(i.taxAmount) - costOf(i.productId) * toNum(i.qty)), 0))
    : 0;

  openSheet({
    title: sale.invoiceNumber || "Bill",
    body: `
      ${cancelled ? `<div class="form-error">This bill was cancelled${sale.cancelReason ? ` · ${esc(sale.cancelReason)}` : ""}</div>` : ""}
      <div class="tc mb">
        <div style="font-size:30px;font-weight:700">${money(sale.grandTotal)}</div>
        <div class="small muted">${fmtDate(sale.createdAt)} ${fmtTime(sale.createdAt)} · ${esc(sale.paymentMethod || "")} ·
          <span class="pill ${sale.paymentStatus === "paid" ? "ok" : "warn"}">${esc(sale.paymentStatus || "")}</span></div>
      </div>

      <div class="card pad0 mb">
        <div class="row" style="cursor:default"><div class="mid"><small>Customer</small></div>
          <div class="end"><b>${esc(sale.customerName || "Walk-in")}</b>${sale.customerMobile ? `<small>${esc(sale.customerMobile)}</small>` : ""}</div></div>
        <div class="row" style="cursor:default"><div class="mid"><small>Billed by</small></div>
          <div class="end"><b>${esc(sale.staffName || "-")}</b></div></div>
        ${toNum(sale.balance) > 0 ? `<div class="row" style="cursor:default"><div class="mid"><small>Balance due</small></div>
          <div class="end"><b style="color:var(--danger)">${money(sale.balance)}</b></div></div>` : ""}
      </div>

      <div class="sec-title">Items</div>
      <div class="card pad0 tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
          <tbody>${(sale.items || []).map((i) => `<tr>
            <td>${esc(i.productName)}<br><span class="mono small muted">${esc(i.sku || "")}</span></td>
            <td class="num">${i.qty}</td><td class="num">${num(i.price)}</td>
            <td class="num">${num(i.netAmount ?? i.amount)}</td></tr>`).join("")}</tbody>
        </table>
      </div>

      <div class="card mt">
        <div class="trow"><span>Subtotal</span><b>${money(sale.subtotal)}</b></div>
        ${toNum(sale.discount) ? `<div class="trow"><span>Discount</span><b>-${money(sale.discount)}</b></div>` : ""}
        ${toNum(sale.tax) ? `<div class="trow"><span>Taxable</span><b>${money(sale.taxableAmount)}</b></div>
          ${toNum(sale.igst) ? `<div class="trow"><span>IGST</span><b>${money(sale.igst)}</b></div>`
        : `<div class="trow"><span>CGST</span><b>${money(sale.cgst)}</b></div>
             <div class="trow"><span>SGST</span><b>${money(sale.sgst)}</b></div>`}` : ""}
        ${Math.abs(toNum(sale.roundOff)) >= 0.01 ? `<div class="trow"><span>Round off</span><b>${money(sale.roundOff)}</b></div>` : ""}
        <div class="trow grand"><span>Total</span><b>${money(sale.grandTotal)}</b></div>
        <div class="trow"><span>Received</span><b>${money(sale.amountReceived)}</b></div>
      </div>

      ${profit ? `<div class="small muted tc mt">Estimated gross profit ${money(profit)}</div>` : ""}
      ${sale.note ? `<p class="small muted mt">Note: ${esc(sale.note)}</p>` : ""}`,
    footer: `<button class="btn btn-soft" data-close>Close</button>
             <button class="btn btn-primary" id="bs-print">${icon("print")} Reprint</button>`,
    onMount(api) {
      api.root.querySelector("#bs-print").onclick = async () => {
        try { busy(true, "Printing…"); await printSale(sale, settings, { copy: cancelled ? "CANCELLED COPY" : "" }); ok("Sent to printer"); }
        catch (e) { err(e.message); } finally { busy(false); }
      };

      const extra = document.createElement("div");
      extra.className = "btn-row mt";
      extra.innerHTML = `
        <button class="btn btn-soft btn-sm" id="bs-share">${icon("download")} Share</button>
        ${!cancelled && can("returns.create") ? `<button class="btn btn-soft btn-sm" id="bs-return">${icon("ret")} Return</button>` : ""}
        ${!cancelled && can("sales.cancel") ? `<button class="btn btn-danger btn-sm" id="bs-cancel">${icon("x")} Cancel bill</button>` : ""}`;
      api.body.appendChild(extra);

      extra.querySelector("#bs-share").onclick = async () => {
        const text = `${settings.businessName || "ARUMBAGAM"}\n${sale.invoiceNumber}\n${fmtDateTime(sale.createdAt)}\n\n` +
          (sale.items || []).map((i) => `${i.productName} x${i.qty}  ₹${num(i.netAmount ?? i.amount)}`).join("\n") +
          `\n\nTotal: ₹${num(sale.grandTotal)}\n${settings.footerMessage || ""}`;
        if (navigator.share) { try { await navigator.share({ title: sale.invoiceNumber, text }); } catch {} }
        else { await navigator.clipboard.writeText(text); ok("Copied"); }
      };
      const rb = extra.querySelector("#bs-return");
      if (rb) rb.onclick = () => { api.close(); (go || window.demo.go)(`#/returns?sale=${sale.id}`); };
      const cb = extra.querySelector("#bs-cancel");
      if (cb) cb.onclick = async () => {
        if (!await confirmDialog(`Cancel ${sale.invoiceNumber}? Stock will be returned and the sale reversed.`,
          { okText: "Cancel bill", danger: true })) return;
        const reason = await promptDialog("Reason for cancelling", { title: "Cancel bill", okText: "Confirm" });
        if (reason === null) return;
        try {
          busy(true, "Cancelling…");
          await cancelSale(sale, reason || "");
          api.close(); ok("Bill cancelled");
          if (onChange) onChange();
        } catch (e) { err(e.message); } finally { busy(false); }
      };
    }
  });
}
