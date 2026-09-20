/* ============================================================
   demo SAREES - Firebase bootstrap + data access layer
   ------------------------------------------------------------
   Every read and write in the app comes through this module.
   There is no shop server any more: the phone talks straight to
   Firestore, and Firestore's own on-device cache is what keeps
   the counter working when the network drops. A bill saved
   offline is applied locally at once and replayed by the SDK as
   soon as the connection returns.

   Bills, purchases, returns and stock moves are written as a
   single batch, so a half-saved bill is not a thing that can
   happen.

   Document numbers are drawn from a block reserved ahead of
   time, which is what lets two tills bill at once - and keeps
   billing going with no network at all.

   Cost prices are NOT stored on the product. They live in
   product_costs/{productId}, which firestore.rules opens to the
   admin only, so a staff device never receives what the shop
   paid. See store.js -> canSeeCost().
   ============================================================ */
import { firebaseConfig, SDK } from "./firebase-config.js";
import { buildDocNo, dayKey, round2, toNum } from "./utils.js";

/* ---------- SDK ---------- */
const [A, AU, FS, ST] = await Promise.all([
  import(`${SDK}/firebase-app.js`),
  import(`${SDK}/firebase-auth.js`),
  import(`${SDK}/firebase-firestore.js`),
  import(`${SDK}/firebase-storage.js`)
]);

export const app = A.initializeApp(firebaseConfig);
export const auth = AU.getAuth(app);
export const storage = ST.getStorage(app);

/* Multi-tab persistent cache: the shop can have the app open on the
   till and on a phone at the same time and both keep working offline. */
export const db = FS.initializeFirestore(app, {
  localCache: FS.persistentLocalCache({ tabManager: FS.persistentMultipleTabManager() })
});

/* Re-export the SDK pieces auth.js and the staff screen need. */
export const {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, writeBatch, runTransaction,
  serverTimestamp, increment, Timestamp
} = FS;
export const {
  signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail,
  createUserWithEmailAndPassword, updatePassword, EmailAuthProvider, reauthenticateWithCredential
} = AU;

/* ---------- collection names ---------- */
export const C = {
  users: "users",
  products: "products",
  productCosts: "product_costs",
  categories: "categories",
  customers: "customers",
  suppliers: "suppliers",
  sales: "sales",
  purchases: "purchases",
  returns: "returns",
  stockHistory: "stock_history",
  activity: "activity_log",
  settings: "settings"
};
const col = (name) => collection(db, name);
const ref = (name, id) => doc(db, name, id);
const newRef = (name) => doc(collection(db, name));

/** Wrap a number to mean "add this to what is already stored". */
export const incr = (n) => ({ __inc: toNum(n) });

/** Fired after any write so the local cache can refresh itself. */
function changed(collectionName) {
  window.dispatchEvent(new CustomEvent("demo:changed", { detail: { collection: collectionName } }));
}

/* ============================================================
   Reading: Firestore documents -> plain objects
   ------------------------------------------------------------
   Timestamps come back as Firestore Timestamp objects; the rest
   of the app only ever sees ISO strings, so everything (CSV
   export, printing, date maths) stays ordinary JavaScript.
   ============================================================ */
function plain(value) {
  if (value == null) return value;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = plain(v);
    return out;
  }
  return value;
}
const fromSnap = (d) => ({ ...plain(d.data()), id: d.id });

/**
 * Prepare data for writing: unwrap incr() markers and drop undefined,
 * which Firestore rejects.
 */
function prep(data) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (v === undefined) continue;
    out[k] = v && typeof v === "object" && "__inc" in v ? increment(v.__inc) : v;
  }
  return out;
}

/* Writes carry a client timestamp so that a document created with no
   network sorts and filters correctly on this device straight away; a
   server timestamp is stored alongside it as the authoritative one. */
const stamps = () => ({
  createdAt: Timestamp.now(),
  serverCreatedAt: serverTimestamp(),
  dayKey: dayKey()
});

/* ============================================================
   Settings
   ============================================================ */
