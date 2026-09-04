/* ============================================================
   VYRA SAREES - Firebase bootstrap + data access layer
   ------------------------------------------------------------
   Writes use batched writes with FieldValue.increment() so that
   billing keeps working while the phone is offline; Firestore
   replays the queue when connectivity returns.  Document numbers
   (invoice / purchase / return) are drawn from a block reserved
   ahead of time, so two devices can never mint the same number.
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

export const db = FS.initializeFirestore(app, {
  localCache: FS.persistentLocalCache({ tabManager: FS.persistentMultipleTabManager() })
});

/* Re-export the SDK pieces the rest of the app needs. */
export const {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, startAfter, onSnapshot, writeBatch, runTransaction,
  serverTimestamp, increment, Timestamp, documentId
} = FS;
export const {
  signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail,
  createUserWithEmailAndPassword, updatePassword, EmailAuthProvider, reauthenticateWithCredential
} = AU;
export const { ref: storageRef, uploadBytes, getDownloadURL, deleteObject } = ST;

/* ---------- collection shortcuts ---------- */
export const C = {
  users: "users",
  products: "products",
  categories: "categories",
  variants: "product_variants",
  customers: "customers",
  suppliers: "suppliers",
  sales: "sales",
  purchases: "purchases",
  returns: "returns",
  stockHistory: "stock_history",
  activity: "activity_log",
  settings: "settings"
};
export const col = (name) => collection(db, name);
export const ref = (name, id) => doc(db, name, id);
export const newRef = (name) => doc(collection(db, name));

/* ---------- settings ---------- */
export const BUSINESS_DOC = doc(db, C.settings, "business");
export const COUNTER_DOC = doc(db, C.settings, "counters");

export const DEFAULT_SETTINGS = {
  businessName: "VYRA SAREES",
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
  footerMessage: "Thank You for Shopping with VYRA SAREES\nVisit Again",
  labelWidthMm: 50,
  labelHeightMm: 25
};

export async function loadSettings() {
  const snap = await getDoc(BUSINESS_DOC);
  // _configured is false on a brand-new project; saving settings closes the
  // one-time bootstrap window in the security rules.
  return { ...DEFAULT_SETTINGS, ...(snap.exists() ? snap.data() : {}), _configured: snap.exists() };
}
export async function saveSettings(patch) {
  await setDoc(BUSINESS_DOC, { ...patch, updatedAt: serverTimestamp() }, { merge: true });
}

/* ============================================================
   Document numbering - reserve blocks so offline bills are safe
   ============================================================ */
const BLOCK_KEY = "vyra.numblocks";
const BLOCK_SIZE = { invoice: 25, purchase: 5, return: 5, sku: 20 };

function readBlocks() {
  try { return JSON.parse(localStorage.getItem(BLOCK_KEY) || "{}"); } catch { return {}; }
}
function writeBlocks(b) { try { localStorage.setItem(BLOCK_KEY, JSON.stringify(b)); } catch { /* ignore */ } }

