/* ============================================================
   demo SAREES - shared page components
   (pickers, product / customer / supplier editors)
   ============================================================ */
import {
  C, createDoc, updateDocById, uploadImage, nextSkuSequence, addStock, logActivity, saveCost
} from "../db.js";
import {
  state, searchProducts, searchCustomers, searchSuppliers, can, canSeeCost, categoryById,
  refreshCosts
} from "../store.js";
import { icon, openSheet, toast, ok, err, warn, busy, confirmDialog, emptyState, formData } from "../ui.js";
import {
  esc, fileUrl, money, toNum, toInt, buildSku, buildBarcode, stockStatus, upper,
  validMobile, validGstin, validEmail, debounce, searchTokens
} from "../utils.js";

/* ============================================================
   Generic search picker sheet
   ============================================================ */
export function pickerSheet({ title, search, renderRow, onPick, addLabel, onAdd, emptyText = "Nothing found" }) {
  let list = [];
  const api = openSheet({
    title,
    body: `<div class="searchbar">
             <div class="swrap">${icon("search")}<input id="pk-q" placeholder="Search…" autocomplete="off"></div>
             ${onAdd ? `<button class="icon-btn" id="pk-add" title="${esc(addLabel || "Add")}">${icon("plus")}</button>` : ""}
           </div>
           <ul class="list card pad0" id="pk-list"></ul>`,
    onMount(a) {
      const input = a.root.querySelector("#pk-q");
      const ul = a.root.querySelector("#pk-list");
      const paint = () => {
        list = search(input.value.trim());
        ul.innerHTML = list.length
          ? list.slice(0, 80).map((item, i) => `<li class="row" data-i="${i}">${renderRow(item)}</li>`).join("")
          : emptyState(emptyText, "Try a different search", "search");
      };
      paint();
      input.oninput = debounce(paint, 120);
      input.dataset.scanField = "true";
      input.onkeydown = (e) => {
        if (e.key === "Enter" && list.length) { e.preventDefault(); a.close(); onPick(list[0]); }
      };
      ul.onclick = (e) => {
        const li = e.target.closest("[data-i]");
        if (!li) return;
        a.close(); onPick(list[toInt(li.dataset.i)]);
      };
      const addBtn = a.root.querySelector("#pk-add");
      if (addBtn) addBtn.onclick = () => { a.close(); onAdd(); };
      setTimeout(() => input.focus(), 100);
    }
  });
  return api;
}

/* ---------- concrete pickers ---------- */
export function pickProduct(onPick, { includeOutOfStock = true } = {}) {
  pickerSheet({
    title: "Select Product",
    search: (q) => {
      const l = searchProducts(q, { status: "active" });
      return includeOutOfStock ? l : l.filter((p) => toNum(p.stock) > 0);
    },
    renderRow: (p) => {
      const st = stockStatus(p);
      return `<div class="thumb">${p.imageUrl ? `<img src="${esc(fileUrl(p.imageUrl))}" alt="">` : esc((p.productName || "?").slice(0, 2).toUpperCase())}</div>
        <div class="mid"><b>${esc(p.productName)}</b><small>${esc(p.sku || "")} · ${esc(p.colour || "")} ${esc(p.size || "")}</small></div>
        <div class="end"><b>${money(p.sellingPrice)}</b><small class="pill ${st.cls}">${st.key === "ok" ? p.stock + " in stock" : st.label}</small></div>`;
    },
    onPick,
    addLabel: "New product",
    onAdd: can("products.create") ? () => openProductEditor(null, onPick) : null,
    emptyText: "No products found"
  });
}

export function pickCustomer(onPick) {
  pickerSheet({
    title: "Select Customer",
    search: searchCustomers,
    renderRow: (c) => `<div class="thumb">${esc((c.name || "?").slice(0, 2).toUpperCase())}</div>
      <div class="mid"><b>${esc(c.name)}</b><small>${esc(c.mobile || "No mobile")}</small></div>
      <div class="end">${toNum(c.outstanding) > 0 ? `<small class="pill warn">Due ${money(c.outstanding)}</small>` : ""}</div>`,
    onPick,
    addLabel: "New customer",
    onAdd: () => openCustomerEditor(null, onPick),
    emptyText: "No customers yet"
  });
}