export const DEFAULT_SETTINGS = {
  businessName: "demo SAREES",
  businessType: "Boutique & Textiles",
  address: "",
  mobile: "",
  email: "",
  gstin: "",
  logoUrl: "",
  stateCode: "",
  currency: "₹",
  invoicePrefix: "INV",
  purchasePrefix: "PUR",
  returnPrefix: "RET",
  skuPrefix: "VYS",
  gstEnabled: true,
  gstMode: "exclusive",          // exclusive | inclusive
  defaultGstRate: 5,
  roundOff: true,
  allowNegativeStock: false,
  maxStaffDiscountPct: 10,
  lowStockDefault: 3,
  printerWidth: 58,              // 58 | 80
  footerMessage: "Thank You for Shopping with demo SAREES\nVisit Again",
  labelWidthMm: 50,             // one sticker, as measured off the roll
  labelHeightMm: 25,
  labelsPerRow: 2,              // stickers side by side across the roll
  labelGapMm: 0,                // the gap between them
  labelShiftXMm: 0,             // nudge the printing across the roll
  labelShiftYMm: 0              // ... and along it
};

const BUSINESS_DOC = () => ref(C.settings, "business");
const COUNTER_DOC = () => ref(C.settings, "counters");
const SETTINGS_CACHE = "demo.settings";

export async function loadSettings() {
  try {
    const snap = await getDoc(BUSINESS_DOC());
    // _configured is false on a brand-new project; saving settings closes
    // the one-time bootstrap window in the security rules.
    const merged = {
      ...DEFAULT_SETTINGS,
      ...(snap.exists() ? plain(snap.data()) : {}),
      _configured: snap.exists()
    };
    try { localStorage.setItem(SETTINGS_CACHE, JSON.stringify(merged)); } catch { /* private mode */ }
    return merged;
  } catch (e) {
    try {
      const cached = JSON.parse(localStorage.getItem(SETTINGS_CACHE) || "null");
      if (cached) return cached;
    } catch { /* nothing cached */ }
    return { ...DEFAULT_SETTINGS, _configured: false };
  }
}

export async function saveSettings(patch) {
  await setDoc(BUSINESS_DOC(), { ...prep(patch), updatedAt: serverTimestamp() }, { merge: true });
  changed("settings");
}

/* ============================================================
   Reading
   ============================================================ */
/**
 * List records.
 * @param {string} name       collection
 * @param {object} opts
 *   where   [[field, "=="|"!="|"<"|"<="|">"|">="|"in", value], ...]
 *   orderBy { field, dir:"asc"|"desc" }  or  "field"
 *   limit / offset
 *   from / to   Date range over createdAt
 */
export async function listDocs(name, opts = {}) {
  const parts = [];
  (opts.where || []).forEach(([field, op, value]) => parts.push(where(field, op, value)));

  const asDate = (v) => (v instanceof Date ? v : v ? new Date(v) : null);
  const from = asDate(opts.from);
  const to = asDate(opts.to);
  if (from) parts.push(where("createdAt", ">=", Timestamp.fromDate(from)));
  if (to) parts.push(where("createdAt", "<=", Timestamp.fromDate(to)));

  const ord = typeof opts.orderBy === "string" ? { field: opts.orderBy } : opts.orderBy;
  if (ord?.field) parts.push(orderBy(ord.field, ord.dir === "asc" ? "asc" : "desc"));
  else if (from || to) parts.push(orderBy("createdAt", "desc"));

  // Firestore has no OFFSET; the activity log is the only screen that pages,
  // so read one page further and drop what has already been shown.
  const skip = Math.max(0, toNum(opts.offset));
  if (opts.limit) parts.push(limit(toNum(opts.limit) + skip));

  const snap = await getDocs(query(col(name), ...parts));
  const rows = snap.docs.map(fromSnap);
  return skip ? rows.slice(skip) : rows;
}

/**
 * Watch a whole collection and call back on every change - the first call
 * comes from the on-device cache, so the list is on screen instantly and
 * only what actually changed is fetched afterwards.
 * Returns the unsubscribe function.
 */
export function watchDocs(name, onData, onError) {
  return onSnapshot(col(name),
    (snap) => onData(snap.docs.map(fromSnap), snap.metadata.fromCache),
    (e) => { if (onError) onError(e); });
}

/** The same, for the single business-settings document. */
export function watchSettings(onData, onError) {
  return onSnapshot(BUSINESS_DOC(),
    (snap) => onData({ ...DEFAULT_SETTINGS, ...(snap.exists() ? plain(snap.data()) : {}), _configured: snap.exists() }),
    (e) => { if (onError) onError(e); });
}