/** Reserve `count` sequence values for `key` from the shared counter document. */
async function reserveBlock(key, count) {
  const start = await runTransaction(db, async (tx) => {
    const snap = await tx.get(COUNTER_DOC);
    const data = snap.exists() ? snap.data() : {};
    const cur = toNum(data[key], 0);
    tx.set(COUNTER_DOC, { [key]: cur + count }, { merge: true });
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
    const blocks = readBlocks();
    const have = (blocks[key] || []).length;
    const size = BLOCK_SIZE[key] || 10;
    if (have <= Math.ceil(size / 3)) {
      try { await reserveBlock(key, size); } catch { /* offline / rules - retry later */ }
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
   Activity log + stock history
   ============================================================ */
let actor = { uid: "", name: "", role: "" };
export function setActor(u) { actor = { uid: u?.uid || "", name: u?.name || "", role: u?.role || "" }; }
export const getActor = () => actor;

export function logActivity(batch, action, detail, entity = "", entityId = "") {
  const r = newRef(C.activity);
  const payload = {
    action, entity, entityId, detail,
    userId: actor.uid, userName: actor.name,
    createdAt: serverTimestamp(), dayKey: dayKey()
  };
  if (batch) batch.set(r, payload); else setDoc(r, payload).catch(() => {});
  return r.id;
}

/**
 * Queue a stock movement + the matching product counter change onto a batch.
 * qty is signed: negative for sales/damage, positive for purchases/returns.
 */
export function queueStockChange(batch, { product, qty, type, referenceId = "", referenceNo = "", note = "" }) {
  const q = Number(qty);
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
    type,                                    // PURCHASE | SALE | RETURN | DAMAGE | ADJUSTMENT | OPENING | EXCHANGE
    quantity: q,
    previousStock: prev,
    newStock: round2(prev + q),
    referenceId, referenceNo, note,
    userId: actor.uid, userName: actor.name,
    createdAt: serverTimestamp(), dayKey: dayKey()
  });
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
    ...sale,
    id: saleRef.id,
    status: "active",
    createdAt: serverTimestamp(),
    dayKey: dayKey(),
    createdAtLocal: Date.now()
  });

  items.forEach((it) => {
    if (!it.product || it.product.nonStock) return;
    queueStockChange(batch, {
      product: it.product, qty: -Math.abs(toNum(it.qty)),
      type: "SALE", referenceId: saleRef.id, referenceNo: sale.invoiceNumber
    });
  });

  if (sale.customerId) {
    const due = round2(toNum(sale.grandTotal) - toNum(sale.amountReceived));
    batch.update(ref(C.customers, sale.customerId), {
      totalPurchases: increment(toNum(sale.grandTotal)),
      outstanding: increment(due > 0 ? due : 0),
      lastPurchaseAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
  logActivity(batch, "BILL_CREATED", `${sale.invoiceNumber} · ₹${sale.grandTotal}`, "sale", saleRef.id);

  await batch.commit();
  return saleRef.id;
}

export async function cancelSale(sale, reason = "") {
  const batch = writeBatch(db);
  batch.update(ref(C.sales, sale.id), {
    status: "cancelled", cancelReason: reason,
    cancelledBy: actor.uid, cancelledByName: actor.name, cancelledAt: serverTimestamp()
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
      outstanding: increment(due > 0 ? -due : 0)
    });
  }
  logActivity(batch, "BILL_CANCELLED", `${sale.invoiceNumber} · ${reason}`, "sale", sale.id);
  await batch.commit();
}

/* ============================================================
   Purchases
   ============================================================ */
export async function createPurchase(purchase, items) {
  const batch = writeBatch(db);
  const pRef = newRef(C.purchases);
  batch.set(pRef, { ...purchase, id: pRef.id, status: "active", createdAt: serverTimestamp(), dayKey: dayKey() });

  items.forEach((it) => {
    if (!it.product) return;
    queueStockChange(batch, {
      product: it.product, qty: Math.abs(toNum(it.qty)),
      type: "PURCHASE", referenceId: pRef.id, referenceNo: purchase.purchaseNumber
    });
    // keep the latest landed cost on the product
    const cost = toNum(it.rate);
    if (cost > 0) batch.update(ref(C.products, it.product.id), { purchasePrice: cost });
  });

  if (purchase.supplierId) {
    const due = round2(toNum(purchase.grandTotal) - toNum(purchase.amountPaid));
    batch.update(ref(C.suppliers, purchase.supplierId), {
      totalPurchases: increment(toNum(purchase.grandTotal)),
      outstanding: increment(due > 0 ? due : 0),
      updatedAt: serverTimestamp()
    });
  }
  logActivity(batch, "PURCHASE_CREATED", `${purchase.purchaseNumber} · ₹${purchase.grandTotal}`, "purchase", pRef.id);
  await batch.commit();
  return pRef.id;
}

/* ============================================================
   Returns & exchanges
   ============================================================ */
export async function createReturn(payload, returnedItems, newItems = []) {
  const batch = writeBatch(db);
  const rRef = newRef(C.returns);
  batch.set(rRef, { ...payload, id: rRef.id, createdAt: serverTimestamp(), dayKey: dayKey() });

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
      hasReturn: true, returnedAmount: increment(toNum(payload.returnValue)), updatedAt: serverTimestamp()
    });
  }
  if (payload.customerId) {
    if (payload.mode === "credit") {
      batch.update(ref(C.customers, payload.customerId), { outstanding: increment(-toNum(payload.refundAmount)) });
    }
    if (payload.type === "EXCHANGE" && toNum(payload.differenceAmount) > 0 && payload.collected === false) {
      batch.update(ref(C.customers, payload.customerId), { outstanding: increment(toNum(payload.differenceAmount)) });
    }
  }
  logActivity(batch, payload.type === "EXCHANGE" ? "EXCHANGE_CREATED" : "RETURN_CREATED",
    `${payload.returnNumber} · ${payload.invoiceNumber || ""}`, "return", rRef.id);
  await batch.commit();
  return rRef.id;
}

/* ============================================================
   Manual stock adjustment
   ============================================================ */
export async function adjustStock(product, newQty, type = "ADJUSTMENT", note = "") {
  const delta = round2(toNum(newQty) - toNum(product.stock));
  if (!delta) return;
  const batch = writeBatch(db);
  queueStockChange(batch, { product, qty: delta, type, note });
  logActivity(batch, "STOCK_ADJUSTED", `${product.sku} ${product.stock} → ${newQty}`, "product", product.id);
  await batch.commit();
}

export async function addStock(product, qty, type = "PURCHASE", note = "") {
  const batch = writeBatch(db);
  queueStockChange(batch, { product, qty: toNum(qty), type, note });
  await batch.commit();
}

/* ============================================================
   Generic CRUD helpers
   ============================================================ */
export async function createDoc(collectionName, data) {
  const r = newRef(collectionName);
  await setDoc(r, { ...data, id: r.id, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return r.id;
}
export async function updateDocById(collectionName, id, data) {
  await updateDoc(ref(collectionName, id), { ...data, updatedAt: serverTimestamp() });
}
export async function removeDoc(collectionName, id) { await deleteDoc(ref(collectionName, id)); }

/* ---------- range queries ---------- */
export async function queryRange(collectionName, from, to, extra = []) {
  const q = query(
    col(collectionName),
    where("createdAt", ">=", Timestamp.fromDate(from)),
    where("createdAt", "<=", Timestamp.fromDate(to)),
    ...extra,
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export async function recent(collectionName, n = 10, extra = []) {
  const snap = await getDocs(query(col(collectionName), ...extra, orderBy("createdAt", "desc"), limit(n)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/* ---------- image upload ---------- */
export async function uploadImage(file, path) {
  const r = storageRef(storage, path);
  await uploadBytes(r, file, { contentType: file.type });
  return getDownloadURL(r);
}
