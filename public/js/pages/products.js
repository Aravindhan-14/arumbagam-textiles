/* ============================================================
   VYRA SAREES - Products
   ============================================================ */
import { state, on, searchProducts, can, findByCode } from "../store.js";
import { C, updateDocById, removeDoc, logActivity } from "../db.js";
import { icon, openSheet, emptyState, toast, ok, err, warn, busy, confirmDialog } from "../ui.js";
import { esc, money, toNum, debounce, stockStatus, fmtDate, download, toCsv } from "../utils.js";
import { openProductEditor, productRow, pickProduct } from "./_shared.js";
import { setScanHandler } from "../app.js";
import { qrCanvas, barcodeCanvas, qrPayload, qrDetail } from "../codes/codes.js";
import { printProductQr } from "../hw/documents.js";

export const title = "Products";

let q = "", filter = {};

export async function mount(view, { params, go }) {
  q = params.q || "";
  filter = params.filter === "low" ? { stock: "low" }
    : params.filter === "out" ? { stock: "out" }
      : params.category ? { categoryId: params.category } : {};

  view.innerHTML = `
    <div class="searchbar">
      <div class="swrap">${icon("search")}
        <input id="pr-q" placeholder="Search name, SKU, barcode, colour…" value="${esc(q)}" data-scan-field="true">
      </div>
      ${can("products.create") ? `<button class="icon-btn" id="pr-add" title="Add product">${icon("plus")}</button>` : ""}
    </div>
    <div class="chips" id="pr-chips"></div>
    <div class="small muted mb" id="pr-count"></div>
    <ul class="list card pad0" id="pr-list"></ul>
    <div class="btn-row mt">
      <button class="btn btn-soft btn-sm" id="pr-export">${icon("download")} Export CSV</button>
      <button class="btn btn-soft btn-sm" id="pr-labels">${icon("qr")} Print labels</button>
    </div>`;

  const listEl = view.querySelector("#pr-list");
  const countEl = view.querySelector("#pr-count");
  const chipsEl = view.querySelector("#pr-chips");

  const chips = () => {
    const c = [
      { k: "all", label: "All" },
      { k: "in", label: "In stock" },
      { k: "low", label: "Low stock" },
      { k: "out", label: "Out of stock" },
      { k: "inactive", label: "Inactive" }
    ];
    const cats = state.categories.filter((x) => (x.status || "active") === "active");
    chipsEl.innerHTML =
      c.map((x) => `<button class="chip ${chipOn(x.k) ? "on" : ""}" data-chip="${x.k}">${esc(x.label)}</button>`).join("") +
      cats.map((x) => `<button class="chip ${filter.categoryId === x.id ? "on" : ""}" data-cat="${x.id}">${esc(x.name)}</button>`).join("");
  };
  const chipOn = (k) => (k === "all" && !filter.stock && !filter.status)
    || (k === "inactive" && filter.status === "inactive")
    || filter.stock === k;

  const paint = () => {
    const base = { ...filter };
    if (base.status !== "inactive") base.status = "active";
    const list = searchProducts(q, base);
    countEl.textContent = `${list.length} product${list.length === 1 ? "" : "s"}`;
    listEl.innerHTML = list.length
      ? list.slice(0, 300).map((p) => `<li class="row" data-id="${p.id}">${productRow(p)}</li>`).join("")
      : emptyState(q ? "No matching products" : "No products yet",
        q ? "Check the spelling or scan the tag" : "Add your first saree to get started", "box");
  };

  chips(); paint();

  view.querySelector("#pr-q").oninput = debounce((e) => { q = e.target.value.trim(); paint(); }, 150);
  chipsEl.onclick = (e) => {
    const chip = e.target.closest("[data-chip]"), cat = e.target.closest("[data-cat]");
    if (chip) {
      const k = chip.dataset.chip;
      filter = k === "all" ? {} : k === "inactive" ? { status: "inactive" } : { stock: k };
    } else if (cat) {
      filter = filter.categoryId === cat.dataset.cat ? {} : { categoryId: cat.dataset.cat };
    } else return;
    chips(); paint();
  };
  listEl.onclick = (e) => {
    const li = e.target.closest("[data-id]");
    if (li) openProductSheet(li.dataset.id, paint, go);
  };
  const addBtn = view.querySelector("#pr-add");
  if (addBtn) addBtn.onclick = () => openProductEditor(null, () => { paint(); });
  view.querySelector("#pr-labels").onclick = () => go("#/labels");
  view.querySelector("#pr-export").onclick = () => {
    const list = searchProducts(q, filter);
    download(`vyra-products-${Date.now()}.csv`, toCsv(list, [
      { label: "SKU", key: "sku" }, { label: "Product", key: "productName" },
      { label: "Category", key: "categoryName" }, { label: "Colour", key: "colour" },
      { label: "Size", key: "size" }, { label: "Fabric", key: "fabric" },
      { label: "Barcode", key: "barcode" },
      { label: "Purchase", key: "purchasePrice" }, { label: "Selling", key: "sellingPrice" },
      { label: "GST%", key: "gstRate" }, { label: "Stock", key: "stock" },
      { label: "Min", key: "minimumStock" }, { label: "Status", key: "status" }
    ]));
    ok("Products exported");
  };

  setScanHandler((code) => {
    const p = findByCode(code);
    if (p) openProductSheet(p.id, paint, go);
    else { view.querySelector("#pr-q").value = code; q = code; paint(); warn("No product matches that code"); }
  });

  const off = on("products", paint);
  return () => off();
}

/* ============================================================
   Product detail sheet
   ============================================================ */
