/* ============================================================
   VYRA SAREES - Customers
   ============================================================ */
import { state, on, searchCustomers, can } from "../store.js";
import {
  C, col, query, where, orderBy, limit, getDocs, ref, updateDoc, increment,
  serverTimestamp, logActivity, removeDoc
} from "../db.js";
import { icon, openSheet, emptyState, statCard, ok, err, warn, busy, confirmDialog, toast } from "../ui.js";
import { esc, money, money0, toNum, debounce, fmtDate, fmtTime, sum, download, toCsv } from "../utils.js";
import { openCustomerEditor } from "./_shared.js";
import { openBill } from "./sales.js";

export const title = "Customers";

export async function mount(view, { params, go }) {
  let q = "", onlyDue = params.filter === "due";

  const paint = () => {
    let list = searchCustomers(q);
    if (onlyDue) list = list.filter((c) => toNum(c.outstanding) > 0);
    const dues = state.customers.filter((c) => toNum(c.outstanding) > 0);

    view.innerHTML = `
      <div class="stats mb">
        ${statCard("Customers", state.customers.length, "on record")}
        ${statCard("With Dues", dues.length, money0(sum(dues, (d) => d.outstanding)) + " pending", dues.length ? "warn" : "")}
      </div>
      <div class="searchbar">
        <div class="swrap">${icon("search")}<input id="cu-q" placeholder="Name, mobile, GSTIN…" value="${esc(q)}"></div>
        <button class="icon-btn" id="cu-add">${icon("plus")}</button>
      </div>
      <div class="chips">
        <button class="chip ${onlyDue ? "" : "on"}" data-f="all">All</button>
        <button class="chip ${onlyDue ? "on" : ""}" data-f="due">Pending payment</button>
      </div>
      <ul class="list card pad0">
        ${list.length ? list.slice(0, 250).map((c) => `
          <li class="row" data-id="${c.id}">
            <div class="thumb">${esc((c.name || "?").slice(0, 2).toUpperCase())}</div>
            <div class="mid"><b>${esc(c.name)}</b><small>${esc(c.mobile || "No mobile")}${c.gstin ? " · " + esc(c.gstin) : ""}</small></div>
            <div class="end"><b>${money0(c.totalPurchases)}</b>
              ${toNum(c.outstanding) > 0 ? `<small class="pill warn">Due ${money0(c.outstanding)}</small>` : `<small class="muted">lifetime</small>`}</div>
          </li>`).join("") : emptyState("No customers yet", "Add a customer to track purchases and dues", "users")}
      </ul>
      <button class="btn btn-soft btn-sm mt" id="cu-export">${icon("download")} Export CSV</button>`;

    view.querySelector("#cu-q").oninput = debounce((e) => { q = e.target.value.trim(); paint(); }, 150);
    view.querySelector("#cu-add").onclick = () => openCustomerEditor(null, () => paint());
    view.querySelectorAll("[data-f]").forEach((b) => { b.onclick = () => { onlyDue = b.dataset.f === "due"; paint(); }; });
    view.querySelectorAll("[data-id]").forEach((li) => {
      li.onclick = () => customerSheet(state.customers.find((c) => c.id === li.dataset.id), paint, go);
    });
    view.querySelector("#cu-export").onclick = () => {
      download(`vyra-customers-${Date.now()}.csv`, toCsv(state.customers, [
        { label: "Name", key: "name" }, { label: "Mobile", key: "mobile" }, { label: "Email", key: "email" },
        { label: "GSTIN", key: "gstin" }, { label: "Address", key: "address" },
        { label: "Total purchases", key: "totalPurchases" }, { label: "Outstanding", key: "outstanding" }
      ]));
      ok("Customers exported");
    };
  };

  paint();
  const off = on("customers", paint);
  return () => off();
}

/* ============================================================
   Customer detail
   ============================================================ */
