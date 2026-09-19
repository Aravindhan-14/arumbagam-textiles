/* ============================================================
   VYRA SAREES - Suppliers
   ============================================================ */
import { state, on, searchSuppliers, can } from "../store.js";
import { C, listDocs, updateDocById, incr, logActivity } from "../db.js";
import { icon, openSheet, emptyState, statCard, ok, err, busy, toast, refocus } from "../ui.js";
import { esc, money, money0, toNum, debounce, fmtDate, sum, download, toCsv } from "../utils.js";
import { openSupplierEditor } from "./_shared.js";

export const title = "Suppliers";

export async function mount(view, { go }) {
  if (!can("suppliers.manage")) { view.innerHTML = emptyState("Not permitted", "Ask the shop owner for access", "alert"); return; }
  let q = "";

  const paint = () => {
    const list = searchSuppliers(q);
    const payable = state.suppliers.filter((s) => toNum(s.outstanding) > 0);

    view.innerHTML = `
      <div class="stats mb">
        ${statCard("Suppliers", state.suppliers.length, "on record")}
        ${statCard("Payable", money0(sum(payable, (s) => s.outstanding)), `${payable.length} pending`, payable.length ? "warn" : "")}
      </div>
      <div class="searchbar">
        <div class="swrap">${icon("search")}<input id="su-q" placeholder="Name, mobile, GSTIN…" value="${esc(q)}"></div>
        <button class="icon-btn" id="su-add">${icon("plus")}</button>
      </div>
      <ul class="list card pad0">
        ${list.length ? list.map((s) => `
          <li class="row" data-id="${s.id}">
            <div class="thumb">${esc((s.name || "?").slice(0, 2).toUpperCase())}</div>
            <div class="mid"><b>${esc(s.name)}</b><small>${esc(s.mobile || "")}${s.productsSupplied ? " · " + esc(s.productsSupplied) : ""}</small></div>
            <div class="end"><b>${money0(s.totalPurchases)}</b>
              ${toNum(s.outstanding) > 0 ? `<small class="pill warn">Due ${money0(s.outstanding)}</small>` : `<small class="muted">purchased</small>`}</div>
          </li>`).join("") : emptyState("No suppliers yet", "Add the shops you buy stock from", "truck")}
      </ul>
      <button class="btn btn-soft btn-sm mt" id="su-export">${icon("download")} Export CSV</button>`;

    view.querySelector("#su-q").oninput = debounce((e) => { q = e.target.value.trim(); paint(); refocus(view, "#su-q"); }, 150);
    view.querySelector("#su-add").onclick = () => openSupplierEditor(null, () => paint());
    view.querySelectorAll("[data-id]").forEach((li) => {
      li.onclick = () => supplierSheet(state.suppliers.find((s) => s.id === li.dataset.id), paint, go);
    });
    view.querySelector("#su-export").onclick = () => {
      download(`vyra-suppliers-${Date.now()}.csv`, toCsv(state.suppliers, [
        { label: "Name", key: "name" }, { label: "Mobile", key: "mobile" }, { label: "Email", key: "email" },
        { label: "GSTIN", key: "gstin" }, { label: "Address", key: "address" },
        { label: "Products", key: "productsSupplied" },
        { label: "Total purchases", key: "totalPurchases" }, { label: "Outstanding", key: "outstanding" }
      ]));
      ok("Suppliers exported");
    };
  };

  paint();
  const off = on("suppliers", paint);
  return () => off();
}

