/* ============================================================
   VYRA SAREES - Categories
   ============================================================ */
import { state, on, can } from "../store.js";
import { C, createDoc, updateDocById, removeDoc } from "../db.js";
import { icon, openSheet, emptyState, ok, err, warn, busy, confirmDialog, formData, toast } from "../ui.js";
import { esc, toNum, toInt, upper, matches, debounce } from "../utils.js";

export const title = "Categories";

const DEFAULTS = [
  ["Sarees", "SAR"], ["Silk Sarees", "SLK"], ["Cotton Sarees", "COT"], ["Designer Sarees", "DSG"],
  ["Bridal Sarees", "BRD"], ["Party Wear Sarees", "PTY"], ["Chudidars", "CHU"], ["Kurtis", "KUR"],
  ["Salwar Sets", "SLW"], ["Blouses", "BLS"], ["Kids Wear", "KID"], ["Accessories", "ACC"],
  ["Jewellery", "JWL"], ["Other", "OTH"]
];

export async function mount(view, { go }) {
  if (!can("categories.manage")) { view.innerHTML = emptyState("Not permitted", "Ask the shop owner for access", "alert"); return; }
  let q = "";

  const paint = () => {
    const list = state.categories.filter((c) => matches([c.name, c.code].join(" "), q));
    const counts = new Map();
    state.products.forEach((p) => counts.set(p.categoryId, (counts.get(p.categoryId) || 0) + 1));

    view.innerHTML = `
      <div class="searchbar">
        <div class="swrap">${icon("search")}<input id="ct-q" placeholder="Search categories" value="${esc(q)}"></div>
        <button class="icon-btn" id="ct-add">${icon("plus")}</button>
      </div>
      <ul class="list card pad0">
        ${list.length ? list.map((c) => `
          <li class="row" data-id="${c.id}">
            <div class="thumb">${esc(c.code || (c.name || "?").slice(0, 3).toUpperCase())}</div>
            <div class="mid"><b>${esc(c.name)}${(c.status || "active") !== "active" ? ' <span class="pill mut">Inactive</span>' : ""}</b>
              <small>${counts.get(c.id) || 0} product${(counts.get(c.id) || 0) === 1 ? "" : "s"}</small></div>
            <div class="end">${icon("edit")}</div>
          </li>`).join("") : emptyState("No categories yet", "Add your first category, or load the boutique defaults", "tag")}
      </ul>
      ${state.categories.length ? "" : `<button class="btn btn-outline btn-block mt" id="ct-seed">Load default boutique categories</button>`}
      <p class="form-note mt">The category code becomes part of every SKU, for example <span class="mono">VYS-SAR-00125</span>.</p>`;

    view.querySelector("#ct-q").oninput = debounce((e) => { q = e.target.value.trim(); paint(); }, 150);
    view.querySelector("#ct-add").onclick = () => editor(null);
    view.querySelectorAll("[data-id]").forEach((li) => {
      li.onclick = () => editor(state.categories.find((c) => c.id === li.dataset.id));
    });
    const seed = view.querySelector("#ct-seed");
    if (seed) seed.onclick = seedDefaults;
  };

  paint();
  const off = on("categories", paint);
  return () => off();
}

function editor(cat) {
  const isNew = !cat;
  const c = cat || { name: "", code: "", description: "", sortOrder: state.categories.length + 1, status: "active" };
  openSheet({
    title: isNew ? "Add Category" : "Edit Category",
    body: `
      <label class="field req"><span>Category name</span><input name="name" value="${esc(c.name)}" required></label>
      <div class="grid2">
        <label class="field req"><span>Code (for SKU)</span>
          <input name="code" class="mono" maxlength="4" value="${esc(c.code || "")}" placeholder="SAR" required></label>
        <label class="field"><span>Sort order</span>
          <input name="sortOrder" type="number" value="${toInt(c.sortOrder, 1)}"></label>
      </div>
      <label class="field"><span>Description</span><input name="description" value="${esc(c.description || "")}"></label>
      <label class="check"><input type="checkbox" name="active" ${(c.status || "active") === "active" ? "checked" : ""}><span>Active</span></label>
      <div id="ct-err" class="form-error hidden"></div>`,
    footer: `${isNew ? "" : `<button class="btn btn-danger" id="ct-del">${icon("trash")}</button>`}
             <button class="btn btn-soft" data-close>Cancel</button>
             <button class="btn btn-primary" id="ct-save">Save</button>`,
    onMount(api) {
      const fail = (m) => { const b = api.root.querySelector("#ct-err"); b.textContent = m; b.classList.remove("hidden"); };
      api.root.querySelector("#ct-save").onclick = async () => {
        const d = formData(api.root);
        if (!d.name.trim()) return fail("Category name is required.");
        if (!d.code.trim()) return fail("A short code is required - it is used in SKUs.");
        const dup = state.categories.find((x) => upper(x.code) === upper(d.code) && x.id !== cat?.id);
        if (dup) return fail(`Code ${upper(d.code)} is already used by ${dup.name}.`);
        try {
          busy(true, "Saving…");
          const payload = {
            name: d.name.trim(), code: upper(d.code).slice(0, 4),
            description: d.description.trim(), sortOrder: toInt(d.sortOrder, 1),
            status: d.active ? "active" : "inactive"
          };
          if (isNew) await createDoc(C.categories, payload);
          else await updateDocById(C.categories, cat.id, payload);
          api.close(); ok("Category saved");
        } catch (e) { fail(e.message); } finally { busy(false); }
      };
      const del = api.root.querySelector("#ct-del");
      if (del) del.onclick = async () => {
        const used = state.products.filter((p) => p.categoryId === cat.id).length;
        if (used) { warn(`${used} product${used > 1 ? "s use" : " uses"} this category. Deactivate it instead.`); return; }
        if (!await confirmDialog(`Delete the category "${cat.name}"?`, { okText: "Delete", danger: true })) return;
        await removeDoc(C.categories, cat.id);
        api.close(); ok("Category deleted");
      };
    }
  });
}

async function seedDefaults() {
  if (!await confirmDialog("Add the 14 default boutique categories?", { okText: "Add them" })) return;
  try {
    busy(true, "Creating categories…");
    for (const [i, [name, code]] of DEFAULTS.entries()) {
      await createDoc(C.categories, {
        name, code, description: "", sortOrder: i + 1, status: "active"
      });
    }
    ok("Default categories added");
  } catch (e) { err(e.message); } finally { busy(false); }
}