export function pickSupplier(onPick) {
  pickerSheet({
    title: "Select Supplier",
    search: searchSuppliers,
    renderRow: (s) => `<div class="thumb">${esc((s.name || "?").slice(0, 2).toUpperCase())}</div>
      <div class="mid"><b>${esc(s.name)}</b><small>${esc(s.mobile || "")}</small></div>
      <div class="end">${toNum(s.outstanding) > 0 ? `<small class="pill warn">Due ${money(s.outstanding)}</small>` : ""}</div>`,
    onPick,
    addLabel: "New supplier",
    onAdd: () => openSupplierEditor(null, onPick),
    emptyText: "No suppliers yet"
  });
}

/* ============================================================
   Options helpers
   ============================================================ */
export const catOptions = (sel) =>
  `<option value="">— Select category —</option>` +
  state.categories.filter((c) => (c.status || "active") === "active")
    .map((c) => `<option value="${c.id}" ${c.id === sel ? "selected" : ""}>${esc(c.name)}</option>`).join("");

export const supplierOptions = (sel) =>
  `<option value="">— None —</option>` +
  state.suppliers.map((s) => `<option value="${s.id}" ${s.id === sel ? "selected" : ""}>${esc(s.name)}</option>`).join("");

const GST_RATES = [0, 3, 5, 12, 18, 28];
export const gstOptions = (sel) =>
  GST_RATES.map((r) => `<option value="${r}" ${toNum(sel) === r ? "selected" : ""}>${r}%</option>`).join("");

/* ============================================================
   Product editor
   ============================================================ */
