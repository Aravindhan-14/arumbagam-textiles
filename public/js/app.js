/* ============================================================
   demo SAREES - application shell, router and hardware panel
   ============================================================ */
import { watchAuth, login, logout, authMessage, startSession, resetPassword } from "./auth.js";
import { state, on, can, isAdmin } from "./store.js";
import { icon, toast, ok, err, warn, openSheet, confirmDialog, busy, closeTopSheet, sheetsOpen } from "./ui.js";
import { onScan, scannerStatus, emitScan } from "./hw/scanner.js";
import {
  detectPrinters, printers, printerStatus, setPrinterMode, printerMode, setPaperWidth,
  receiptPrinter, labelPrinter, setReceiptPrinter, setLabelPrinter,
  rawReceipts, setRawReceipts, bridgeReady
} from "./hw/printer.js";
import { newReceiptDoc, sendDoc } from "./hw/documents.js";
import { esc, toNum } from "./utils.js";
import { peekBlockSize, pendingBills, flushOutbox } from "./db.js";

/* ============================================================
   Navigation model
   ============================================================ */
const NAV = [
  { id: "dashboard", label: "Dashboard", ic: "dashboard", tab: true },
  { id: "products",  label: "Products",  ic: "box",   tab: true, perm: "products.view" },
  { id: "scan",      label: "Scan",      ic: "scan",  tab: "fab" },
  { id: "billing",   label: "Billing",   ic: "bill",  tab: true, perm: "sales.create" },
  { id: "sales",     label: "Sales",     ic: "rupee", tab: true },

  { sep: "Inventory" },
  { id: "inventory", label: "Stock & Adjustments", ic: "stack", perm: "inventory.view" },
  { id: "categories", label: "Categories", ic: "tag", perm: "categories.manage" },
  { id: "labels",    label: "QR / Barcode Labels", ic: "qr", perm: "labels.print" },
  { id: "purchases", label: "Purchases", ic: "cart", perm: "purchases.manage" },
  { id: "suppliers", label: "Suppliers", ic: "truck", perm: "suppliers.manage" },

  { sep: "People" },
  { id: "customers", label: "Customers", ic: "users", perm: "customers.view" },
  { id: "returns",   label: "Returns & Exchange", ic: "ret", perm: "returns.create" },

  { sep: "Business" },
  { id: "reports",   label: "Reports",  ic: "chart", perm: "reports.view" },
  { id: "staff",     label: "Staff",    ic: "user", perm: "staff.manage" },
  { id: "activity",  label: "Activity Log", ic: "clock", perm: "staff.manage" },
  { id: "settings",  label: "Settings", ic: "gear" }
];

const PAGES = {
  dashboard: () => import("./pages/dashboard.js"),
  products:  () => import("./pages/products.js"),
  categories:() => import("./pages/categories.js"),
  scan:      () => import("./pages/scan.js"),
  billing:   () => import("./pages/billing.js"),
  sales:     () => import("./pages/sales.js"),
  inventory: () => import("./pages/inventory.js"),
  labels:    () => import("./pages/labels.js"),
  purchases: () => import("./pages/purchases.js"),
  suppliers: () => import("./pages/suppliers.js"),
  customers: () => import("./pages/customers.js"),
  returns:   () => import("./pages/returns.js"),
  reports:   () => import("./pages/reports.js"),
  staff:     () => import("./pages/staff.js"),
  activity:  () => import("./pages/activity.js"),
  settings:  () => import("./pages/settings.js")
};

const allowed = (item) => !item.perm || can(item.perm);

/* ============================================================
   Router
   ============================================================ */
let currentCleanup = null;
let pageScanHandler = null;

/** Pages call this to receive scans while they are mounted. */
export function setScanHandler(fn) { pageScanHandler = fn; }

export function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function parseHash() {
  const raw = (location.hash || "#/dashboard").slice(2);
  const [path, qs] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  return {
    page: parts[0] || "dashboard",
    sub: parts.slice(1),
    params: Object.fromEntries(new URLSearchParams(qs || ""))
  };
}