function supplierSheet(s, onChange, go) {
  if (!s) return;
  const products = state.products.filter((p) => p.supplierId === s.id);
  openSheet({
    title: s.name,
    body: `
      <div class="stats mb">
        ${statCard("Purchased", money0(s.totalPurchases), "lifetime")}
        ${statCard("Payable", money0(s.outstanding), "outstanding", toNum(s.outstanding) > 0 ? "warn" : "ok")}
      </div>
      <div class="card pad0 mb">
        ${row("Mobile", s.mobile || "-")}
        ${row("Email", s.email || "-")}
        ${row("GSTIN", s.gstin || "-")}
        ${row("Address", s.address || "-")}
        ${row("Products supplied", s.productsSupplied || "-")}
        ${row("Catalogue items", products.length)}
      </div>
      <div class="btn-row mb">
        ${s.mobile ? `<a class="btn btn-soft btn-sm" href="tel:${esc(s.mobile)}">Call</a>
          <a class="btn btn-soft btn-sm" href="https://wa.me/91${esc(s.mobile)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
        ${toNum(s.outstanding) > 0 ? `<button class="btn btn-ok btn-sm" id="ss-pay">Record payment</button>` : ""}
      </div>
      <div class="sec-title">Purchase history</div>
      <ul class="list card pad0" id="ss-list"><li class="row" style="cursor:default"><div class="mid muted">Loading…</div></li></ul>`,
    footer: `<button class="btn btn-soft" data-close>Close</button>
             <button class="btn btn-primary" id="ss-edit">${icon("edit")} Edit</button>`,
    async onMount(api) {
      api.root.querySelector("#ss-edit").onclick = () => { api.close(); openSupplierEditor(s, onChange); };
      const pay = api.root.querySelector("#ss-pay");
      if (pay) pay.onclick = () => paySheet(s, () => { api.close(); onChange && onChange(); });

      const ul = api.root.querySelector("#ss-list");
      try {
        const rows = await listDocs(C.purchases, {
          where: [["supplierId", "==", s.id]],
          orderBy: { field: "createdAt", dir: "desc" }, limit: 30
        });
        ul.innerHTML = rows.length ? rows.map((p) => `
          <li class="row" style="cursor:default">
            <div class="thumb">${icon("cart")}</div>
            <div class="mid"><b>${esc(p.purchaseNumber)}</b><small>${fmtDate(p.createdAt)} · ${(p.items || []).length} items</small></div>
            <div class="end"><b>${money(p.grandTotal)}</b>
              <small class="pill ${p.paymentStatus === "paid" ? "ok" : "warn"}">${esc(p.paymentStatus || "")}</small></div>
          </li>`).join("") : emptyState("No purchases recorded", "", "cart");
      } catch (e) { ul.innerHTML = emptyState("History unavailable", e.message, "alert"); }
    }
  });
}

function paySheet(s, onDone) {
  openSheet({
    title: "Pay supplier",
    body: `<div class="trow grand mb"><span>Outstanding</span><b>${money(s.outstanding)}</b></div>
      <label class="field"><span>Amount paid (₹)</span>
        <input id="sp-amt" type="number" inputmode="decimal" step="0.01" min="0" value="${toNum(s.outstanding)}"></label>
      <label class="field"><span>Method</span>
        <select id="sp-method">${["Cash", "UPI", "Bank Transfer", "Cheque", "Other"].map((m) => `<option>${m}</option>`).join("")}</select></label>
      <div id="sp-err" class="form-error hidden"></div>`,
    footer: `<button class="btn btn-soft" data-close>Cancel</button>
             <button class="btn btn-ok" id="sp-ok">Record</button>`,
    onMount(api) {
      api.root.querySelector("#sp-ok").onclick = async () => {
        const amt = toNum(api.root.querySelector("#sp-amt").value);
        const box = api.root.querySelector("#sp-err");
        if (amt <= 0 || amt > toNum(s.outstanding) + 0.01) {
          box.textContent = "Enter an amount up to the outstanding balance."; box.classList.remove("hidden"); return;
        }
        try {
          busy(true, "Recording…");
          await updateDocById(C.suppliers, s.id, { outstanding: incr(-amt) });
          logActivity("SUPPLIER_PAID", `${s.name} · ₹${amt}`, "supplier", s.id);
          api.close(); ok("Payment recorded"); onDone();
        } catch (e) { box.textContent = e.message; box.classList.remove("hidden"); } finally { busy(false); }
      };
    }
  });
}

const row = (k, v) => `<div class="row" style="cursor:default"><div class="mid"><small>${esc(k)}</small></div>
  <div class="end"><b style="font-weight:600;white-space:normal;text-align:right;display:block;max-width:200px">${esc(v)}</b></div></div>`;