export function openProductEditor(product, onSaved) {
  // A partial object (e.g. a scanned barcode with no id yet) still counts as new.
  const isNew = !(product && product.id);
  const showCost = canSeeCost();
  const s = state.settings || {};
  const p = {
    productName: "", sku: "", productCode: "", categoryId: "", subcategory: "", brand: "",
    colour: "", fabric: "", size: "", sellingPrice: "", discount: 0,
    gstRate: toNum(s.defaultGstRate, 5), stock: 0, minimumStock: toNum(s.lowStockDefault, 3),
    barcode: "", description: "", status: "active", imageUrl: "",
    ...(product || {})
  };
  // Purchase price and supplier are kept out of the product itself so staff
  // devices never receive them; they come from the owner-only cost record.
  const cost = product?.id ? state.costs[product.id] : null;
  p.purchasePrice = showCost ? (cost?.purchasePrice ?? "") : "";
  p.supplierId = showCost ? (cost?.supplierId || "") : "";

  openSheet({
    title: isNew ? "Add Product" : "Edit Product",
    body: `
      <div class="flex mb">
        <div class="thumb" id="pe-thumb" style="width:64px;height:64px;border-radius:12px">
          ${p.imageUrl ? `<img src="${esc(fileUrl(p.imageUrl))}" alt="">` : icon("box")}
        </div>
        <div class="grow">
          <button class="btn btn-soft btn-sm" id="pe-pick-img">${icon("plus")} Product image</button>
          <div class="small muted mt" id="pe-img-note">Optional · JPG or PNG</div>
        </div>
        <input type="file" id="pe-file" accept="image/*" class="hidden">
      </div>

      <label class="field req"><span>Product name</span>
        <input name="productName" value="${esc(p.productName)}" placeholder="Designer Silk Saree" required></label>

      <div class="grid2">
        <label class="field req"><span>Category</span><select name="categoryId">${catOptions(p.categoryId)}</select></label>
        <label class="field"><span>Sub category</span><input name="subcategory" value="${esc(p.subcategory || "")}"></label>
      </div>

      <div class="grid2">
        <label class="field"><span>SKU</span>
          <input name="sku" value="${esc(p.sku)}" class="mono" placeholder="auto"></label>
        <label class="field"><span>Product code</span>
          <input name="productCode" value="${esc(p.productCode || "")}" class="mono" placeholder="auto"></label>
      </div>
      <div class="field"><span>Barcode</span>
        <div class="flex">
          <input name="barcode" value="${esc(p.barcode || "")}" class="mono grow inp" data-scan-field="true"
                 placeholder="Scan or leave blank to generate">
          <button class="btn btn-soft btn-sm" type="button" id="pe-gen-bc">Generate</button>
        </div>
      </div>

      <div class="grid3">
        <label class="field"><span>Colour</span><input name="colour" value="${esc(p.colour || "")}"></label>
        <label class="field"><span>Size</span><input name="size" value="${esc(p.size || "")}" placeholder="M / Free"></label>
        <label class="field"><span>Brand</span><input name="brand" value="${esc(p.brand || "")}"></label>
      </div>
      <label class="field"><span>Fabric / material</span><input name="fabric" value="${esc(p.fabric || "")}" placeholder="Kanchipuram silk"></label>

      <div class="${showCost ? "grid2" : ""}">
        ${showCost ? `<label class="field"><span>Purchase price</span>
          <input name="purchasePrice" type="number" inputmode="decimal" step="0.01" min="0" value="${esc(p.purchasePrice)}"></label>` : ""}
        <label class="field req"><span>Selling price</span>
          <input name="sellingPrice" type="number" inputmode="decimal" step="0.01" min="0" value="${esc(p.sellingPrice)}" required></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Default discount (₹/pc)</span>
          <input name="discount" type="number" inputmode="decimal" step="0.01" min="0" value="${esc(p.discount || 0)}"></label>
        <label class="field"><span>GST rate</span><select name="gstRate">${gstOptions(p.gstRate)}</select></label>
      </div>

      <div class="grid2">
        <label class="field"><span>${isNew ? "Opening stock" : "Current stock"}</span>
          <input name="stock" type="number" inputmode="numeric" step="1" value="${esc(p.stock || 0)}" ${isNew ? "" : "disabled"}>
          ${isNew ? "" : `<small class="form-note">Change stock from Inventory so the movement is recorded.</small>`}
        </label>
        <label class="field"><span>Minimum stock</span>
          <input name="minimumStock" type="number" inputmode="numeric" step="1" min="0" value="${esc(p.minimumStock ?? 3)}"></label>
      </div>

      ${showCost ? `<label class="field"><span>Supplier</span><select name="supplierId">${supplierOptions(p.supplierId)}</select></label>` : ""}
      <label class="field"><span>Description</span><textarea name="description">${esc(p.description || "")}</textarea></label>
      <label class="check"><input type="checkbox" name="active" ${(p.status || "active") === "active" ? "checked" : ""}><span>Active (available for billing)</span></label>
      <div id="pe-err" class="form-error hidden"></div>`,
    footer: `<button class="btn btn-soft" data-close>Cancel</button>
             <button class="btn btn-primary" id="pe-save">${isNew ? "Create Product" : "Save Changes"}</button>`,
    onMount(api) {
      const root = api.root;
      let imageFile = null;
      let imageUrl = p.imageUrl || "";

      root.querySelector("#pe-pick-img").onclick = () => root.querySelector("#pe-file").click();
      root.querySelector("#pe-file").onchange = (e) => {
        const f = e.target.files[0]; if (!f) return;
        if (f.size > 4 * 1024 * 1024) { warn("Please choose an image under 4 MB"); return; }
        imageFile = f;
        const r = new FileReader();
        r.onload = () => { root.querySelector("#pe-thumb").innerHTML = `<img src="${r.result}" alt="">`; };
        r.readAsDataURL(f);
        root.querySelector("#pe-img-note").textContent = f.name;
      };
      root.querySelector("#pe-gen-bc").onclick = async () => {
        const seq = await nextSkuSequence();
        root.querySelector("[name=barcode]").value = buildBarcode(seq);
      };

      root.querySelector("#pe-save").onclick = async () => {
        const d = formData(root);
        const errBox = root.querySelector("#pe-err");
        const fail = (m) => { errBox.textContent = m; errBox.classList.remove("hidden"); };
        errBox.classList.add("hidden");

        if (!d.productName.trim()) return fail("Product name is required.");
        if (!d.categoryId) return fail("Please choose a category.");
        if (toNum(d.sellingPrice) <= 0) return fail("Selling price must be greater than zero.");
        if (showCost && toNum(d.purchasePrice) > toNum(d.sellingPrice)) {
          if (!await confirmDialog("Selling price is below the purchase price. Save anyway?", { okText: "Save" })) return;
        }

        const dupSku = d.sku && state.products.find((x) => upper(x.sku) === upper(d.sku) && x.id !== product?.id);
        if (dupSku) return fail(`SKU ${d.sku} is already used by ${dupSku.productName}.`);
        const dupBc = d.barcode && state.products.find((x) => x.barcode === d.barcode.trim() && x.id !== product?.id);
        if (dupBc) return fail(`Barcode already used by ${dupBc.productName}.`);

        try {
          busy(true, isNew ? "Creating product…" : "Saving…");
          const cat = categoryById(d.categoryId);
          let sku = d.sku.trim(), code = d.productCode.trim(), barcode = d.barcode.trim();
          if (!sku || !code || !barcode) {
            const seq = await nextSkuSequence();
            if (!sku) sku = buildSku(s.skuPrefix || "VYS", (cat?.code || "GEN"), seq);
            if (!code) code = `${upper(s.skuPrefix || "VYS")}${String(seq).padStart(6, "0")}`;
            if (!barcode) barcode = buildBarcode(seq);
          }

          const payload = {
            productName: d.productName.trim(),
            sku: upper(sku), productCode: upper(code), barcode,
            categoryId: d.categoryId, categoryName: cat?.name || "",
            subcategory: d.subcategory.trim(), brand: d.brand.trim(),
            colour: d.colour.trim(), fabric: d.fabric.trim(), size: d.size.trim(),
            sellingPrice: toNum(d.sellingPrice),
            discount: toNum(d.discount), gstRate: toNum(d.gstRate),
            minimumStock: toInt(d.minimumStock, 0),
            description: d.description.trim(),
            status: d.active ? "active" : "inactive",
            qrData: barcode,
            search: searchTokens(d.productName, sku, code, barcode, d.brand, d.colour, d.fabric, cat?.name)
          };

          let id = product?.id;
          if (isNew) {
            // Create at zero, then book the opening stock as a real movement
            // so the count and its history agree from the first day.
            const opening = toNum(d.stock);
            payload.stock = 0;
            id = await createDoc(C.products, payload);
            if (opening) {
              await addStock({ id }, opening, "OPENING", "Opening stock");
              payload.stock = opening;
            }
            logActivity("PRODUCT_ADDED", `${payload.sku} · ${payload.productName}`, "product", id);
          } else {
            await updateDocById(C.products, id, payload);
            logActivity("PRODUCT_UPDATED", `${payload.sku} · ${payload.productName}`, "product", id);
          }

          // The cost record is the owner's alone; it is only written when there
          // is something to record, so a shop that does not track cost never
          // creates one.
          if (showCost && (toNum(d.purchasePrice) > 0 || d.supplierId || cost)) {
            await saveCost(id, {
              purchasePrice: toNum(d.purchasePrice),
              supplierId: d.supplierId || "",
              supplierName: state.suppliers.find((x) => x.id === d.supplierId)?.name || ""
            });
            await refreshCosts();
          }

          if (imageFile) {
            imageUrl = await uploadImage(imageFile, `products/${id}`);
            await updateDocById(C.products, id, { imageUrl });
          }

          api.close();
          ok(isNew ? "Product created" : "Product saved");
          if (onSaved) onSaved({ id, ...payload, imageUrl });
        } catch (e) {
          console.error(e); fail(e.message || "Could not save the product.");
        } finally { busy(false); }
      };
    }
  });
}