async function route() {
  const { page, sub, params } = parseHash();
  const view = document.getElementById("view");

  if (typeof currentCleanup === "function") { try { currentCleanup(); } catch {} }
  currentCleanup = null;
  pageScanHandler = null;
  closeDrawer();

  const item = NAV.find((n) => n.id === page);
  if (item && !allowed(item)) { warn("You do not have permission to open that section."); go("#/dashboard"); return; }

  const loader = PAGES[page] || PAGES.dashboard;
  view.innerHTML = `<div class="empty">${icon("clock")}<b>Loading…</b></div>`;
  window.scrollTo(0, 0);

  try {
    const mod = await loader();
    const res = await mod.mount(view, { sub, params, go });
    if (typeof res === "function") currentCleanup = res;
    else if (res && typeof res.cleanup === "function") currentCleanup = res.cleanup;
    setTitle(mod.title || item?.label || "demo SAREES", (res && res.sub) || mod.subtitle || "");
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="empty">${icon("alert")}<b>Could not open this page</b><small>${esc(e.message || "")}</small></div>`;
    setTitle("Error", "");
  }
  paintNavActive(page);
}

function setTitle(t, s) {
  document.getElementById("page-title").textContent = t;
  document.getElementById("page-sub").textContent = s || state.settings?.businessName || "demo SAREES";
}

/* ============================================================
   Chrome: drawer, tab bar
   ============================================================ */
function buildNav() {
  const drawer = document.getElementById("drawer-nav");
  drawer.innerHTML = NAV.map((n) => {
    if (n.sep) return `<div class="navsep">${esc(n.sep)}</div>`;
    if (!allowed(n)) return "";
    return `<a href="#/${n.id}" data-nav="${n.id}">${icon(n.ic)}<span>${esc(n.label)}</span></a>`;
  }).join("");

  const tabs = NAV.filter((n) => n.tab && allowed(n));
  document.getElementById("tabbar").innerHTML = tabs.map((n) =>
    n.tab === "fab"
      ? `<a href="#/${n.id}" class="fab" data-tab="${n.id}"><span class="fab-in">${icon(n.ic)}</span></a>`
      : `<a href="#/${n.id}" data-tab="${n.id}">${icon(n.ic)}<span>${esc(n.label)}</span></a>`
  ).join("");
}

function paintNavActive(page) {
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === page));
  document.querySelectorAll("[data-tab]").forEach((a) => a.classList.toggle("active", a.dataset.tab === page));
}

const drawerEl = () => document.getElementById("drawer");
function openDrawer() { drawerEl().classList.add("open"); document.getElementById("scrim").classList.add("on"); }
function closeDrawer() { drawerEl().classList.remove("open"); document.getElementById("scrim").classList.remove("on"); }

/* ============================================================
   Hardware panel
   ============================================================ */
function printerOptions(selected) {
  const list = printers();
  if (!list.length) return `<option value="">No printer found</option>`;
  return list.map((p) => `<option value="${esc(p.name)}" ${p.name === selected ? "selected" : ""}>
      ${esc(p.name)}${p.default ? " (default)" : ""}${p.offline ? " · offline" : ""}</option>`).join("");
}

function hardwareSheet() {
  const render = (api) => {
    const pr = printerStatus();
    const sc = scannerStatus();
    const wired = bridgeReady();
    api.setBody(`
      <div class="card">
        <div class="card-head"><h3>${icon("print")} Printer (USB)</h3>
          <span class="pill ${pr.ok ? "ok" : "warn"}">${pr.ok ? "Ready" : "Offline"}</span></div>
        <p class="small muted mb">${esc(pr.text)}</p>
        <label class="field"><span>Print mode</span>
          <select id="hw-mode">
            <option value="auto">Automatic</option>
            <option value="wired">Wired printer (no dialog)</option>
            <option value="browser">Browser print / PDF</option>
          </select></label>
        <label class="field"><span>Bills print on</span>
          <select id="hw-receipt" ${wired ? "" : "disabled"}>${printerOptions(receiptPrinter())}</select></label>
        <label class="field"><span>Labels print on</span>
          <select id="hw-label" ${wired ? "" : "disabled"}>${printerOptions(labelPrinter())}</select></label>
        <label class="field"><span>Bill paper width</span>
          <select id="hw-width">
            <option value="58">58 mm</option><option value="80">80 mm</option>
            <option value="100">100 mm (4 inch roll)</option>
          </select></label>
        <label class="check"><input type="checkbox" id="hw-raw" ${rawReceipts() ? "checked" : ""}>
          <span>Send bills as raw ESC/POS (receipt printers only)</span></label>
        <div class="btn-row">
          <button class="btn btn-primary" id="hw-connect">${icon("print")} Find printers</button>
          <button class="btn btn-soft" id="hw-test">Test print</button>
        </div>
        ${wired ? "" : `<p class="form-note mt">Wired printing needs the app opened on the billing PC, from the window that <b>START demo SAREES</b> starts. Plug the printer in by USB, install its Windows driver, then tap <b>Find printers</b>.</p>`}
      </div>

      <div class="card">
        <div class="card-head"><h3>${icon("scan")} Barcode Scanner</h3>
          <span class="pill ${sc.ok ? "ok" : "mut"}">${sc.ok ? "Active" : "Waiting"}</span></div>
        <p class="small muted mb">${esc(sc.text)}</p>
        <p class="small muted">A USB scanner works as soon as it is plugged in. A wireless one should be paired in <b>HID / Keyboard</b> mode. Scanned codes are read anywhere in the app.</p>
        <div class="btn-row mt">
          <button class="btn btn-soft" id="hw-testscan">Simulate a scan</button>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>${icon("file")} Offline readiness</h3></div>
        <div class="trow"><span>Network</span><b>${state.online ? "Online" : "Offline"}</b></div>
        <div class="trow"><span>Invoice numbers reserved</span><b>${peekBlockSize("invoice")}</b></div>
        <div class="trow"><span>Products cached</span><b>${state.products.length}</b></div>
        <div class="trow"><span>Writes waiting to sync</span><b>${pendingBills()}</b></div>
        <p class="form-note mt">Reserved invoice numbers let billing continue without a network. Bills made offline are held on this device and sent as soon as the connection returns.</p>
        ${pendingBills() ? `<button class="btn btn-soft btn-block mt" id="hw-flush">Sync now</button>` : ""}
      </div>`);

    api.root.querySelector("#hw-mode").value = printerMode();
    api.root.querySelector("#hw-width").value = String(toNum(state.settings?.printerWidth, 58));
    api.root.querySelector("#hw-mode").onchange = (e) => { setPrinterMode(e.target.value); ok("Print mode saved"); render(api); };
    api.root.querySelector("#hw-width").onchange = (e) => { setPaperWidth(e.target.value); ok("Paper width set to " + e.target.value + "mm"); };
    api.root.querySelector("#hw-receipt").onchange = (e) => { setReceiptPrinter(e.target.value); ok("Bills will print on " + e.target.value); };
    api.root.querySelector("#hw-label").onchange = (e) => { setLabelPrinter(e.target.value); ok("Labels will print on " + e.target.value); };
    api.root.querySelector("#hw-raw").onchange = (e) => { setRawReceipts(e.target.checked); ok("Saved"); };
    api.root.querySelector("#hw-connect").onclick = async () => {
      try {
        busy(true, "Looking for printers…");
        const b = await detectPrinters({ force: true });
        if (b.ok) ok(`${b.printers.length} printer${b.printers.length === 1 ? "" : "s"} found`);
        else warn(b.error);
        render(api);
      } catch (e) { err(e.message); } finally { busy(false); }
    };
    api.root.querySelector("#hw-test").onclick = async () => {
      try {
        busy(true, "Printing…");
        const p = newReceiptDoc(state.settings || {});
        p.align("center").bold(true).size(2, 2).line("demo SAREES").size(1, 1).bold(false)
          .line("Printer test").rule().align("left")
          .lr("Paper", (state.settings?.printerWidth || 58) + "mm")
          .lr("Mode", printerMode())
          .lr("Printer", receiptPrinter() || "-")
          .rule().align("center").qr("demo-SAREES-TEST", 6).feed(1).line("Test successful").cut();
        await sendDoc(p); ok("Test sent to printer");
      } catch (e) { err(e.message); } finally { busy(false); }
    };
    const flush = api.root.querySelector("#hw-flush");
    if (flush) flush.onclick = async () => {
      try {
        busy(true, "Sending…");
        const sent = await flushOutbox();
        ok(sent ? `${sent} change${sent === 1 ? "" : "s"} synced` : "Nothing could be sent yet");
        render(api);
      } catch (e) { err(e.message); } finally { busy(false); }
    };
    api.root.querySelector("#hw-testscan").onclick = async () => {
      const code = prompt("Enter a code to simulate a scan:");
      if (code) { api.close(); emitScan(code); }
    };
  };
  openSheet({ title: "Hardware", body: "", onMount: render });
}

function paintHwDot() {
  const dot = document.getElementById("hw-dot");
  if (!dot) return;
  const pr = printerStatus().ok, sc = scannerStatus().ok;
  dot.classList.toggle("on", pr && sc);
  dot.classList.toggle("half", (pr || sc) && !(pr && sc));
}

/* ============================================================
   Login screen
   ============================================================ */
function wireLogin() {
  const form = document.getElementById("login-form");
  const errBox = document.getElementById("login-error");
  const btn = document.getElementById("login-btn");

  form.onsubmit = async (e) => {
    e.preventDefault();
    errBox.classList.add("hidden");
    btn.disabled = true; btn.textContent = "Signing in…";
    try {
      const user = await login(
        document.getElementById("login-email").value,
        document.getElementById("login-password").value);
      document.getElementById("login-password").value = "";
      await startSession(user, (u) => showApp(u));
    } catch (ex) {
      errBox.textContent = authMessage(ex); errBox.classList.remove("hidden");
    } finally { btn.disabled = false; btn.textContent = "Login"; }
  };

  document.getElementById("forgot-btn").onclick = async () => {
    const email = document.getElementById("login-email").value.trim();
    errBox.classList.remove("hidden");
    if (!email) { errBox.textContent = "Type your email address first, then tap Forgot password."; return; }
    try {
      await resetPassword(email);
      errBox.textContent = `A link to set a new password has been sent to ${email}.`;
    } catch (ex) {
      errBox.textContent = authMessage(ex);
    }
  };
}

function showLogin(reason) {
  document.getElementById("boot").classList.add("hidden");
  document.getElementById("app-shell").classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
  const box = document.getElementById("login-error");
  const message =
    reason === "inactive" ? "This account is not active yet. Ask the shop owner to activate it."
      : reason === "expired" ? "Your session has ended. Please log in again."
        : typeof reason === "string" && reason.startsWith("error:") ? reason.slice(6)
          : "";
  if (message) { box.textContent = message; box.classList.remove("hidden"); }
  else box.classList.add("hidden");
}

function showApp(user) {
  document.getElementById("boot").classList.add("hidden");
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app-shell").classList.remove("hidden");
  document.getElementById("drawer-name").textContent = user.name || user.email;
  document.getElementById("drawer-role").textContent = user.role === "admin" ? "Administrator" : "Staff";
  buildNav();
  setPaperWidth(toNum(state.settings?.printerWidth, 58));
  detectPrinters();
  if (!location.hash || location.hash === "#") location.hash = "#/dashboard";
  route();
}

/* ============================================================
   Offline banner
   ============================================================ */
function paintNet(online) {
  let bar = document.getElementById("offline-bar");
  if (online) { bar?.remove(); return; }
  if (bar) return;
  bar = document.createElement("div");
  bar.id = "offline-bar"; bar.className = "offline-bar";
  bar.textContent = "Offline · billing continues and syncs when the network returns";
  document.body.appendChild(bar);
}

/* ============================================================
   Boot
   ============================================================ */
wireLogin();

document.getElementById("menu-btn").onclick = openDrawer;
document.getElementById("scrim").onclick = closeDrawer;
document.getElementById("hw-btn").onclick = hardwareSheet;
document.getElementById("scan-top-btn").onclick = () => go("#/scan");
document.getElementById("logout-btn").onclick = async () => {
  if (await confirmDialog("Log out of demo SAREES?", { okText: "Logout", danger: true })) await logout();
};

window.addEventListener("hashchange", route);
window.addEventListener("printer-status", paintHwDot);
window.addEventListener("online", () => paintNet(true));
window.addEventListener("offline", () => paintNet(false));
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sheetsOpen()) closeTopSheet(); });

on("settings", () => { setPaperWidth(toNum(state.settings?.printerWidth, 58)); });

/* Global scan routing: the mounted page wins, otherwise open the scan screen. */
onScan((code) => {
  paintHwDot();
  if (typeof pageScanHandler === "function") { pageScanHandler(code); return; }
  if (!document.getElementById("app-shell").classList.contains("hidden")) {
    go(`#/scan?code=${encodeURIComponent(code)}`);
  }
});

paintNet(navigator.onLine);
watchAuth((user, reason) => { if (user) showApp(user); else showLogin(reason); });

/* Expose a few helpers for pages that prefer the global. */
window.demo = { go, toast, ok, err, warn };