export function customerSheet(c, onChange, go) {
  if (!c) return;
  openSheet({
    title: c.name,
    body: `
      <div class="stats mb">
        ${statCard("Lifetime", money0(c.totalPurchases), "purchases")}
        ${statCard("Outstanding", money0(c.outstanding), "to collect", toNum(c.outstanding) > 0 ? "warn" : "ok")}
      </div>
      <div class="card pad0 mb">
        ${row("Mobile", c.mobile || "-")}
        ${row("Email", c.email || "-")}
        ${row("GSTIN", c.gstin || "-")}
        ${row("Address", c.address || "-")}
        ${c.notes ? row("Notes", c.notes) : ""}
      </div>
      <div class="btn-row mb">
        ${c.mobile ? `<a class="btn btn-soft btn-sm" href="tel:${esc(c.mobile)}">Call</a>
        <a class="btn btn-soft btn-sm" href="https://wa.me/91${esc(c.mobile)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
        ${toNum(c.outstanding) > 0 ? `<button class="btn btn-ok btn-sm" id="cs-collect">Collect payment</button>` : ""}
      </div>
      <div class="sec-title">Purchase history</div>
      <ul class="list card pad0" id="cs-bills"><li class="row" style="cursor:default"><div class="mid muted">Loading…</div></li></ul>`,
    footer: `<button class="btn btn-soft" data-close>Close</button>
             <button class="btn btn-primary" id="cs-edit">${icon("edit")} Edit</button>`,
    async onMount(api) {
      api.root.querySelector("#cs-edit").onclick = () => { api.close(); openCustomerEditor(c, onChange); };

      const collect = api.root.querySelector("#cs-collect");
      if (collect) collect.onclick = () => collectSheet(c, () => { api.close(); if (onChange) onChange(); });

      const ul = api.root.querySelector("#cs-bills");
      try {
        const snap = await getDocs(query(col(C.sales), where("customerId", "==", c.id), orderBy("createdAt", "desc"), limit(40)));
        const bills = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        ul.innerHTML = bills.length ? bills.map((s) => `
          <li class="row" data-bill="${s.id}">
            <div class="thumb">${icon("bill")}</div>
            <div class="mid"><b>${esc(s.invoiceNumber)}${s.status === "cancelled" ? ' <span class="pill danger">Cancelled</span>' : ""}</b>
              <small>${fmtDate(s.createdAt)} ${fmtTime(s.createdAt)} · ${(s.items || []).length} items</small></div>
            <div class="end"><b>${money(s.grandTotal)}</b>
              <small class="pill ${s.paymentStatus === "paid" ? "ok" : "warn"}">${esc(s.paymentStatus || "")}</small></div>
          </li>`).join("") : emptyState("No purchases yet", "", "bill");
        ul.onclick = (e) => {
          const li = e.target.closest("[data-bill]"); if (!li) return;
          api.close(); openBill(bills.find((b) => b.id === li.dataset.bill), onChange, go);
        };
      } catch (e) { ul.innerHTML = emptyState("History unavailable", e.message, "alert"); }
    }
  });
}

function collectSheet(c, onDone) {
  openSheet({
    title: "Collect payment",
    body: `
      <div class="trow grand mb"><span>Outstanding</span><b>${money(c.outstanding)}</b></div>
      <label class="field"><span>Amount received (₹)</span>
        <input id="cp-amt" type="number" inputmode="decimal" step="0.01" min="0" value="${toNum(c.outstanding)}"></label>
      <label class="field"><span>Method</span>
        <select id="cp-method">${["Cash", "UPI", "Card", "Bank Transfer", "Other"].map((m) => `<option>${m}</option>`).join("")}</select></label>
      <label class="field"><span>Note</span><input id="cp-note" placeholder="Optional"></label>
      <div id="cp-err" class="form-error hidden"></div>`,
    footer: `<button class="btn btn-soft" data-close>Cancel</button>
             <button class="btn btn-ok" id="cp-ok">Record payment</button>`,
    onMount(api) {
      api.root.querySelector("#cp-ok").onclick = async () => {
        const amt = toNum(api.root.querySelector("#cp-amt").value);
        const box = api.root.querySelector("#cp-err");
        if (amt <= 0) { box.textContent = "Enter an amount greater than zero."; box.classList.remove("hidden"); return; }
        if (amt > toNum(c.outstanding) + 0.01) { box.textContent = "Amount is more than the outstanding balance."; box.classList.remove("hidden"); return; }
        try {
          busy(true, "Recording…");
          await updateDoc(ref(C.customers, c.id), {
            outstanding: increment(-amt), lastPaymentAt: serverTimestamp(), updatedAt: serverTimestamp()
          });
          logActivity(null, "PAYMENT_RECEIVED",
            `${c.name} · ₹${amt} · ${api.root.querySelector("#cp-method").value}${api.root.querySelector("#cp-note").value ? " · " + api.root.querySelector("#cp-note").value : ""}`,
            "customer", c.id);
          api.close(); ok(`${money(amt)} recorded`); onDone();
        } catch (e) { box.textContent = e.message; box.classList.remove("hidden"); } finally { busy(false); }
      };
    }
  });
}

const row = (k, v) => `<div class="row" style="cursor:default"><div class="mid"><small>${esc(k)}</small></div>
  <div class="end"><b style="font-weight:600;white-space:normal;text-align:right;display:block;max-width:200px">${esc(v)}</b></div></div>`;