/* ============================================================
   Customer editor
   ============================================================ */
export function openCustomerEditor(customer, onSaved) {
  const isNew = !customer;
  const c = customer || { name: "", mobile: "", email: "", address: "", gstin: "", notes: "" };
  openSheet({
    title: isNew ? "Add Customer" : "Edit Customer",
    body: `
      <label class="field req"><span>Customer name</span><input name="name" value="${esc(c.name)}" required></label>
      <div class="grid2">
        <label class="field"><span>Mobile</span><input name="mobile" type="tel" inputmode="numeric" maxlength="10" value="${esc(c.mobile || "")}"></label>
        <label class="field"><span>Email</span><input name="email" type="email" value="${esc(c.email || "")}"></label>
      </div>
      <label class="field"><span>Address</span><textarea name="address">${esc(c.address || "")}</textarea></label>
      <label class="field"><span>GSTIN (for B2B bills)</span><input name="gstin" class="mono" value="${esc(c.gstin || "")}" maxlength="15"></label>
      <label class="field"><span>Notes</span><input name="notes" value="${esc(c.notes || "")}"></label>
      <div id="ce-err" class="form-error hidden"></div>`,
    footer: `<button class="btn btn-soft" data-close>Cancel</button>
             <button class="btn btn-primary" id="ce-save">${isNew ? "Add Customer" : "Save"}</button>`,
    onMount(api) {
      api.root.querySelector("#ce-save").onclick = async () => {
        const d = formData(api.root);
        const box = api.root.querySelector("#ce-err");
        const fail = (m) => { box.textContent = m; box.classList.remove("hidden"); };
        box.classList.add("hidden");
        if (!d.name.trim()) return fail("Customer name is required.");
        if (d.mobile && !validMobile(d.mobile)) return fail("Mobile number must be 10 digits.");
        if (d.email && !validEmail(d.email)) return fail("That email address is not valid.");
        if (d.gstin && !validGstin(d.gstin)) return fail("That GSTIN does not look valid.");
        const dup = d.mobile && state.customers.find((x) => x.mobile === d.mobile.trim() && x.id !== customer?.id);
        if (dup) return fail(`${dup.name} already uses this mobile number.`);
        try {
          busy(true, "Saving…");
          const payload = {
            name: d.name.trim(), mobile: d.mobile.trim(), email: d.email.trim(),
            address: d.address.trim(), gstin: upper(d.gstin), notes: d.notes.trim()
          };
          let id = customer?.id;
          if (isNew) { id = await createDoc(C.customers, { ...payload, totalPurchases: 0, outstanding: 0 }); }
          else await updateDocById(C.customers, id, payload);
          api.close(); ok(isNew ? "Customer added" : "Customer saved");
          if (onSaved) onSaved({ id, ...payload });
        } catch (e) { fail(e.message); } finally { busy(false); }
      };
    }
  });
}

