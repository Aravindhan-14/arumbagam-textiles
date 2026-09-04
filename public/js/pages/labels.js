/* ============================================================
   VYRA SAREES - QR / Barcode label printing (single & bulk)
   ============================================================ */
import { state, searchProducts, findByCode, can } from "../store.js";
import { icon, openSheet, emptyState, ok, err, warn, busy, confirmDialog, toast } from "../ui.js";
import { esc, money, toNum, toInt, debounce, sum } from "../utils.js";
import { labelPreviewHtml, hydrateCodeSlots, labelCanvas, qrPayload } from "../codes/codes.js";
import { printLabels } from "../hw/documents.js";
import { printHtmlFallback, paperWidth } from "../hw/printer.js";
import { setScanHandler } from "../app.js";

export const title = "QR / Barcode Labels";

export async function mount(view, { go }) {
  let q = "";
  let type = "qr";
  const picked = new Map();          // productId -> qty

  view.innerHTML = `
    <div class="chips mb">
      <button class="chip on" data-t="qr">QR code labels</button>
      <button class="chip" data-t="barcode">Barcode labels</button>
    </div>
    <div class="searchbar">
      <div class="swrap">${icon("search")}<input id="lb-q" placeholder="Search or scan to add" data-scan-field="true"></div>
      <button class="icon-btn" id="lb-all">${icon("box")}</button>
    </div>

    <div class="sec-title">Selected for printing</div>
    <ul class="list card pad0" id="lb-sel"></ul>

    <div class="sec-title">Products</div>
    <ul class="list card pad0" id="lb-list"></ul>

    <div class="paybar">
      <div class="amt"><small>Total labels</small><b id="lb-count">0</b></div>
      <button class="btn btn-soft btn-sm" id="lb-preview">Preview</button>
      <button class="btn btn-primary" id="lb-print">${icon("print")} Print</button>
    </div>`;

  const selEl = view.querySelector("#lb-sel");
  const listEl = view.querySelector("#lb-list");
  const countEl = view.querySelector("#lb-count");

  const total = () => [...picked.values()].reduce((a, b) => a + b, 0);

  const paintSel = () => {
    const entries = [...picked.entries()];
    selEl.innerHTML = entries.length ? entries.map(([id, qty]) => {
      const p = state.products.find((x) => x.id === id);
      if (!p) return "";
      return `<li class="cart-item" data-id="${id}">
        <div class="ci-mid"><b>${esc(p.productName)}</b><small>${esc(p.sku || "")} · ${money(p.sellingPrice)}</small>
          <div class="qty">
            <button data-act="dec">−</button>
            <input data-qty type="number" inputmode="numeric" min="1" value="${qty}">
            <button data-act="inc">+</button>
          </div></div>
        <div class="ci-end"><b>${qty}</b><button class="del" data-act="del">Remove</button></div>
      </li>`;
    }).join("") : emptyState("Nothing selected", "Scan a product or tap one below", "qr");
    countEl.textContent = total();
  };

  const paintList = () => {
    const list = searchProducts(q, { status: "active" }).slice(0, 120);
    listEl.innerHTML = list.length ? list.map((p) => `
      <li class="row" data-add="${p.id}">
        <div class="thumb">${p.imageUrl ? `<img src="${esc(p.imageUrl)}">` : esc((p.productName || "?").slice(0, 2).toUpperCase())}</div>
        <div class="mid"><b>${esc(p.productName)}</b><small>${esc(p.sku || "")} · ${toNum(p.stock)} in stock</small></div>
        <div class="end">${picked.has(p.id) ? `<span class="pill ok">${picked.get(p.id)}</span>` : icon("plus")}</div>
      </li>`).join("") : emptyState("No products", "", "box");
  };

  const add = (p, qty) => {
    if (!p) return;
    const q0 = picked.get(p.id) || 0;
    picked.set(p.id, q0 + (qty ?? Math.max(1, toNum(p.stock) || 1)));
    paintSel(); paintList();
  };

  paintSel(); paintList();

  view.querySelector("#lb-q").oninput = debounce((e) => { q = e.target.value.trim(); paintList(); }, 150);
  view.querySelectorAll("[data-t]").forEach((b) => {
    b.onclick = () => {
      type = b.dataset.t;
      view.querySelectorAll("[data-t]").forEach((x) => x.classList.toggle("on", x === b));
    };
  });
  view.querySelector("#lb-all").onclick = async () => {
    const list = searchProducts(q, { status: "active" });
    if (!list.length) return;
    if (!await confirmDialog(`Add all ${list.length} products, one label per piece in stock?`, { okText: "Add all" })) return;
    list.forEach((p) => picked.set(p.id, Math.max(1, toNum(p.stock) || 1)));
    paintSel(); paintList();
  };
  listEl.onclick = (e) => {
    const li = e.target.closest("[data-add]");
    if (li) add(state.products.find((p) => p.id === li.dataset.add), 1);
  };
  selEl.onclick = (e) => {
    const btn = e.target.closest("[data-act]"); if (!btn) return;
    const id = btn.closest("[data-id]").dataset.id;
    const cur = picked.get(id) || 0;
    if (btn.dataset.act === "inc") picked.set(id, cur + 1);
    if (btn.dataset.act === "dec") { if (cur <= 1) picked.delete(id); else picked.set(id, cur - 1); }
    if (btn.dataset.act === "del") picked.delete(id);
    paintSel(); paintList();
  };
  selEl.onchange = (e) => {
    const inp = e.target.closest("[data-qty]"); if (!inp) return;
    const id = inp.closest("[data-id]").dataset.id;
    picked.set(id, Math.max(1, toInt(inp.value, 1)));
    paintSel(); paintList();
  };

  setScanHandler((code) => {
    const p = findByCode(code);
    if (p) { add(p, 1); toast(`${p.productName} · ${picked.get(p.id)} labels`); }
    else warn("No product matches that code");
  });

  view.querySelector("#lb-preview").onclick = () => preview(picked, type);
  view.querySelector("#lb-print").onclick = async () => {
    if (!picked.size) return warn("Select at least one product.");
    const n = total();
    if (!await confirmDialog(`Print ${n} label${n > 1 ? "s" : ""}? Make sure the printer has label stock loaded.`, { okText: "Print" })) return;
    const jobs = [...picked.entries()].map(([id, qty]) => ({ product: state.products.find((p) => p.id === id), qty, type }))
      .filter((j) => j.product);
    try {
      busy(true, `Printing 0/${n}…`);
      await printLabels(jobs, state.settings || {}, (done, tot) => {
        document.getElementById("busy-text").textContent = `Printing ${done}/${tot}…`;
      });
      ok(`${n} labels sent to printer`);
    } catch (e) {
      err(e.message);
    } finally { busy(false); }
  };

  return () => {};
}

