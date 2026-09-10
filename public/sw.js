/* ============================================================
   VYRA SAREES - service worker
   ------------------------------------------------------------
   Caches the app shell so the phone opens instantly and keeps
   working through a dropped connection. Firebase traffic is
   never touched here - the Firestore SDK has its own on-device
   cache and replays writes made while offline.
   ============================================================ */
const VERSION = "vyra-v5-firebase";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./img/icon.svg",
  "./js/app.js",
  "./js/auth.js",
  "./js/firebase-config.js",
  "./js/db.js",
  "./js/store.js",
  "./js/ui.js",
  "./js/utils.js",
  "./js/codes/codes.js",
  "./js/hw/printer.js",
  "./js/hw/camera.js",
  "./js/hw/scanner.js",
  "./js/hw/documents.js",
  "./js/pages/_shared.js",
  "./js/pages/dashboard.js",
  "./js/pages/products.js",
  "./js/pages/categories.js",
  "./js/pages/scan.js",
  "./js/pages/billing.js",
  "./js/pages/sales.js",
  "./js/pages/inventory.js",
  "./js/pages/labels.js",
  "./js/pages/purchases.js",
  "./js/pages/suppliers.js",
  "./js/pages/customers.js",
  "./js/pages/returns.js",
  "./js/pages/reports.js",
  "./js/pages/staff.js",
  "./js/pages/activity.js",
  "./js/pages/settings.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Firebase looks after its own traffic: auth, Firestore's socket and the
  // image bucket must never be answered from this cache.
  if (/(^|\.)googleapis\.com$|(^|\.)firebaseio\.com$|(^|\.)firebasestorage\.app$|(^|\.)firebaseapp\.com$/.test(url.hostname)) return;

  // Navigations: network first so a new deploy is picked up quickly.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((r) => {
        const copy = r.clone();
        caches.open(VERSION).then((c) => c.put("./index.html", copy));
        return r;
      }).catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Static assets: cache first, refresh in the background.
  if (sameOrigin || /cdnjs\.cloudflare\.com|www\.gstatic\.com/.test(url.hostname)) {
    e.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req).then((r) => {
          if (r && r.status === 200) {
            const copy = r.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return r;
        }).catch(() => hit);
        return hit || net;
      })
    );
  }
});

self.addEventListener("message", (e) => {
  if (e.data === "skipWaiting") self.skipWaiting();
});
