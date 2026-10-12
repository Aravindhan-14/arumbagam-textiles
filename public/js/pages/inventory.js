/* ============================================================
   ARUMBAGAM - Inventory: stock levels, adjustments, history
   ============================================================ */
import { state, on, searchProducts, can, canSeeCost, costOf, lowStockProducts, outOfStockProducts, totalStockUnits, stockValue } from "../store.js";
import { C, listDocs, addStock, adjustStock, updateDocById } from "../db.js";
import { icon, openSheet, emptyState, statCard, ok, err, warn, busy, confirmDialog, formData, toast, refocus } from "../ui.js";
import { esc, fileUrl, money, money0, toNum, toInt, debounce, stockStatus, fmtDateTime, download, toCsv, ago } from "../utils.js";
import { pickProduct } from "./_shared.js";
import { setScanHandler } from "../app.js";
import { findByCode } from "../store.js";

export const title = "Inventory";

const MOVES = [
  { k: "PURCHASE", label: "Stock In / Purchase", sign: 1 },
  { k: "RETURN", label: "Customer Return", sign: 1 },
  { k: "DAMAGE", label: "Damaged / Lost", sign: -1 },
  { k: "ADJUSTMENT", label: "Manual Correction", sign: 0 }
];

export async function mount(view, { params, go }) {
  let q = "", filter = params.filter || "all";

  const paint = () => {
    const map = { all: {}, low: { stock: "low" }, out: { stock: "out" }, in: { stock: "in" } };
    const list = searchProducts(q, { status: "active", ...(map[filter] || {}) })
      .sort((a, b) => toNum(a.stock) - toNum(b.stock));

    view.innerHTML = `
      <div class="stats mb">
        ${statCard("Total Units", totalStockUnits(), `${state.products.length} products`)}
        ${canSeeCost() ? statCard("Stock Value", money0(stockValue()), "at purchase cost") : ""}
        ${statCard("Low Stock", lowStockProducts().length, "reorder soon", lowStockProducts().length ? "warn" : "")}
        ${statCard("Out of Stock", outOfStockProducts().length, "unavailable", outOfStockProducts().length ? "danger" : "")}
      </div>

      <div class="searchbar">
        <div class="swrap">${icon("search")}<input id="iv-q" placeholder="Search or scan product" value="${esc(q)}" data-scan-field="true"></div>
        <button class="icon-btn" id="iv-quick">${icon("plus")}</button>
      </div>
      <div class="chips">
        ${[["all", "All"], ["low", "Low stock"], ["out", "Out of stock"], ["in", "In stock"]]
        .map(([k, l]) => `<button class="chip ${filter === k ? "on" : ""}" data-f="${k}">${l}</button>`).join("")}
      </div>

      <ul class="list card pad0">
        ${list.length ? list.slice(0, 250).map((p) => {
          const st = stockStatus(p);
          return `<li class="row" data-id="${p.id}">
            <div class="thumb">${p.imageUrl ? `<img src="${esc(fileUrl(p.imageUrl))}">` : esc((p.productName || "?").slice(0, 2).toUpperCase())}</div>
            <div class="mid"><b>${esc(p.productName)}</b>
              <small>${esc(p.sku || "")} · min ${toNum(p.minimumStock)}</small></div>
            <div class="end"><b style="color:var(--${st.cls === "ok" ? "text" : st.cls})">${toNum(p.stock)}</b>
              <small class="pill ${st.cls}">${st.label}</small></div>
          </li>`;
        }).join("") : emptyState("Nothing here", "Try a different filter", "stack")}
      </ul>
      <button class="btn btn-soft btn-sm mt" id="iv-export">${icon("download")} Export stock CSV</button>`;

    view.querySelector("#iv-q").oninput = debounce((e) => { q = e.target.value.trim(); paint(); refocus(view, "#iv-q"); }, 150);
    view.querySelectorAll("[data-f]").forEach((b) => { b.onclick = () => { filter = b.dataset.f; paint(); }; });
    view.querySelectorAll("[data-id]").forEach((li) => {
      li.onclick = () => stockSheet(state.products.find((p) => p.id === li.dataset.id), paint);
    });
    view.querySelector("#iv-quick").onclick = () => pickProduct((p) => stockSheet(p, paint));
    view.querySelector("#iv-export").onclick = () => {
      download(`demo-stock-${Date.now()}.csv`, toCsv(searchProducts("", { status: "active" }), [
        { label: "SKU", key: "sku" }, { label: "Product", key: "productName" },
        { label: "Category", key: "categoryName" }, { label: "Stock", key: "stock" },
        { label: "Minimum", key: "minimumStock" },
        { label: "Status", get: (p) => stockStatus(p).label },
        ...(canSeeCost() ? [
          { label: "Cost", get: (p) => costOf(p.id) },
          { label: "Stock value", get: (p) => (toNum(p.stock) * costOf(p.id)).toFixed(2) }
        ] : [])
      ]));
      ok("Stock exported");
    };
  };

  paint();
  setScanHandler((code) => {
    const p = findByCode(code);
    if (p) stockSheet(p, paint); else warn("No product matches that code");
  });
  const off = on("products", paint);
  return () => off();
}