/** One record, or null when it is not there. */
export async function getDocById(name, id) {
  const snap = await getDoc(ref(name, id));
  return snap.exists() ? fromSnap(snap) : null;
}

/** Records created between two dates, newest first. */
export function queryRange(name, from, to, extraWhere = []) {
  return listDocs(name, { from, to, where: extraWhere, orderBy: { field: "createdAt", dir: "desc" } });
}

/** The newest `n` records. */
export function recent(name, n = 10, extraWhere = []) {
  return listDocs(name, { where: extraWhere, orderBy: { field: "createdAt", dir: "desc" }, limit: n });
}

/* ============================================================
   Writing
   ============================================================ */
export async function createDoc(name, data) {
  const r = newRef(name);
  await settle(setDoc(r, { ...prep(data), id: r.id, ...stamps(), updatedAt: serverTimestamp() }));
  changed(name);
  return r.id;
}

export async function updateDocById(name, id, data) {
  await settle(updateDoc(ref(name, id), { ...prep(data), updatedAt: serverTimestamp() }));
  changed(name);
}

export async function removeDoc(name, id) {
  await settle(deleteDoc(ref(name, id)));
  changed(name);
}

/* ============================================================
   Offline-tolerant commits
   ------------------------------------------------------------
   A Firestore write promise settles when the SERVER acknowledges
   it, so awaiting one with no network would hang the till. The
   write is already applied to the on-device cache by then, so we
   wait only briefly and let the SDK replay it in the background.
   ============================================================ */
const pending = new Set();

function settle(promise, ms = 6000) {
  const tracked = promise.catch((e) => { console.error("write failed", e); throw e; });
  pending.add(tracked);
  const drop = () => pending.delete(tracked);
  tracked.then(drop, drop);

  if (!navigator.onLine) return Promise.resolve(null);      // queued on the device
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve(null); } }, ms);
    tracked.then(
      (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
      (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } }
    );
  });
}

/** How many writes are still waiting for the server to acknowledge them. */
export const pendingBills = () => pending.size;

/** Wait for whatever is queued. Firestore retries by itself; this only reports. */
export async function flushOutbox() {
  const n = pending.size;
  if (!n || !navigator.onLine) return 0;
  await Promise.allSettled([...pending]);
  return n - pending.size;
}

window.addEventListener("online", () => { flushOutbox().catch(() => {}); });

/* ============================================================
   Staff accounts
   ------------------------------------------------------------
   Firebase Auth has no client-side "create a user for someone
   else", so a second, throwaway app instance is signed in as the
   new account just long enough to mint it. The owner's own
   session on the main instance is never touched.
   ============================================================ */
let worker = null;
function workerAuth() {
  if (!worker) worker = AU.getAuth(A.initializeApp(firebaseConfig, "demo-staff-worker"));
  return worker;
}

export async function listUsers() {
  const snap = await getDocs(query(col(C.users), orderBy("name")));
  return snap.docs.map((d) => ({ ...plain(d.data()), uid: d.id, id: d.id }));
}

export async function createUser({ name, email, password, role = "staff", permissions = {} }) {
  const w = workerAuth();
  const cred = await createUserWithEmailAndPassword(w, String(email).trim().toLowerCase(), password);
  const uid = cred.user.uid;
  try { await signOut(w); } catch { /* the throwaway session goes away anyway */ }

  await setDoc(ref(C.users, uid), {
    uid,
    name: String(name || "").trim(),
    email: String(email).trim().toLowerCase(),
    role,
    status: "active",
    permissions,
    createdAt: Timestamp.now(),
    updatedAt: serverTimestamp()
  });
  changed(C.users);
  return uid;
}

export async function updateUser(uid, data) {
  await updateDoc(ref(C.users, uid), { ...prep(data), updatedAt: serverTimestamp() });
  changed(C.users);
}

export async function removeUser(uid) {
  // Removes the profile, which is what the rules check on every request, so
  // the login stops working immediately. The Auth record itself is deleted
  // from the Firebase console.
  await deleteDoc(ref(C.users, uid));
  changed(C.users);
}

/** Email a staff member a link to set their own new password. */
export async function sendStaffPasswordReset(email) {
  await sendPasswordResetEmail(auth, String(email).trim());
}