export function openProductSheet(id, onChange, go) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return err("Product not found");
  const st = stockStatus(p);
  const margin = toNum(p.sellingPrice) - toNum(p.purchasePrice);
  const marginPct = toNum(p.sellingPrice) ? (margin / toNum(p.sellingPrice)) * 100 : 0;

  openSheet({
    title: p.productName,
    body: `
      <div class="flex mb">
        <div class="thumb" style="width:84px;height:84px;border-radius:12px">
          ${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="">` : icon("box")}
        </div>
        <div class="grow">
          <div style="font-size:22px;font-weight:700">${money(p.sellingPrice)}</div>
          <div class="mono small muted">${esc(p.sku || "")}</div>
          <div class="mt"><span class="pill ${st.cls}">${st.label}</span>
            <span class="pill mut">${toNum(p.stock)} pcs</span></div>
        </div>
      </div>

      <div class="card pad0">
        ${detailRow("Category", [p.categoryName, p.subcategory].filter(Boolean).join(" · ") || "-")}
        ${detailRow("Brand", p.brand || "-")}
        ${detailRow("Colour / Size", [p.colour, p.size].filter(Boolean).join(" · ") || "-")}
        ${detailRow("Fabric", p.fabric || "-")}
        ${detailRow("Product code", p.productCode || "-", true)}
        ${detailRow("Barcode", p.barcode || "-", true)}
        ${detailRow("Purchase price", money(p.purchasePrice))}
        ${detailRow("Margin", `${money(margin)} (${marginPct.toFixed(1)}%)`)}
        ${detailRow("GST", `${toNum(p.gstRate)}%`)}
        ${detailRow("Minimum stock", toNum(p.minimumStock))}
        ${detailRow("Supplier", p.supplierName || "-")}
        ${detailRow("Added", fmtDate(p.createdAt))}
      </div>
      ${p.description ? `<p class="small muted">${esc(p.description)}</p>` : ""}

      <div class="sec-title">Codes</div>
      <div class="grid2">
        <div class="qr-box" id="ps-qr"></div>
        <div class="qr-box" id="ps-bc"></div>
      </div>
      <pre class="small muted mono mt" style="white-space:pre-wrap">${esc(qrDetail(p))}</pre>

      <div class="btn-row mt">
        <button class="btn btn-soft btn-sm" id="ps-print-qr">${icon("print")} Print QR</button>
        <button class="btn btn-soft btn-sm" id="ps-print-bc">${icon("print")} Print barcode</button>
      </div>
      <div class="btn-row mt">
        <button class="btn btn-soft btn-sm" id="ps-dl-qr">${icon("download")} Save QR</button>
        <button class="btn btn-soft btn-sm" id="ps-bill">${icon("bill")} Add to bill</button>
      </div>
      ${can("products.edit") ? `<div class="divider"></div>
        <button class="btn btn-ghost btn-block" id="ps-toggle">
          ${(p.status || "active") === "active" ? "Deactivate product" : "Reactivate product"}</button>` : ""}`,
    footer: can("products.edit")
      ? `<button class="btn btn-soft" data-close>Close</button>
         <button class="btn btn-primary" id="ps-edit">${icon("edit")} Edit</button>`
      : `<button class="btn btn-soft btn-block" data-close>Close</button>`,
    async onMount(api) {
      const root = api.root;
      try {
        const qc = await qrCanvas(qrPayload(p), 180);
        root.querySelector("#ps-qr").appendChild(qc);
        const bc = barcodeCanvas(qrPayload(p), { height: 60 });
        bc.style.maxWidth = "100%"; bc.style.height = "auto";
        root.querySelector("#ps-bc").appendChild(bc);
      } catch (e) { console.error(e); }

      root.querySelector("#ps-print-qr").onclick = () => doPrint(p, "qr");
      root.querySelector("#ps-print-bc").onclick = () => doPrint(p, "barcode");
      root.querySelector("#ps-dl-qr").onclick = async () => {
        const c = await qrCanvas(qrPayload(p), 512);
        c.toBlob((b) => {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(b); a.download = `${p.sku || p.id}-qr.png`; a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 500);
        });
      };
      root.querySelector("#ps-bill").onclick = () => {
        api.close();
        sessionStorage.setItem("vyra.pendingScan", qrPayload(p));
        (go || window.VYRA.go)("#/billing");
      };
      const edit = root.querySelector("#ps-edit");
      if (edit) edit.onclick = () => { api.close(); openProductEditor(p, onChange); };
      const tog = root.querySelector("#ps-toggle");
      if (tog) tog.onclick = async () => {
        const next = (p.status || "active") === "active" ? "inactive" : "active";
        if (!await confirmDialog(next === "inactive"
          ? "Deactivate this product? It will no longer appear in billing."
          : "Reactivate this product?", { okText: next === "inactive" ? "Deactivate" : "Reactivate", danger: next === "inactive" })) return;
        await updateDocById(C.products, p.id, { status: next });
        logActivity(null, "PRODUCT_UPDATED", `${p.sku} set ${next}`, "product", p.id);
        api.close(); ok(next === "inactive" ? "Product deactivated" : "Product reactivated");
        if (onChange) onChange();
      };
    }
  });
}

async function doPrint(p, type) {
  try {
    busy(true, "Sending to printer…");
    const copies = 1;
    await printProductQr(p, state.settings || {}, copies, type);
    ok("Sent to printer");
  } catch (e) { err(e.message); } finally { busy(false); }
}

const detailRow = (k, v, mono = false) =>
  `<div class="row" style="cursor:default"><div class="mid"><small>${esc(k)}</small></div>
   <div class="end"><b class="${mono ? "mono" : ""}" style="font-weight:600">${esc(v)}</b></div></div>`;