/* ============================================================
   Per-product stock sheet
   ============================================================ */
export function stockSheet(p, onChange) {
  if (!p) return;
  const st = stockStatus(p);
  const editable = can("inventory.adjust");

  openSheet({
    title: p.productName,
    body: `
      <div class="tc mb">
        <div style="font-size:38px;font-weight:700">${toNum(p.stock)}</div>
        <div class="small muted">pieces in stock · minimum ${toNum(p.minimumStock)}</div>
        <div class="mt"><span class="pill ${st.cls}">${st.label}</span></div>
      </div>

      ${editable ? `
      <div class="sec-title">Record a movement</div>
      <div class="grid2">
        <label class="field"><span>Type</span>
          <select id="sk-type">${MOVES.map((m) => `<option value="${m.k}">${m.label}</option>`).join("")}</select></label>
        <label class="field"><span>Quantity</span>
          <input id="sk-qty" type="number" inputmode="numeric" step="1" min="0" value="1"></label>
      </div>
      <label class="field"><span>Note</span><input id="sk-note" placeholder="Optional reason / reference"></label>
      <div class="trow mb"><span>Stock after this change</span><b id="sk-after">${toNum(p.stock) + 1}</b></div>
      <button class="btn btn-primary btn-block" id="sk-apply">${icon("check")} Apply</button>
      <div class="divider"></div>
      <label class="field"><span>Minimum stock level</span>
        <div class="flex"><input id="sk-min" class="inp grow" type="number" inputmode="numeric" min="0" value="${toNum(p.minimumStock)}">
        <button class="btn btn-soft btn-sm" id="sk-min-save">Save</button></div></label>
      ` : `<p class="form-note">You do not have permission to change stock.</p>`}

      <div class="sec-title">Stock history</div>
      <ul class="list card pad0" id="sk-hist">
        <li class="row" style="cursor:default"><div class="mid muted">Loading…</div></li>
      </ul>`,
    footer: `<button class="btn btn-soft" data-close>Close</button>`,
    async onMount(api) {
      const root = api.root;

      if (editable) {
        const typeEl = root.querySelector("#sk-type");
        const qtyEl = root.querySelector("#sk-qty");
        const afterEl = root.querySelector("#sk-after");
        const refresh = () => {
          const move = MOVES.find((m) => m.k === typeEl.value);
          const qty = toNum(qtyEl.value);
          afterEl.textContent = move.sign === 0 ? qty : toNum(p.stock) + move.sign * qty;
          qtyEl.previousElementSibling && (qtyEl.previousElementSibling.textContent =
            move.sign === 0 ? "Set stock to" : "Quantity");
        };
        typeEl.onchange = refresh; qtyEl.oninput = refresh; refresh();

        root.querySelector("#sk-apply").onclick = async () => {
          const move = MOVES.find((m) => m.k === typeEl.value);
          const qty = toNum(qtyEl.value);
          const note = root.querySelector("#sk-note").value.trim();
          if (move.sign !== 0 && qty <= 0) return warn("Enter a quantity greater than zero.");
          const after = move.sign === 0 ? qty : toNum(p.stock) + move.sign * qty;
          if (after < 0 && state.settings?.allowNegativeStock !== true) return warn("That would take stock below zero.");
          try {
            busy(true, "Updating stock…");
            if (move.sign === 0) await adjustStock(p, qty, "ADJUSTMENT", note);
            else await addStock(p, move.sign * qty, move.k, note);
            api.close(); ok("Stock updated");
            if (onChange) onChange();
          } catch (e) { err(e.message); } finally { busy(false); }
        };

        root.querySelector("#sk-min-save").onclick = async () => {
          const v = toInt(root.querySelector("#sk-min").value, 0);
          await updateDocById(C.products, p.id, { minimumStock: v });
          ok("Minimum stock saved");
        };
      }

      /* history */
      const ul = root.querySelector("#sk-hist");
      try {
        const rows = await listDocs(C.stockHistory, {
          where: [["productId", "==", p.id]],
          orderBy: { field: "createdAt", dir: "desc" }, limit: 30
        });
        ul.innerHTML = rows.length ? rows.map((h) => `
          <li class="row" style="cursor:default">
            <div class="thumb" style="background:var(--surface-2);border:none">${icon(toNum(h.quantity) > 0 ? "plus" : "trash")}</div>
            <div class="mid"><b>${esc(h.type)}</b>
              <small>${fmtDateTime(h.createdAt)}${h.referenceNo ? " · " + esc(h.referenceNo) : ""}${h.note ? " · " + esc(h.note) : ""}</small></div>
            <div class="end"><b style="color:var(--${toNum(h.quantity) > 0 ? "ok" : "danger"})">${toNum(h.quantity) > 0 ? "+" : ""}${toNum(h.quantity)}</b>
              <small>→ ${toNum(h.newStock)}</small></div>
          </li>`).join("") : emptyState("No movements recorded yet", "", "clock");
      } catch (e) {
        ul.innerHTML = emptyState("History unavailable offline", e.message, "alert");
      }
    }
  });
}
