/* ============================================================
   ARUMBAGAM - live local cache
   ------------------------------------------------------------
   Master data (products, categories, customers, suppliers) is
   mirrored locally. Everything the UI searches runs against this
   cache, which keeps look-ups instant on the counter phone.

   Firestore pushes changes to us: each mirrored collection has a
   live listener, so the first paint comes from the on-device
   cache and after that only what actually changed is fetched -
   a second till's price change turns up here on its own. The
   last good copy is kept in localStorage as well, so the product
   list still opens on a cold start with no network.
   ============================================================ */
import { C, listCosts, loadSettings, watchDocs, watchSettings, setActor } from "./db.js";
import { matches, sleep, toNum, upper } from "./utils.js";

export const state = {
  user: null,               // { uid, name, email, role, permissions }
  settings: null,
  products: [],
  categories: [],
  customers: [],
  suppliers: [],
  costs: {},                // productId -> purchase price, owner only
  costsLoaded: false,       // the owner's cost records actually arrived
  costsError: "",           // ... or why they did not
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

/* ---------- the mirrored collections ---------- */
const byName = (a, b) =>
  String(a.productName || a.name || "").localeCompare(String(b.productName || b.name || ""));

const MIRRORS = {
  products: { collection: C.products, sort: byName },
  categories: {
    collection: C.categories,
    sort: (a, b) => toNum(a.sortOrder) - toNum(b.sortOrder) || byName(a, b)
  },
  customers: { collection: C.customers, sort: byName },
  // Suppliers sit behind the cost wall, so staff never mirror them.
  suppliers: { collection: C.suppliers, sort: byName, needs: () => canSeeCost() }
};

/* ---------- cost prices (owner only) ----------
   These live in their own collection that the security rules open to the
   admin alone, so a staff device is never sent them. */
export async function refreshCosts({ retries = 3 } = {}) {
  if (!canSeeCost()) {
    state.costs = {}; state.costsLoaded = false; state.costsError = "";
    emit("costs", state.costs);
    return;
  }
  try {
    const map = {};
    (await listCosts()).forEach((c) => {
      map[c.productId || c.id] = {
        purchasePrice: toNum(c.purchasePrice),
        supplierId: c.supplierId || "",
        supplierName: c.supplierName || ""
      };
    });
    state.costs = map;
    state.costsLoaded = true;
    state.costsError = "";
  } catch (e) {
    // Offline, or the profile had not landed yet when this first ran. Either
    // way the owner must not be shown an empty figure as if it were the
    // truth, so the failure is kept and quietly retried.
    state.costs = state.costs || {};
    state.costsLoaded = false;
    state.costsError = costReason(e);
    if (retries > 0) setTimeout(() => refreshCosts({ retries: retries - 1 }), 3000);
  }
  emit("costs", state.costs);
}

/** Say what actually went wrong, in words that point at the fix. */
function costReason(e) {
  const code = e?.code || "";
  if (code === "permission-denied") {
    return "Firestore refused the purchase prices. The rules for product_costs are not published yet, "
      + "or this account's profile is not role admin. Publish the rules and sign in as the owner.";
  }
  if (code === "unavailable" || code === "failed-precondition" || /offline/i.test(e?.message || "")) {
    return "No connection to Firestore, so the purchase prices could not be fetched.";
  }
  if (code === "unauthenticated") return "Signed out. Sign in again as the owner.";
  return e?.message ? `${e.message}${code ? ` (${code})` : ""}` : "Purchase prices could not be loaded.";
}

/** Whether the owner's cost figures are trustworthy right now. */
export const costsStatus = () => ({ loaded: state.costsLoaded, error: state.costsError });

/** What we paid for one product. Zero for anyone who may not see costs. */
export const costOf = (productId) => (canSeeCost() ? toNum(state.costs[productId]?.purchasePrice) : 0);

/** The supplier we last bought this product from. Owner only. */
export const costSupplier = (productId) => (canSeeCost() ? (state.costs[productId]?.supplierName || "") : "");

const CACHE_KEY = "demo.cache";

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch { return {}; }
}
function writeCache(key, list) {
  try {
    const cache = readCache();
    cache[key] = list;
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch { /* quota or private mode - the cache is only a convenience */ }
}

/* ---------- lifecycle ---------- */
let stops = [];
let changeHandler = null;

/** Publish one collection's documents. */
function publish(key, docs) {
  const mirror = MIRRORS[key];
  state[key] = docs.slice().sort(mirror.sort);
  state.ready[key] = true;
  writeCache(key, state[key]);
  emit(key, state[key]);
  emit("data", key);
}

/** Put whatever was left on the device on screen while the data loads. */
function seedFromCache(key) {
  if (state.ready[key]) return;
  const cached = readCache()[key];
  if (Array.isArray(cached)) {
    state[key] = cached;
    state.ready[key] = true;
    emit(key, state[key]);
  }
}

export async function startStore(user) {
  stopStore();
  state.user = user;
  setActor(user);
  state.settings = await loadSettings();
  emit("settings", state.settings);

  // Each mirror gets one live listener. The first callback normally arrives
  // from the on-device cache within a tick, so the app opens on real data;
  // the wait is capped so a blocked collection can never hold up the boot.
  const firstPaints = Object.keys(MIRRORS).map((key) => {
    const mirror = MIRRORS[key];
    if (mirror.needs && !mirror.needs()) {             // e.g. staff and suppliers
      state[key] = [];
      state.ready[key] = true;
      emit(key, state[key]);
      return Promise.resolve();
    }

    let done;
    const ready = new Promise((res) => { done = res; });
    stops.push(watchDocs(
      mirror.collection,
      (docs) => { publish(key, docs); done(); },
      (e) => {
        if (state.online) console.error(`${key} listener:`, e);
        seedFromCache(key);
        emit("error", e);
        done();
      }
    ));
    return Promise.race([ready, sleep(4000).then(() => seedFromCache(key))]);
  });

  await Promise.all(firstPaints);
  await refreshCosts();

  stops.push(watchSettings(
    (s) => { state.settings = s; emit("settings", s); },
    () => {}
  ));

  // Cost prices have no listener - they are read once and after any write,
  // because only the owner ever holds them.
  changeHandler = (e) => {
    const name = e.detail?.collection;
    if (name === C.productCosts) refreshCosts();
  };
  window.addEventListener("demo:changed", changeHandler);
}

export function stopStore() {
  stops.forEach((off) => { try { off(); } catch { /* already gone */ } });
  stops = [];
  if (changeHandler) { window.removeEventListener("demo:changed", changeHandler); changeHandler = null; }
  Object.keys(state.ready).forEach((k) => { state.ready[k] = false; });
  state.products = []; state.categories = []; state.customers = []; state.suppliers = [];
  state.costs = {}; state.costsLoaded = false; state.costsError = "";
}

window.addEventListener("online", () => { state.online = true; emit("net", true); refreshCosts(); });
window.addEventListener("offline", () => { state.online = false; emit("net", false); });

/* ---------- lookups ---------- */
export const productById = (id) => state.products.find((p) => p.id === id) || null;
export const categoryById = (id) => state.categories.find((c) => c.id === id) || null;
export const customerById = (id) => state.customers.find((c) => c.id === id) || null;
export const supplierById = (id) => state.suppliers.find((s) => s.id === id) || null;

/** Resolve a scanned / typed code to a product. Matches barcode, SKU, code or id. */
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
export const stockValue = () => state.products.reduce((a, p) => a + toNum(p.stock) * costOf(p.id), 0);

/* ============================================================
   Permissions
   ------------------------------------------------------------
   Firestore enforces all of this again on every single request -
   see firestore.rules. What follows only decides what the UI
   bothers to draw.

   Staff start with the counter work only: billing, the product
   list at selling price, customers and label printing. Anything
   else has to be granted on the staff profile, and the owner's
   own numbers - purchase price, margin, profit, supplier, stock
   value - can never be granted at all.
   ============================================================ */

/** Held by every active staff account unless an admin turns it off. */
const STAFF_DEFAULT = new Set([
  "sales.create",
  "products.view",
  "customers.view",
  "labels.print"
]);

/** Owner only, whatever the profile says - these expose what we paid. */
const ADMIN_ONLY = new Set(["cost.view", "purchases.manage", "suppliers.manage"]);

export function isAdmin() { return state.user?.role === "admin"; }

/** Admin can do everything; staff only what STAFF_DEFAULT or their profile grants. */
export function can(permission) {
  if (!state.user) return false;
  if (state.user.role === "admin") return true;
  if (ADMIN_ONLY.has(permission)) return false;
  const p = state.user.permissions || {};
  if (p[permission] === true) return true;
  if (p[permission] === false) return false;
  return STAFF_DEFAULT.has(permission);
}

/**
 * Purchase price, margin, profit, supplier and stock value.
 * The shop owner only - never shown to staff.
 */
export function canSeeCost() { return isAdmin(); }

export function requireAdmin() {
  if (!isAdmin()) throw new Error("Admin permission required");
}