/* ============================================================
   Who is doing this
   ============================================================ */
let actor = { uid: "", name: "", role: "" };
export function setActor(u) { actor = { uid: u?.uid || "", name: u?.name || "", role: u?.role || "" }; }
export const getActor = () => actor;

/**
 * Append a line to the audit trail. Fire and forget - a failed trail
 * entry must never stop a sale going through.
 * When a batch is passed the entry rides along with it.
 */
export function logActivity(action, detail = "", entity = "", entityId = "", batch = null, extra = null) {
  const r = newRef(C.activity);
  const payload = {
    action, entity, entityId, detail,
    // Money that moved is stored as a number as well as in the wording, so a
    // later recount does not have to read the sentence back.
    ...(extra || {}),
    userId: actor.uid, userName: actor.name,
    ...stamps()
  };
  if (batch) batch.set(r, payload);
  else setDoc(r, payload).catch(() => {});
  return r.id;
}

/* ============================================================
   Putting the customer dues right
   ------------------------------------------------------------
   Every customer carries a running pending amount, moved a step
   at a time as bills, collections and returns happen. A step
   that never landed - a till that was offline when the bill was
   saved, a bill written before this was counted - leaves the
   total wrong for good, because nothing ever recounts it.

   This recounts it: the pending amount is rebuilt from the only
   things that are allowed to change it.

       bills left unpaid      what was sold on credit
     - money collected        payments recorded since
     - credit-note returns    goods taken back against the dues
     + uncollected exchange   an exchange difference not yet paid

   Cancelled bills are left out, as cancelling one already takes
   its due away.
   ============================================================ */

/** The rupees a logged payment moved, from the field or from its wording. */
function loggedAmount(a) {
  const direct = toNum(a.amount);
  if (direct > 0) return direct;
  const m = String(a.detail || "").match(/₹\s*([\d,]+(?:\.\d+)?)/);
  return m ? toNum(m[1].replace(/,/g, "")) : 0;
}

export async function recalcCustomerDues() {
  // Read everything first. If any of these is refused the count would come
  // out short, and a short count writes a wrong figure, so nothing is caught
  // here - the caller is told instead.
  const [sales, returns, payments, customers] = await Promise.all([
    listDocs(C.sales, { limit: 5000 }),
    listDocs(C.returns, { limit: 2000 }),
    listDocs(C.activity, { where: [["action", "==", "PAYMENT_RECEIVED"]], limit: 5000 }),
    listDocs(C.customers, { limit: 5000 })
  ]);

  const tally = {};
  const add = (id, n) => { if (id && n) tally[id] = round2((tally[id] || 0) + n); };

  sales.forEach((s) => {
    if (s.status === "cancelled") return;
    add(s.customerId, Math.max(0, round2(toNum(s.grandTotal) - toNum(s.amountReceived))));
  });
  returns.forEach((r) => {
    if (r.mode === "credit") add(r.customerId, -toNum(r.refundAmount));
    if (r.type === "EXCHANGE" && r.collected === false) add(r.customerId, toNum(r.differenceAmount));
  });
  payments.forEach((p) => add(p.entityId, -loggedAmount(p)));

  const fixes = customers
    .map((c) => ({ id: c.id, name: c.name, was: round2(toNum(c.outstanding)), now: Math.max(0, round2(tally[c.id] || 0)) }))
    .filter((f) => Math.abs(f.now - f.was) >= 0.01);

  // A batch holds 500 writes, so a big day is sent in several.
  for (let i = 0; i < fixes.length; i += 400) {
    const batch = writeBatch(db);
    fixes.slice(i, i + 400).forEach((f) => {
      batch.update(ref(C.customers, f.id), { outstanding: f.now, updatedAt: serverTimestamp() });
    });
    await settle(batch.commit());
  }
  if (fixes.length) {
    logActivity("DUES_RECALCULATED", `${fixes.length} of ${customers.length} customers corrected`, "customer", "");
    changed(C.customers);
  }
  return {
    checked: customers.length,
    fixed: fixes.length,
    total: round2(fixes.reduce((a, f) => a + f.now, 0)),
    rows: fixes.slice(0, 20)
  };
}

/* ============================================================
   Document numbering
   ------------------------------------------------------------
   Blocks of sequence numbers are reserved from a shared counter
   document and held in localStorage, so the till can keep
   numbering bills while the network is down and two tills never
   mint the same number.
   ============================================================ */
