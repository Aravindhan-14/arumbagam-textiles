/* ============================================================
   VYRA SAREES - Returns & Exchange
   ============================================================ */
import { state, can, productById, findByCode } from "../store.js";
import { C, listDocs, getDocById, createReturn, nextReturnNumber, queryRange } from "../db.js";
import { icon, openSheet, emptyState, ok, err, warn, busy, confirmDialog, toast, statCard } from "../ui.js";
import {
  esc, money, num, toNum, toInt, round2, fmtDate, fmtTime, fmtDateTime,
  startOfMonth, endOfDay, sum, debounce
} from "../utils.js";
import { pickProduct } from "./_shared.js";
import { printReturnSlip } from "../hw/documents.js";

export const title = "Returns & Exchange";

const REASONS = ["Size issue", "Colour not suitable", "Damaged / defective", "Customer changed mind", "Wrong item billed", "Other"];

export async function mount(view, { params, go }) {
  if (!can("returns.create")) { view.innerHTML = emptyState("Not permitted", "Ask the shop owner for access", "alert"); return; }
  if (params.sale) {
    const found = await getDocById(C.sales, params.sale);
    if (found) return builder(view, found, go);
  }
  return landing(view, go);
}

/* ============================================================
   Landing: find the original bill
   ============================================================ */
async function landing(view, go) {
  view.innerHTML = `
    <div class="searchbar">
      <div class="swrap">${icon("search")}<input id="rt-q" placeholder="Invoice number, customer or mobile" data-scan-field="true"></div>
      <button class="icon-btn" id="rt-go">${icon("check")}</button>
    </div>
    <div class="sec-title">Recent bills</div>
    <ul class="list card pad0" id="rt-list"><li class="row" style="cursor:default"><div class="mid muted">Loading…</div></li></ul>
    <div class="sec-title">Returns this month</div>
    <ul class="list card pad0" id="rt-hist"></ul>`;

  const listEl = view.querySelector("#rt-list");
  let sales = [];
  try {
    const list = await listDocs(C.sales, { orderBy: { field: "createdAt", dir: "desc" }, limit: 40 });
    sales = list.filter((s) => s.status !== "cancelled");
  } catch (e) { listEl.innerHTML = emptyState("Could not load bills", e.message, "alert"); }

  const paintList = (rows) => {
    listEl.innerHTML = rows.length ? rows.slice(0, 25).map((s) => `
      <li class="row" data-id="${s.id}">
        <div class="thumb">${icon("bill")}</div>
        <div class="mid"><b>${esc(s.invoiceNumber)}</b>
          <small>${esc(s.customerName || "Walk-in")} · ${fmtDate(s.createdAt)} ${fmtTime(s.createdAt)}${s.hasReturn ? " · has returns" : ""}</small></div>
        <div class="end"><b>${money(s.grandTotal)}</b><small>${(s.items || []).length} items</small></div>
      </li>`).join("") : emptyState("No bills found", "Try the invoice number", "bill");
    listEl.onclick = (e) => {
      const li = e.target.closest("[data-id]");
      if (li) builder(view, rows.find((s) => s.id === li.dataset.id), go);
    };
  };
  paintList(sales);

  const search = async (term) => {
    const t = term.trim();
    if (!t) return paintList(sales);
    const local = sales.filter((s) =>
      [s.invoiceNumber, s.customerName, s.customerMobile].join(" ").toLowerCase().includes(t.toLowerCase()));
    if (local.length) return paintList(local);
    try {
      const hits = await listDocs(C.sales, { where: [["invoiceNumber", "==", t.toUpperCase()]], limit: 5 });
      paintList(hits);
    } catch { paintList([]); }
  };
  view.querySelector("#rt-q").oninput = debounce((e) => search(e.target.value), 250);
  view.querySelector("#rt-go").onclick = () => search(view.querySelector("#rt-q").value);

  try {
    const rows = await queryRange(C.returns, startOfMonth(), endOfDay());
    view.querySelector("#rt-hist").innerHTML = rows.length ? rows.map((r) => `
      <li class="row" style="cursor:default">
        <div class="thumb">${icon("ret")}</div>
        <div class="mid"><b>${esc(r.returnNumber)} <span class="pill ${r.type === "EXCHANGE" ? "info" : "warn"}">${esc(r.type)}</span></b>
          <small>${esc(r.invoiceNumber || "")} · ${fmtDate(r.createdAt)} · ${esc(r.reason || "")}</small></div>
        <div class="end"><b>${money(r.returnValue)}</b>
          <small>${toNum(r.refundAmount) ? "refund " + money(r.refundAmount) : toNum(r.differenceAmount) ? "collect " + money(r.differenceAmount) : ""}</small></div>
      </li>`).join("") : emptyState("No returns this month", "", "ret");
  } catch { view.querySelector("#rt-hist").innerHTML = ""; }
}