/* ---------- preview / paper fallback ---------- */
function preview(picked, type) {
  const jobs = [...picked.entries()].map(([id, qty]) => ({ product: state.products.find((p) => p.id === id), qty }))
    .filter((j) => j.product);
  const cells = [];
  jobs.forEach((j) => { for (let i = 0; i < j.qty; i++) cells.push(labelPreviewHtml(j.product, state.settings || {}, type)); });

  openSheet({
    title: `${cells.length} label${cells.length === 1 ? "" : "s"}`,
    body: cells.length ? `<div class="label-sheet" id="lb-prev">${cells.slice(0, 60).join("")}</div>
      ${cells.length > 60 ? `<p class="form-note mt">Showing the first 60 of ${cells.length}.</p>` : ""}`
      : emptyState("Nothing selected", "", "qr"),
    footer: `<button class="btn btn-soft" data-close>Close</button>
             <button class="btn btn-primary" id="lp-paper">${icon("print")} Print on A4</button>`,
    async onMount(api) {
      await hydrateCodeSlots(api.root, 84);
      api.root.querySelector("#lp-paper").onclick = () => {
        const html = `<style>
            body{font-family:Arial,sans-serif}
            .sheet{display:grid;grid-template-columns:repeat(4,1fr);gap:4mm}
            .cell{border:1px dashed #999;border-radius:2mm;padding:2mm;text-align:center;page-break-inside:avoid}
            .cell .nm{font-size:8pt;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
            .cell .sk{font-size:7pt;font-family:monospace} .cell .pr{font-size:9pt;font-weight:700}
            img{max-width:100%}
          </style><div class="sheet">${
          [...api.root.querySelectorAll(".label-cell")].map((c) => {
            const cv = c.querySelector("canvas");
            return `<div class="cell">
              <div class="nm">${c.querySelector(".nm").textContent}</div>
              ${cv ? `<img src="${cv.toDataURL("image/png")}">` : ""}
              <div class="sk">${c.querySelector(".sk").textContent}</div>
              <div class="pr">${c.querySelector(".pr").textContent}</div></div>`;
          }).join("")}</div>`;
        const w = window.open("", "_blank");
        if (!w) return warn("Allow pop-ups to print on A4");
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>VYRA SAREES Labels</title>
          <style>@page{size:A4;margin:8mm}</style></head><body>${html}</body></html>`);
        w.document.close();
        setTimeout(() => { w.focus(); w.print(); }, 500);
      };
    }
  });
}