const BLOCK_KEY = "demo.numblocks";
const BLOCK_SIZE = { invoice: 25, purchase: 5, return: 5, sku: 20 };

function readBlocks() {
  try { return JSON.parse(localStorage.getItem(BLOCK_KEY) || "{}"); } catch { return {}; }
}
function writeBlocks(b) { try { localStorage.setItem(BLOCK_KEY, JSON.stringify(b)); } catch { /* ignore */ } }

async function reserveBlock(key, count) {
  const start = await runTransaction(db, async (tx) => {
    const snap = await tx.get(COUNTER_DOC());
    const data = snap.exists() ? snap.data() : {};
    const cur = toNum(data[key], 0);
    tx.set(COUNTER_DOC(), { [key]: cur + count }, { merge: true });
    return cur + 1;
  });
  const blocks = readBlocks();
  const list = blocks[key] || [];
  for (let i = 0; i < count; i++) list.push(start + i);
  blocks[key] = list;
  writeBlocks(blocks);
  return list;
}

/** Top up every counter block; called at login and after each sale. */
export async function ensureBlocks(keys = ["invoice"]) {
  if (!navigator.onLine) return;
  for (const key of keys) {
    const have = (readBlocks()[key] || []).length;
    const size = BLOCK_SIZE[key] || 10;
    if (have <= Math.ceil(size / 3)) {
      try { await reserveBlock(key, size); } catch { /* offline or no permission - retry later */ }
    }
  }
}

/** Take the next sequence number for `key`. Throws only if offline with an empty block. */
export async function takeSequence(key) {
  let blocks = readBlocks();
  if (!(blocks[key] || []).length) {
    if (!navigator.onLine) throw new Error(`No ${key} numbers reserved for offline use. Reconnect once to continue.`);
    await reserveBlock(key, BLOCK_SIZE[key] || 10);
    blocks = readBlocks();
  }
  const list = blocks[key];
  const n = list.shift();
  blocks[key] = list; writeBlocks(blocks);
  ensureBlocks([key]);          // async top-up, no await
  return n;
}
export const peekBlockSize = (key) => (readBlocks()[key] || []).length;

export async function nextInvoiceNumber(settings) {
  return buildDocNo(settings.invoicePrefix || "INV", await takeSequence("invoice"));
}
export async function nextPurchaseNumber(settings) {
  return buildDocNo(settings.purchasePrefix || "PUR", await takeSequence("purchase"));
}
export async function nextReturnNumber(settings) {
  return buildDocNo(settings.returnPrefix || "RET", await takeSequence("return"));
}
export async function nextSkuSequence() { return takeSequence("sku"); }

/* ============================================================
   Stock movements
   ============================================================ */
/**
 * Queue a stock movement + the matching product counter change onto a batch.
 * qty is signed: negative for sales/damage, positive for purchases/returns.
 */
function queueStockChange(batch, { product, qty, type, referenceId = "", referenceNo = "", note = "" }) {
  const q = toNum(qty);
  if (!q) return;
  const prev = toNum(product.stock, 0);
  batch.update(ref(C.products, product.id), {
    stock: increment(q),
    updatedAt: serverTimestamp()
  });
  batch.set(newRef(C.stockHistory), {
    productId: product.id,
    productName: product.productName || "",
    sku: product.sku || "",
    type,                       // PURCHASE | SALE | RETURN | DAMAGE | ADJUSTMENT | OPENING | EXCHANGE
    quantity: q,
    previousStock: prev,
    newStock: round2(prev + q),
    referenceId, referenceNo, note,
    userId: actor.uid, userName: actor.name,
    ...stamps()
  });
}

/** Set the stock count, recording the difference as a movement. */
export async function adjustStock(product, newQty, type = "ADJUSTMENT", note = "") {
  const delta = round2(toNum(newQty) - toNum(product.stock));
  if (!delta) return;
  const batch = writeBatch(db);
  queueStockChange(batch, { product, qty: delta, type, note });
  logActivity("STOCK_ADJUSTED", `${product.sku || product.id} ${toNum(product.stock)} → ${toNum(newQty)}`, "product", product.id, batch);
  await settle(batch.commit());
  changed(C.products);
}

