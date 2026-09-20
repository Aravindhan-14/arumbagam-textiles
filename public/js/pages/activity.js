/* ============================================================
   demo SAREES - Activity / audit log
   ============================================================ */
import { can } from "../store.js";
import { C, listDocs } from "../db.js";
import { icon, emptyState, ok, err } from "../ui.js";
import { esc, fmtDateTime, ago, matches, debounce, download, toCsv } from "../utils.js";

export const title = "Activity Log";

const LABEL = {
  LOGIN: "Signed in", LOGOUT: "Signed out",
  BILL_CREATED: "Bill created", BILL_CANCELLED: "Bill cancelled",
  PRODUCT_ADDED: "Product added", PRODUCT_UPDATED: "Product updated",
  STOCK_ADJUSTED: "Stock adjusted", PURCHASE_CREATED: "Purchase recorded",
  RETURN_CREATED: "Return processed", EXCHANGE_CREATED: "Exchange processed",
  PAYMENT_RECEIVED: "Payment collected", SUPPLIER_PAID: "Supplier paid",
  STAFF_ADDED: "Staff added", STAFF_UPDATED: "Staff updated",
  SETTINGS_UPDATED: "Settings changed"
};
const ICON = {
  LOGIN: "user", LOGOUT: "user", BILL_CREATED: "bill", BILL_CANCELLED: "x",
  PRODUCT_ADDED: "box", PRODUCT_UPDATED: "edit", STOCK_ADJUSTED: "stack",
  PURCHASE_CREATED: "cart", RETURN_CREATED: "ret", EXCHANGE_CREATED: "ret",
  PAYMENT_RECEIVED: "rupee", SUPPLIER_PAID: "truck",
  STAFF_ADDED: "users", STAFF_UPDATED: "users", SETTINGS_UPDATED: "gear"
};

export async function mount(view, { go }) {
  if (!can("staff.manage")) { view.innerHTML = emptyState("Not permitted", "Only the shop owner can view the audit log", "alert"); return; }

  let rows = [], q = "", done = false;

  view.innerHTML = `
    <div class="searchbar">
      <div class="swrap">${icon("search")}<input id="ac-q" placeholder="Filter by user, action or detail"></div>
    </div>
    <ul class="list card pad0" id="ac-list"><li class="row" style="cursor:default"><div class="mid muted">Loading…</div></li></ul>
    <button class="btn btn-soft btn-block mt" id="ac-more">Load more</button>
    <button class="btn btn-ghost btn-block mt" id="ac-export">${icon("download")} Export CSV</button>`;

  const listEl = view.querySelector("#ac-list");

  const paint = () => {
    const list = q ? rows.filter((r) => matches([r.action, r.detail, r.userName, r.entity].join(" "), q)) : rows;
    listEl.innerHTML = list.length ? list.map((r) => `
      <li class="row" style="cursor:default">
        <div class="thumb" style="background:var(--surface-2);border:none">${icon(ICON[r.action] || "clock")}</div>
        <div class="mid"><b>${esc(LABEL[r.action] || r.action)}</b>
          <small>${esc(r.detail || "")}</small></div>
        <div class="end"><b style="font-size:12.5px">${esc(r.userName || "-")}</b>
          <small title="${esc(fmtDateTime(r.createdAt))}">${ago(r.createdAt)}</small></div>
      </li>`).join("") : emptyState("Nothing recorded yet", "Actions appear here as staff use the app", "clock");
  };

  const load = async () => {
    try {
      const page = await listDocs(C.activity, {
        orderBy: { field: "createdAt", dir: "desc" }, limit: 50, offset: rows.length
      });
      if (page.length < 50) {
        done = true;
        const more = view.querySelector("#ac-more");
        more.textContent = "No more entries"; more.disabled = true;
      }
      rows = rows.concat(page);
      paint();
    } catch (e) {
      listEl.innerHTML = emptyState("Could not load the log", e.message, "alert");
    }
  };

  view.querySelector("#ac-q").oninput = debounce((e) => { q = e.target.value.trim(); paint(); }, 150);
  view.querySelector("#ac-more").onclick = () => { if (!done) load(); };
  view.querySelector("#ac-export").onclick = () => {
    download(`demo-activity-${Date.now()}.csv`, toCsv(rows, [
      { label: "When", get: (r) => fmtDateTime(r.createdAt) },
      { label: "Action", get: (r) => LABEL[r.action] || r.action },
      { label: "Detail", key: "detail" }, { label: "User", key: "userName" },
      { label: "Entity", key: "entity" }, { label: "Entity id", key: "entityId" }
    ]));
    ok("Activity log exported");
  };

  await load();
}