/* ============================================================
   Return / exchange builder
   ============================================================ */
function builder(view, sale, go) {
  if (!sale) return err("Bill not found");
  let mode = "RETURN";                 // RETURN | EXCHANGE
  const qtys = new Map();              // saleItemIndex -> qty
  const newItems = [];                 // { product, qty, price }
  let reason = REASONS[0], settle = "refund", collected = true;

  const returned = () => (sale.items || []).map((it, i) => ({ it, i, qty: toNum(qtys.get(i)) })).filter((x) => x.qty > 0);
  const returnValue = () => round2(sum(returned(), (x) => (toNum(x.it.netAmount ?? x.it.amount) / Math.max(1, toNum(x.it.qty))) * x.qty));
  const newValue = () => round2(sum(newItems, (n) => toNum(n.price) * toNum(n.qty)));

  function paint() {
    const rv = returnValue(), nv = newValue();
    const diff = round2(nv - rv);

    view.innerHTML = `
      <div class="card mb">
        <div class="flex between">
          <div><b>${esc(sale.invoiceNumber)}</b>
            <div class="small muted">${esc(sale.customerName || "Walk-in")} · ${fmtDateTime(sale.createdAt)}</div></div>
          <div class="tr"><b>${money(sale.grandTotal)}</b></div>
        </div>
      </div>

      <div class="chips mb">
        <button class="chip ${mode === "RETURN" ? "on" : ""}" data-mode="RETURN">Return</button>
        <button class="chip ${mode === "EXCHANGE" ? "on" : ""}" data-mode="EXCHANGE">Exchange</button>
      </div>

      <div class="sec-title">Items being returned</div>
      <ul class="list card pad0">
        ${(sale.items || []).map((it, i) => {
          const unit = toNum(it.netAmount ?? it.amount) / Math.max(1, toNum(it.qty));
          const q = toNum(qtys.get(i));
          return `<li class="cart-item" data-i="${i}">
            <div class="ci-mid">
              <b>${esc(it.productName)}</b>
              <small>${esc(it.sku || "")} · sold ${it.qty} @ ${money(unit)}</small>
              <div class="qty">
                <button data-act="dec">−</button>
                <input data-qty type="number" inputmode="numeric" value="${q}" min="0" max="${it.qty}">
                <button data-act="inc">+</button>
              </div>
            </div>
            <div class="ci-end"><b>${money(unit * q)}</b></div>
          </li>`;
        }).join("")}
      </ul>

      ${mode === "EXCHANGE" ? `
        <div class="sec-title">Replacement items</div>
        <ul class="list card pad0">
          ${newItems.length ? newItems.map((n, i) => `
            <li class="cart-item" data-n="${i}">
              <div class="ci-mid"><b>${esc(n.product.productName)}</b>
                <small>${esc(n.product.sku || "")} · stock ${toNum(n.product.stock)}</small>
                <div class="qty">
                  <button data-nact="dec">−</button>
                  <input data-nqty type="number" inputmode="numeric" value="${n.qty}" min="1">
                  <button data-nact="inc">+</button>
                </div></div>
              <div class="ci-end"><b>${money(n.price * n.qty)}</b>
                <button class="del" data-nact="del">Remove</button></div>
            </li>`).join("") : emptyState("No replacement chosen", "Pick what the customer is taking instead", "box")}
        </ul>
        <button class="btn btn-soft btn-block mb" id="rt-addnew">${icon("plus")} Add replacement item</button>` : ""}

      <div class="card">
        <div class="trow"><span>Return value</span><b>${money(rv)}</b></div>
        ${mode === "EXCHANGE" ? `<div class="trow"><span>New items</span><b>${money(nv)}</b></div>
          <div class="trow grand"><span>${diff >= 0 ? "Customer pays" : "Refund to customer"}</span><b>${money(Math.abs(diff))}</b></div>`
        : `<div class="trow grand"><span>Refund</span><b>${money(rv)}</b></div>`}
      </div>

      <label class="field"><span>Reason</span>
        <select id="rt-reason">${REASONS.map((r) => `<option ${r === reason ? "selected" : ""}>${r}</option>`).join("")}</select></label>

      ${mode === "RETURN" ? `
        <label class="field"><span>Settlement</span>
          <select id="rt-settle">
            <option value="refund" ${settle === "refund" ? "selected" : ""}>Cash / UPI refund</option>
            <option value="credit" ${settle === "credit" ? "selected" : ""}>Adjust against customer dues</option>
          </select></label>` : ""}

      ${mode === "EXCHANGE" && diff > 0 ? `
        <label class="check"><input type="checkbox" id="rt-collected" ${collected ? "checked" : ""}>
          <span>Difference collected now</span></label>` : ""}

      <div class="btn-row mt">
        <button class="btn btn-soft" id="rt-back">Back</button>
        <button class="btn btn-ok" id="rt-save" ${rv <= 0 ? "disabled" : ""}>${icon("check")} Confirm ${mode === "EXCHANGE" ? "exchange" : "return"}</button>
      </div>`;

    /* wiring */
    view.querySelectorAll("[data-mode]").forEach((b) => { b.onclick = () => { mode = b.dataset.mode; paint(); }; });
    view.querySelector("#rt-reason").onchange = (e) => { reason = e.target.value; };
    const settleEl = view.querySelector("#rt-settle");
    if (settleEl) settleEl.onchange = (e) => { settle = e.target.value; };
    const colEl = view.querySelector("#rt-collected");
    if (colEl) colEl.onchange = (e) => { collected = e.target.checked; };

    view.querySelectorAll("[data-i]").forEach((li) => {
      const i = toInt(li.dataset.i);
      const max = toNum(sale.items[i].qty);
      li.querySelectorAll("[data-act]").forEach((b) => {
        b.onclick = () => {
          const cur = toNum(qtys.get(i));
          qtys.set(i, Math.max(0, Math.min(max, cur + (b.dataset.act === "inc" ? 1 : -1))));
          paint();
        };
      });
      const inp = li.querySelector("[data-qty]");
      if (inp) inp.onchange = () => { qtys.set(i, Math.max(0, Math.min(max, toInt(inp.value, 0)))); paint(); };
    });

    view.querySelectorAll("[data-n]").forEach((li) => {
      const i = toInt(li.dataset.n);
      li.querySelectorAll("[data-nact]").forEach((b) => {
        b.onclick = () => {
          if (b.dataset.nact === "del") newItems.splice(i, 1);
          else newItems[i].qty = Math.max(1, newItems[i].qty + (b.dataset.nact === "inc" ? 1 : -1));
          paint();
        };
      });
      const inp = li.querySelector("[data-nqty]");
      if (inp) inp.onchange = () => { newItems[i].qty = Math.max(1, toInt(inp.value, 1)); paint(); };
    });

    const addNew = view.querySelector("#rt-addnew");
    if (addNew) addNew.onclick = () => pickProduct((p) => {
      const ex = newItems.find((n) => n.product.id === p.id);
      if (ex) ex.qty++; else newItems.push({ product: p, qty: 1, price: toNum(p.sellingPrice) });
      paint();
    }, { includeOutOfStock: false });

    view.querySelector("#rt-back").onclick = () => landing(view, go);
    view.querySelector("#rt-save").onclick = () => save(rv, nv, diff);
  }

  async function save(rv, nv, diff) {
    const items = returned();
    if (!items.length) return warn("Select at least one item to return.");
    if (mode === "EXCHANGE" && !newItems.length) return warn("Add the replacement item.");

    const summary = mode === "EXCHANGE"
      ? `Exchange ${items.length} item(s) worth ${money(rv)} for ${money(nv)}. ${diff >= 0 ? `Collect ${money(diff)}` : `Refund ${money(-diff)}`}.`
      : `Return ${items.length} item(s) and ${settle === "credit" ? "adjust" : "refund"} ${money(rv)}.`;
    if (!await confirmDialog(summary + " Stock will be updated.", { okText: "Confirm" })) return;

    try {
      busy(true, "Saving…");
      const settings = state.settings || {};
      const returnNumber = await nextReturnNumber(settings);

      const returnedItems = items.map((x) => {
        const unit = toNum(x.it.netAmount ?? x.it.amount) / Math.max(1, toNum(x.it.qty));
        return {
          productId: x.it.productId, productName: x.it.productName, sku: x.it.sku || "",
          qty: x.qty, price: round2(unit), amount: round2(unit * x.qty),
          product: productById(x.it.productId)
        };
      });
      const issued = newItems.map((n) => ({
        productId: n.product.id, productName: n.product.productName, sku: n.product.sku || "",
        qty: n.qty, price: n.price, amount: round2(n.price * n.qty), product: n.product
      }));

      const payload = {
        returnNumber, type: mode,
        saleId: sale.id, invoiceNumber: sale.invoiceNumber,
        customerId: sale.customerId || "", customerName: sale.customerName || "",
        returnedItems: returnedItems.map(({ product, ...r }) => r),
        newItems: issued.map(({ product, ...r }) => r),
        returnValue: rv, newValue: nv,
        differenceAmount: mode === "EXCHANGE" && diff > 0 ? diff : 0,
        refundAmount: mode === "EXCHANGE" ? (diff < 0 ? -diff : 0) : rv,
        mode: mode === "EXCHANGE" ? "exchange" : settle,
        collected: mode === "EXCHANGE" ? collected : true,
        reason,
        staffId: state.user?.uid || "", staffName: state.user?.name || ""
      };

      await createReturn(payload, returnedItems, issued);
      ok(`${returnNumber} saved · stock updated`);

      openSheet({
        title: returnNumber,
        body: `<div class="tc mb"><div style="font-size:28px;font-weight:700">${money(mode === "EXCHANGE" ? Math.abs(diff) : rv)}</div>
          <div class="small muted">${mode === "EXCHANGE" ? (diff >= 0 ? "to collect" : "to refund") : (settle === "credit" ? "adjusted against dues" : "to refund")}</div></div>
          <p class="small muted tc">Stock has been updated for ${returnedItems.length} returned item(s)${issued.length ? ` and ${issued.length} issued item(s)` : ""}.</p>`,
        footer: `<button class="btn btn-soft" data-close>Done</button>
                 <button class="btn btn-primary" id="rs-print">${icon("print")} Print slip</button>`,
        onMount(a) {
          a.root.querySelector("#rs-print").onclick = async () => {
            try { busy(true, "Printing…"); await printReturnSlip(payload, settings); ok("Slip sent to printer"); }
            catch (e) { err(e.message); } finally { busy(false); }
          };
          a.root.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) go("#/returns"); });
        }
      });
    } catch (e) { console.error(e); err(e.message || "Could not save the return."); }
    finally { busy(false); }
  }

  paint();
}