/** Add (or with a negative qty, remove) stock. */
export async function addStock(product, qty, type = "PURCHASE", note = "") {
  if (!toNum(qty)) return;
  const batch = writeBatch(db);
  queueStockChange(batch, { product, qty: toNum(qty), type, note });
  await settle(batch.commit());
  changed(C.products);
}

/* ============================================================
   Cost prices (owner only)
   ------------------------------------------------------------
   Kept apart from the product so the rules can hide them from
   staff completely. A staff device asking for these gets
   permission-denied, which store.js treats as "no costs".
   ============================================================ */
export async function listCosts() {
  const snap = await getDocs(col(C.productCosts));
  return snap.docs.map(fromSnap);
}

export async function saveCost(productId, { purchasePrice, supplierId = "", supplierName = "" }) {
  await setDoc(ref(C.productCosts, productId), {
    productId,
    purchasePrice: toNum(purchasePrice),
    supplierId, supplierName,
    updatedAt: serverTimestamp()
  }, { merge: true });
  changed(C.productCosts);
}

export async function removeCost(productId) {
  await deleteDoc(ref(C.productCosts, productId)).catch(() => {});
  changed(C.productCosts);
}

/* ============================================================
   Sales
   ============================================================ */
/**
 * @param sale  full sale payload (already priced by computeBill)
 * @param items cart lines, each carrying a `product` snapshot object
 */
export async function createSale(sale, items) {
  const batch = writeBatch(db);
  const saleRef = newRef(C.sales);

  batch.set(saleRef, {
    ...prep(sale),
    id: saleRef.id,
    status: "active",
    ...stamps()
  });

  items.forEach((it) => {
    const product = it.product;
    if (!product || product.nonStock || it.nonStock) return;
    queueStockChange(batch, {
      product, qty: -Math.abs(toNum(it.qty)),
      type: "SALE", referenceId: saleRef.id, referenceNo: sale.invoiceNumber
    });
  });

  if (sale.customerId) {
    const due = round2(toNum(sale.grandTotal) - toNum(sale.amountReceived));
    batch.update(ref(C.customers, sale.customerId), {
      totalPurchases: increment(toNum(sale.grandTotal)),
      outstanding: increment(due > 0 ? due : 0),
      lastPurchaseAt: Timestamp.now(),
      updatedAt: serverTimestamp()
    });
  }
  logActivity("BILL_CREATED", `${sale.invoiceNumber} · ₹${sale.grandTotal}`, "sale", saleRef.id, batch);

  const acked = await settle(batch.commit());
  changed(C.sales);
  changed(C.products);
  if (sale.customerId) changed(C.customers);
  // A null ack means the bill is on the device and waiting to sync; it still
  // has its id and its number, so it can be printed right away.
  return acked === null && !navigator.onLine ? null : saleRef.id;
}

export async function cancelSale(sale, reason = "") {
  const batch = writeBatch(db);
  batch.update(ref(C.sales, sale.id), {
    status: "cancelled", cancelReason: reason,
    cancelledBy: actor.uid, cancelledByName: actor.name,
    cancelledAt: Timestamp.now(), updatedAt: serverTimestamp()
  });
  (sale.items || []).forEach((it) => {
    if (!it.productId || it.nonStock) return;
    queueStockChange(batch, {
      product: { id: it.productId, productName: it.productName, sku: it.sku, stock: it.stockAfter ?? 0 },
      qty: Math.abs(toNum(it.qty)), type: "RETURN",
      referenceId: sale.id, referenceNo: sale.invoiceNumber, note: "Bill cancelled"
    });
  });
  if (sale.customerId) {
    const due = round2(toNum(sale.grandTotal) - toNum(sale.amountReceived));
    batch.update(ref(C.customers, sale.customerId), {
      totalPurchases: increment(-toNum(sale.grandTotal)),
      outstanding: increment(due > 0 ? -due : 0),
      updatedAt: serverTimestamp()
    });
  }
  logActivity("BILL_CANCELLED", `${sale.invoiceNumber} · ${reason}`, "sale", sale.id, batch);
  await settle(batch.commit());
  changed(C.sales);
  changed(C.products);
  if (sale.customerId) changed(C.customers);
}

/* ============================================================
   Purchases  (owner only - they carry the buying rate)
   ============================================================ */