/* ============================================================
   Supplier editor
   ============================================================ */
export function openSupplierEditor(supplier, onSaved) {
  const isNew = !supplier;
  const s = supplier || { name: "", mobile: "", email: "", address: "", gstin: "", productsSupplied: "" };
  openSheet({
    title: isNew ? "Add Supplier" : "Edit Supplier",
    body: `
      <label class="field req"><span>Supplier name</span><input name="name" value="${esc(s.name)}" required></label>
      <div class="grid2">
        <label class="field"><span>Mobile</span><input name="mobile" type="tel" inputmode="numeric" maxlength="10" value="${esc(s.mobile || "")}"></label>
        <label class="field"><span>Email</span><input name="email" type="email" value="${esc(s.email || "")}"></label>
      </div>
      <label class="field"><span>Address</span><textarea name="address">${esc(s.address || "")}</textarea></label>
      <label class="field"><span>GSTIN</span><input name="gstin" class="mono" value="${esc(s.gstin || "")}" maxlength="15"></label>
      <label class="field"><span>Products supplied</span><input name="productsSupplied" value="${esc(s.productsSupplied || "")}" placeholder="Silk sarees, blouses"></label>
      <div id="se-err" class="form-error hidden"></div>`,
    footer: `<button class="btn btn-soft" data-close>Cancel</button>
             <button class="btn btn-primary" id="se-save">${isNew ? "Add Supplier" : "Save"}</button>`,
    onMount(api) {
      api.root.querySelector("#se-save").onclick = async () => {
        const d = formData(api.root);
        const box = api.root.querySelector("#se-err");
        const fail = (m) => { box.textContent = m; box.classList.remove("hidden"); };
        box.classList.add("hidden");
        if (!d.name.trim()) return fail("Supplier name is required.");
        if (d.mobile && !validMobile(d.mobile)) return fail("Mobile number must be 10 digits.");
        if (d.gstin && !validGstin(d.gstin)) return fail("That GSTIN does not look valid.");
        try {
          busy(true, "Saving…");
          const payload = {
            name: d.name.trim(), mobile: d.mobile.trim(), email: d.email.trim(),
            address: d.address.trim(), gstin: upper(d.gstin), productsSupplied: d.productsSupplied.trim()
          };
          let id = supplier?.id;
          if (isNew) id = await createDoc(C.suppliers, { ...payload, totalPurchases: 0, outstanding: 0 });
          else await updateDocById(C.suppliers, id, payload);
          api.close(); ok(isNew ? "Supplier added" : "Supplier saved");
          if (onSaved) onSaved({ id, ...payload });
        } catch (e) { fail(e.message); } finally { busy(false); }
      };
    }
  });
}

/* ============================================================
   Small reusable bits
   ============================================================ */
export const productRow = (p) => {
  const st = stockStatus(p);
  return `<div class="thumb">${p.imageUrl ? `<img src="${esc(fileUrl(p.imageUrl))}" alt="">` : esc((p.productName || "?").slice(0, 2).toUpperCase())}</div>
    <div class="mid">
      <b>${esc(p.productName)}${(p.status || "active") !== "active" ? ' <span class="pill mut">Inactive</span>' : ""}</b>
      <small>${esc(p.sku || "")}${p.colour ? " · " + esc(p.colour) : ""}${p.size ? " · " + esc(p.size) : ""}</small>
    </div>
    <div class="end"><b>${money(p.sellingPrice)}</b>
      <small class="pill ${st.cls}">${st.key === "ok" ? toNum(p.stock) + " pcs" : st.label}</small></div>`;
};

export function sectionTitle(t, right = "") {
  return `<div class="sec-title" style="display:flex;justify-content:space-between;align-items:center">
            <span>${esc(t)}</span>${right}</div>`;
}
