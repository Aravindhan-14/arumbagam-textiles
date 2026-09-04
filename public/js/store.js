/* ============================================================
   VYRA SAREES - live local cache
   ------------------------------------------------------------
   Master data (products, categories, customers, suppliers) is
   mirrored locally through onSnapshot listeners.  Everything the
   UI searches runs against this cache, which keeps look-ups
   instant and lets the shop keep billing while offline.
   ============================================================ */
import {
  col, onSnapshot, query, where, orderBy, loadSettings, setActor, ref, getDoc, C
} from "./db.js";
import { matches, toNum, upper } from "./utils.js";

export const state = {
  user: null,               // { uid, name, email, role, permissions }
  settings: null,
  products: [],
  categories: [],
  customers: [],
  suppliers: [],
  ready: { products: false, categories: false, customers: false, suppliers: false },
  online: navigator.onLine
};

/* ---------- tiny event bus ---------- */
const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt).delete(fn);
}
export function emit(evt, payload) {
  (listeners.get(evt) || []).forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } });
  (listeners.get("*") || []).forEach((fn) => fn(evt, payload));
}

/* ---------- lifecycle ---------- */
let unsubs = [];

export async function startStore(user) {
  stopStore();
  state.user = user;
  setActor(user);
  state.settings = await loadSettings();
  emit("settings", state.settings);

  const bind = (name, key, sortFn, q) => onSnapshot(
    q || col(name),
    (snap) => {
      state[key] = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(sortFn);
      state.ready[key] = true;
      emit(key, state[key]);
      emit("data", key);
    },
    (e) => { console.error(`${name} listener:`, e); emit("error", e); }
  );

  const byName = (a, b) => String(a.productName || a.name || "").localeCompare(String(b.productName || b.name || ""));

  unsubs = [
    bind(C.products, "products", byName),
    bind(C.categories, "categories", (a, b) => toNum(a.sortOrder) - toNum(b.sortOrder) || byName(a, b)),
    bind(C.customers, "customers", byName),
    bind(C.suppliers, "suppliers", byName),
    onSnapshot(ref(C.settings, "business"), (s) => {
      if (s.exists()) { state.settings = { ...state.settings, ...s.data(), _configured: true }; emit("settings", state.settings); }
    }, () => {})
  ];
}

export function stopStore() {
  unsubs.forEach((u) => { try { u(); } catch {} });
  unsubs = [];
  Object.keys(state.ready).forEach((k) => { state.ready[k] = false; });
  state.products = []; state.categories = []; state.customers = []; state.suppliers = [];
}

window.addEventListener("online", () => { state.online = true; emit("net", true); });
window.addEventListener("offline", () => { state.online = false; emit("net", false); });

/* ---------- lookups ---------- */
export const productById = (id) => state.products.find((p) => p.id === id) || null;
export const categoryById = (id) => state.categories.find((c) => c.id === id) || null;
export const customerById = (id) => state.customers.find((c) => c.id === id) || null;
export const supplierById = (id) => state.suppliers.find((s) => s.id === id) || null;

/** Resolve a scanned / typed code to a product. Matches barcode, SKU, code or doc id. */
export function findByCode(raw) {
  const code = String(raw || "").trim();
  if (!code) return null;
  const up = upper(code);
  return state.products.find((p) =>
    p.barcode === code ||
    upper(p.sku) === up ||
    upper(p.productCode) === up ||
    p.id === code ||
    (p.qrData && p.qrData === code)
  ) || null;
}

export function productBlob(p) {
  return [p.productName, p.sku, p.productCode, p.barcode, p.brand, p.colour, p.fabric,
    p.size, p.categoryName, p.subcategory, p.description].filter(Boolean).join(" ");
}

/**
 * Client-side product search.
 * filters = { categoryId, status, stock:"low"|"out"|"in", brand }
 */
export function searchProducts(q = "", filters = {}) {
  let list = state.products;
  if (filters.status) list = list.filter((p) => (p.status || "active") === filters.status);
  if (filters.categoryId) list = list.filter((p) => p.categoryId === filters.categoryId);
  if (filters.brand) list = list.filter((p) => p.brand === filters.brand);
  if (filters.stock === "low") list = list.filter((p) => toNum(p.stock) > 0 && toNum(p.stock) <= toNum(p.minimumStock));
  if (filters.stock === "out") list = list.filter((p) => toNum(p.stock) <= 0);
  if (filters.stock === "in") list = list.filter((p) => toNum(p.stock) > 0);
  if (q) list = list.filter((p) => matches(productBlob(p), q));
  return list;
}

export function searchCustomers(q = "") {
  if (!q) return state.customers;
  return state.customers.filter((c) => matches([c.name, c.mobile, c.email, c.gstin].join(" "), q));
}
export function searchSuppliers(q = "") {
  if (!q) return state.suppliers;
  return state.suppliers.filter((s) => matches([s.name, s.mobile, s.email, s.gstin].join(" "), q));
}

/* ---------- derived dashboards ---------- */
export const lowStockProducts = () => state.products.filter(
  (p) => (p.status || "active") === "active" && toNum(p.stock) > 0 && toNum(p.minimumStock) > 0 && toNum(p.stock) <= toNum(p.minimumStock)
);
export const outOfStockProducts = () => state.products.filter(
  (p) => (p.status || "active") === "active" && toNum(p.stock) <= 0
);
export const totalStockUnits = () => state.products.reduce((a, p) => a + toNum(p.stock), 0);
export const stockValue = () => state.products.reduce((a, p) => a + toNum(p.stock) * toNum(p.purchasePrice), 0);

/* ---------- permissions ---------- */
const ADMIN_ONLY = new Set([
  "products.delete", "products.create", "products.edit",
  "categories.manage", "staff.manage", "settings.manage", "gst.manage",
  "sales.cancel", "sales.editPrice", "purchases.manage", "suppliers.manage",
  "reports.full", "inventory.adjust", "returns.create"
]);

export function isAdmin() { return state.user?.role === "admin"; }

/** Admin can do everything; staff only what their user doc grants. */
export function can(permission) {
  if (!state.user) return false;
  if (state.user.role === "admin") return true;
  const p = state.user.permissions || {};
  if (p[permission] === true) return true;
  if (p[permission] === false) return false;
  return !ADMIN_ONLY.has(permission);
}

export function requireAdmin() {
  if (!isAdmin()) throw new Error("Admin permission required");
}