export async function createPurchase(purchase, items) {
  const batch = writeBatch(db);
  const pRef = newRef(C.purchases);
  batch.set(pRef, { ...prep(purchase), id: pRef.id, status: "active", ...stamps() });

  items.forEach((it) => {
    const product = it.product;
    if (!product) return;
    queueStockChange(batch, {
      product, qty: Math.abs(toNum(it.qty)),
      type: "PURCHASE", referenceId: pRef.id, referenceNo: purchase.purchaseNumber
    });
    // Keep the latest landed cost, in the owner-only collection.
    const cost = toNum(it.rate);
    if (cost > 0) {
      batch.set(ref(C.productCosts, product.id), {
        productId: product.id,
        purchasePrice: cost,
        supplierId: purchase.supplierId || "",
        supplierName: purchase.supplierName || "",
        updatedAt: serverTimestamp()
      }, { merge: true });
    }
  });

  if (purchase.supplierId) {
    const due = round2(toNum(purchase.grandTotal) - toNum(purchase.amountPaid));
    batch.update(ref(C.suppliers, purchase.supplierId), {
      totalPurchases: increment(toNum(purchase.grandTotal)),
      outstanding: increment(due > 0 ? due : 0),
      updatedAt: serverTimestamp()
    });
  }
  logActivity("PURCHASE_CREATED", `${purchase.purchaseNumber} · ₹${purchase.grandTotal}`, "purchase", pRef.id, batch);

  await settle(batch.commit());
  changed(C.purchases);
  changed(C.products);
  changed(C.productCosts);
  if (purchase.supplierId) changed(C.suppliers);
  return pRef.id;
}

/* ============================================================
   Returns & exchanges
   ============================================================ */
export async function createReturn(payload, returnedItems, newItems = []) {
  const batch = writeBatch(db);
  const rRef = newRef(C.returns);
  batch.set(rRef, { ...prep(payload), id: rRef.id, ...stamps() });

  returnedItems.forEach((it) => {
    if (!it.product) return;
    queueStockChange(batch, {
      product: it.product, qty: Math.abs(toNum(it.qty)),
      type: payload.type === "EXCHANGE" ? "EXCHANGE" : "RETURN",
      referenceId: rRef.id, referenceNo: payload.returnNumber, note: payload.reason || ""
    });
  });
  newItems.forEach((it) => {
    if (!it.product) return;
    queueStockChange(batch, {
      product: it.product, qty: -Math.abs(toNum(it.qty)),
      type: "EXCHANGE", referenceId: rRef.id, referenceNo: payload.returnNumber, note: "Exchange issue"
    });
  });

  if (payload.saleId) {
    batch.update(ref(C.sales, payload.saleId), {
      hasReturn: true,
      returnedAmount: increment(toNum(payload.returnValue)),
      updatedAt: serverTimestamp()
    });
  }
  if (payload.customerId) {
    if (payload.mode === "credit") {
      batch.update(ref(C.customers, payload.customerId), {
        outstanding: increment(-toNum(payload.refundAmount)),
        updatedAt: serverTimestamp()
      });
    }
    if (payload.type === "EXCHANGE" && toNum(payload.differenceAmount) > 0 && payload.collected === false) {
      batch.update(ref(C.customers, payload.customerId), {
        outstanding: increment(toNum(payload.differenceAmount)),
        updatedAt: serverTimestamp()
      });
    }
  }
  logActivity(payload.type === "EXCHANGE" ? "EXCHANGE_CREATED" : "RETURN_CREATED",
    `${payload.returnNumber} · ${payload.invoiceNumber || ""}`, "return", rRef.id, batch);

  await settle(batch.commit());
  changed(C.returns);
  changed(C.products);
  changed(C.sales);
  if (payload.customerId) changed(C.customers);
  return rRef.id;
}

/* ============================================================
   Image upload
   ------------------------------------------------------------
   folder is "business" for the shop logo, or "products/<id>" for
   a product photo - the two paths storage.rules allows.
   ============================================================ */
export async function uploadImage(file, folder = "business") {
  const safe = String(file.name || "image").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-40);
  const path = `${folder}/${Date.now()}-${safe}`;
  const r = ST.ref(storage, path);
  await ST.uploadBytes(r, file, { contentType: file.type });
  return ST.getDownloadURL(r);
}
