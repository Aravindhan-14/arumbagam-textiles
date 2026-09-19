/* ============================================================
   VYRA SAREES - Customers
   ============================================================ */
import { state, on, searchCustomers, can, isAdmin } from "../store.js";
import { C, listDocs, updateDocById, removeDoc, incr, logActivity, recalcCustomerDues } from "../db.js";
import { icon, openSheet, emptyState, statCard, ok, err, warn, busy, confirmDialog, toast, refocus } from "../ui.js";
import { esc, money, money0, toNum, round2, debounce, fmtDate, fmtTime, sum, download, toCsv } from "../utils.js";
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
      <div class="btn-row mt">
        <button class="btn btn-soft btn-sm" id="cu-export">${icon("download")} Export CSV</button>
        ${isAdmin() ? `<button class="btn btn-soft btn-sm" id="cu-recalc">${icon("ret")} Recheck pending payments</button>` : ""}
      </div>`;

    view.querySelector("#cu-q").oninput = debounce((e) => { q = e.target.value.trim(); paint(); refocus(view, "#cu-q"); }, 150);
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

    const recalc = view.querySelector("#cu-recalc");
    if (recalc) recalc.onclick = () => recheckDues(paint);
  };

  paint();
  const off = on("customers", paint);
  return () => off();
}

/**
 * Recount every customer's pending amount from the bills, the collections and
 * the returns. Bills saved while a till was offline, or before this was
 * counted at all, leave the running total short; nothing else puts it right.
 */
async function recheckDues(onDone) {
  const go = await confirmDialog(
    [
      "Recheck every customer's pending payment?",
      "",
      "The pending amount is worked out again from the bills, the payments",
      "collected and the returns. Any figure typed in by hand is replaced.",
      "",
      "Nothing else is touched - no bill and no stock changes."
    ].join("\n"),
    { okText: "Recheck now" }
  );
  if (!go) return;
  try {
    busy(true, "Rechecking…");
    const r = await recalcCustomerDues();
    busy(false);
    if (!r.fixed) { ok(`All ${r.checked} customers were already right`); return; }
    await confirmDialog(
      [
        `${r.fixed} of ${r.checked} customers corrected.`,
        `Pending payments now total ${money(r.total)}.`,
        "",
        ...r.rows.map((f) => `${f.name}: ${money(f.was)} → ${money(f.now)}`)
      ].join("\n"),
      { title: "Pending payments", okText: "Done" }
    );
    if (onDone) onDone();
  } catch (e) {
    busy(false);
    err(e?.code === "permission-denied"
      ? "Only the owner account can recheck the dues - it has to read the payment log."
      : (e.message || "Could not recheck the dues."));
  }
}

/* ============================================================
   Customer detail
   ============================================================ */
export function customerSheet(c, onChange, go) {
  if (!c) return;
  const due = toNum(c.outstanding);
  openSheet({
    title: c.name,
    body: `
      <div class="stats mb">
        ${statCard("Lifetime", money0(c.totalPurchases), "purchases")}
        ${statCard("Outstanding", money0(due), "to collect", due > 0 ? "warn" : "ok")}
      </div>
      <div id="cs-mismatch"></div>
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
        ${due > 0 ? `<button class="btn btn-ok btn-sm" id="cs-collect">Collect payment</button>` : ""}
        <button class="btn btn-soft btn-sm" id="cs-adjust">${icon("edit")} Set pending amount</button>
      </div>
      <div class="sec-title">Purchase history</div>
      <ul class="list card pad0" id="cs-bills"><li class="row" style="cursor:default"><div class="mid muted">Loading…</div></li></ul>`,
    footer: `<button class="btn btn-soft" data-close>Close</button>
             ${isAdmin() ? `<button class="btn btn-danger" id="cs-del">${icon("trash")} Delete</button>` : ""}
             <button class="btn btn-primary" id="cs-edit">${icon("edit")} Edit</button>`,
    async onMount(api) {
      const reopen = () => { api.close(); if (onChange) onChange(); };

      api.root.querySelector("#cs-edit").onclick = () => { api.close(); openCustomerEditor(c, onChange); };
      api.root.querySelector("#cs-adjust").onclick = () => adjustSheet(c, 0, reopen);

      const collect = api.root.querySelector("#cs-collect");
      if (collect) collect.onclick = () => collectSheet(c, reopen);

      const del = api.root.querySelector("#cs-del");
      if (del) del.onclick = () => deleteCustomer(c, api, onChange);

      const ul = api.root.querySelector("#cs-bills");
      try {
        // The whole history is read, not just the page that is shown, so the
        // billed-on-credit figure below counts every bill.
        const bills = await listDocs(C.sales, {
          where: [["customerId", "==", c.id]],
          orderBy: { field: "createdAt", dir: "desc" }, limit: 500
        });
        const live = bills.filter((s) => s.status !== "cancelled");
        const billed = round2(sum(live, (s) => Math.max(0, toNum(s.grandTotal) - toNum(s.amountReceived))));
        showMismatch(api.root.querySelector("#cs-mismatch"), c, billed, reopen);

        ul.innerHTML = bills.length ? bills.slice(0, 40).map((s) => {
          const left = round2(toNum(s.grandTotal) - toNum(s.amountReceived));
          return `<li class="row" data-bill="${s.id}">
            <div class="thumb">${icon("bill")}</div>
            <div class="mid"><b>${esc(s.invoiceNumber)}${s.status === "cancelled" ? ' <span class="pill danger">Cancelled</span>' : ""}</b>
              <small>${fmtDate(s.createdAt)} ${fmtTime(s.createdAt)} · ${(s.items || []).length} items${
  s.status !== "cancelled" && left > 0 ? ` · on credit ${money(left)}` : ""}</small></div>
            <div class="end"><b>${money(s.grandTotal)}</b>
              <small class="pill ${s.paymentStatus === "paid" ? "ok" : "warn"}">${esc(s.paymentStatus || "")}</small></div>
          </li>`;
        }).join("") : emptyState("No purchases yet", "", "bill");
        ul.onclick = (e) => {
          const li = e.target.closest("[data-bill]"); if (!li) return;
          api.close(); openBill(bills.find((b) => b.id === li.dataset.bill), onChange, go);
        };
      } catch (e) { ul.innerHTML = emptyState("History unavailable", e.message, "alert"); }
    }
  });
}

/**
 * The running total and the bills can drift apart - a bill saved while the
 * device was offline, or a collection recorded against the wrong customer.
 * Rather than quietly show a figure nobody can explain, say what the bills
 * add up to and offer that number.
 */
function showMismatch(box, c, billed, onDone) {
  if (!box) return;
  const due = toNum(c.outstanding);
  if (Math.abs(billed - due) < 0.01) return;
  box.innerHTML = `<div class="card mb" style="background:var(--surface-2)">
    <p class="form-note mb0">Bills on credit add up to <b>${money(billed)}</b>, but the pending
      amount on record is <b>${money(due)}</b>. Collections recorded later are not on the bills,
      so a difference can be right - set it if it is not.</p>
    <button class="btn btn-soft btn-sm mt" id="cs-usebills">Set pending to ${money(billed)}</button>
  </div>`;
  box.querySelector("#cs-usebills").onclick = () => adjustSheet(c, billed, onDone);
}

/* Set the pending amount to whatever it really is. */
function adjustSheet(c, suggested, onDone) {
  const due = toNum(c.outstanding);
  openSheet({
    title: "Pending payment",
    body: `
      <div class="trow mb"><span>On record now</span><b>${money(due)}</b></div>
      <label class="field"><span>Pending amount (₹)</span>
        <input id="ca-amt" type="number" inputmode="decimal" step="0.01" min="0"
          value="${suggested > 0 ? suggested : due}"></label>
      <label class="field"><span>Why it changed</span>
        <input id="ca-note" placeholder="e.g. opening balance, cash taken earlier"></label>
      <p class="form-note">This sets the figure outright. To take money against it, use
        <b>Collect payment</b> instead - that keeps the running total.</p>
      <div id="ca-err" class="form-error hidden"></div>`,
    footer: `<button class="btn btn-soft" data-close>Cancel</button>
             <button class="btn btn-primary" id="ca-ok">Save</button>`,
    onMount(api) {
      api.root.querySelector("#ca-ok").onclick = async () => {
        const amt = round2(toNum(api.root.querySelector("#ca-amt").value));
        const box = api.root.querySelector("#ca-err");
        const note = api.root.querySelector("#ca-note").value.trim();
        if (amt < 0) { box.textContent = "The pending amount cannot be less than zero."; box.classList.remove("hidden"); return; }
        try {
          busy(true, "Saving…");
          await updateDocById(C.customers, c.id, { outstanding: amt });
          logActivity("CUSTOMER_DUE_SET",
            `${c.name} · ${money(due)} → ${money(amt)}${note ? " · " + note : ""}`, "customer", c.id);
          api.close(); ok(`Pending payment set to ${money(amt)}`); onDone();
        } catch (e) { box.textContent = e.message; box.classList.remove("hidden"); } finally { busy(false); }
      };
    }
  });
}

/* Removing a customer loses their dues with them, so it is spelt out first. */
async function deleteCustomer(c, api, onChange) {
  const due = toNum(c.outstanding);
  const go = await confirmDialog(
    [
      `Delete ${c.name}?`,
      "",
      due > 0 ? `${money(due)} is still pending from them, and that record goes too.` : "",
      "Their bills stay in Sales, but they will no longer be linked to a customer record.",
      "",
      "This cannot be undone."
    ].filter((l) => l !== "").join("\n"),
    { okText: "Delete customer", danger: true }
  );
  if (!go) return;
  try {
    busy(true, "Deleting…");
    await removeDoc(C.customers, c.id);
    logActivity("CUSTOMER_DELETED", `${c.name}${due > 0 ? ` · ${money(due)} pending` : ""}`, "customer", c.id);
    api.close(); ok(`${c.name} deleted`); if (onChange) onChange();
  } catch (e) { err(e.message || "Could not delete the customer."); } finally { busy(false); }
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
          await updateDocById(C.customers, c.id, {
            outstanding: incr(-amt), lastPaymentAt: new Date().toISOString()
          });
          logActivity("PAYMENT_RECEIVED",
            `${c.name} · ₹${amt} · ${api.root.querySelector("#cp-method").value}${api.root.querySelector("#cp-note").value ? " · " + api.root.querySelector("#cp-note").value : ""}`,
            "customer", c.id, null, { amount: amt });
          api.close(); ok(`${money(amt)} recorded`); onDone();
        } catch (e) { box.textContent = e.message; box.classList.remove("hidden"); } finally { busy(false); }
      };
    }
  });
}

const row = (k, v) => `<div class="row" style="cursor:default"><div class="mid"><small>${esc(k)}</small></div>
  <div class="end"><b style="font-weight:600;white-space:normal;text-align:right;display:block;max-width:200px">${esc(v)}</b></div></div>`;
