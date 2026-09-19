/* ============================================================
   VYRA SAREES - UI primitives (toast, sheets, dialogs, icons)
   ============================================================ */
import { esc } from "./utils.js";

/* ---------- icon set ---------- */
const P = {
  dashboard: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM13 3v6h8V3zM3 21h8v-6H3z"/>',
  box: '<path d="M21 8v8a2 2 0 0 1-1 1.7l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.7l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M3 12h18"/>',
  bill: '<path d="M6 2h12a1 1 0 0 1 1 1v18l-3-2-2 2-2-2-2 2-2-2-3 2V3a1 1 0 0 1 1-1z"/><path d="M9 7h6M9 11h6M9 15h3"/>',
  stack: '<path d="M20 7 12 3 4 7l8 4zM4 12l8 4 8-4M4 17l8 4 8-4"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 7H6"/>',
  truck: '<path d="M3 16V6a1 1 0 0 1 1-1h10v11M14 9h4l3 3v4h-3"/><circle cx="7.5" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  users: '<circle cx="9" cy="8" r="3.4"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M17 11.2A3.2 3.2 0 1 0 16 5M18 20a6 6 0 0 0-2-4.4"/>',
  back: '<path d="M9 5 4 12l5 7M4 12h16"/>',
  chart: '<path d="M3 21h18M7 17V9M12 17V5M17 17v-6"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 15a2 2 0 1 1 0-4 1.6 1.6 0 0 0 1.7-2.5L4.6 8.4a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3V3a2 2 0 1 1 4 0v.1A1.6 1.6 0 0 0 16.5 4.6l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 21 10a2 2 0 1 1 0 4 1.6 1.6 0 0 0-1.6 1z"/>',
  ret: '<path d="M3 10h11a5 5 0 0 1 0 10H8"/><path d="m7 6-4 4 4 4"/>',
  tag: '<path d="M12.6 2.6 21 11a2 2 0 0 1 0 2.8l-7.2 7.2a2 2 0 0 1-2.8 0L2.6 12.6A2 2 0 0 1 2 11.2V4a2 2 0 0 1 2-2h7.2a2 2 0 0 1 1.4.6z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14h1M14 20h3M20 17v4"/>',
  print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  alert: '<path d="M12 9v5M12 17.5v.5"/><path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  download: '<path d="M12 3v12M7 11l5 5 5-5M4 21h16"/>',
  bt: '<path d="m7 7 10 10-5 5V2l5 5L7 17"/>',
  file: '<path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/>',
  rupee: '<path d="M6 3h12M6 8h12M16.5 3c0 4-3 5-6 5h-4l8 13"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
};
export const icon = (name, cls = "") =>
  `<svg viewBox="0 0 24 24" class="${cls}">${P[name] || P.box}</svg>`;

/* ---------- toast ---------- */
let toastHost;
/**
 * A screen that redraws itself on every keystroke throws away the very box
 * being typed into, and the cursor goes with it - on a phone the keyboard
 * drops too, so only the first letter ever lands. Call this after the redraw
 * to put the cursor back at the end of that box.
 */
export function refocus(root, selector) {
  const el = root.querySelector(selector);
  if (!el || el === document.activeElement) return;
  el.focus({ preventScroll: true });
  const end = String(el.value || "").length;
  try { el.setSelectionRange(end, end); } catch { /* not a text field */ }
}

export function toast(msg, type = "", ms = 2600) {
  toastHost = toastHost || document.getElementById("toast-host");
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  toastHost.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .25s"; setTimeout(() => el.remove(), 260); }, ms);
}
export const ok = (m) => toast(m, "ok");
export const err = (m) => toast(m, "err", 3600);
export const warn = (m) => toast(m, "warn", 3200);

/* ---------- busy overlay ---------- */
let busyCount = 0;
export function busy(on, text = "Working…") {
  const el = document.getElementById("busy");
  busyCount = Math.max(0, busyCount + (on ? 1 : -1));
  document.getElementById("busy-text").textContent = text;
  el.classList.toggle("hidden", busyCount === 0);
}
export async function withBusy(text, fn) {
  busy(true, text);
  try { return await fn(); } finally { busy(false); }
}

/* ---------- bottom sheet ---------- */
const sheetStack = [];
/**
 * openSheet({ title, body, footer, onMount, size })
 * returns { close, root }
 */
export function openSheet({ title = "", body = "", footer = "", onMount, dismissible = true } = {}) {
  const host = document.getElementById("sheet-host");
  const scrim = document.createElement("div");
  scrim.className = "sheet-scrim";
  scrim.innerHTML =
    `<div class="sheet" role="dialog" aria-modal="true">
       <div class="sheet-head">
         <h3>${esc(title)}</h3>
         <button class="x" data-close aria-label="Close">${icon("x")}</button>
       </div>
       <div class="sheet-body">${body}</div>
       ${footer ? `<div class="sheet-foot">${footer}</div>` : ""}
     </div>`;
  host.appendChild(scrim);

  const api = {
    root: scrim,
    body: scrim.querySelector(".sheet-body"),
    close() {
      const i = sheetStack.indexOf(api); if (i >= 0) sheetStack.splice(i, 1);
      scrim.remove();
    },
    setBody(html) { api.body.innerHTML = html; }
  };
  sheetStack.push(api);

  scrim.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]") || (dismissible && e.target === scrim)) api.close();
  });
  if (onMount) onMount(api);
  const f = scrim.querySelector("input:not([type=hidden]),select,textarea");
  if (f && window.matchMedia("(min-width:720px)").matches) setTimeout(() => f.focus(), 60);
  return api;
}
export function closeTopSheet() { if (sheetStack.length) sheetStack[sheetStack.length - 1].close(); }
export const sheetsOpen = () => sheetStack.length;

/* ---------- confirm / prompt ---------- */
export function confirmDialog(message, { title = "Please confirm", okText = "Confirm", danger = false } = {}) {
  return new Promise((resolve) => {
    const s = openSheet({
      title,
      body: `<p style="margin:4px 0 6px">${esc(message)}</p>`,
      footer: `<button class="btn btn-soft" data-no>Cancel</button>
               <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-yes>${esc(okText)}</button>`,
      onMount(api) {
        api.root.querySelector("[data-no]").onclick = () => { api.close(); resolve(false); };
        api.root.querySelector("[data-yes]").onclick = () => { api.close(); resolve(true); };
      }
    });
    s.root.addEventListener("click", (e) => { if (e.target === s.root) resolve(false); });
  });
}

export function promptDialog(label, { title = "Enter value", value = "", type = "text", okText = "Save", hint = "" } = {}) {
  return new Promise((resolve) => {
    openSheet({
      title,
      body: `<label class="field"><span>${esc(label)}</span>
               <input id="pd-in" type="${type}" value="${esc(value)}"></label>
             ${hint ? `<p class="form-note">${esc(hint)}</p>` : ""}`,
      footer: `<button class="btn btn-soft" data-close>Cancel</button>
               <button class="btn btn-primary" data-yes>${esc(okText)}</button>`,
      onMount(api) {
        const inp = api.root.querySelector("#pd-in");
        const done = () => { const v = inp.value; api.close(); resolve(v); };
        api.root.querySelector("[data-yes]").onclick = done;
        inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); done(); } });
        setTimeout(() => inp.focus(), 80);
        api.root.addEventListener("click", (e) => { if (e.target.closest("[data-close]") || e.target === api.root) resolve(null); });
      }
    });
  });
}

/* ---------- list / empty helpers ---------- */
export const emptyState = (title, sub = "", ic = "box") =>
  `<div class="empty">${icon(ic)}<b>${esc(title)}</b><small>${esc(sub)}</small></div>`;

export const statCard = (k, v, s = "", cls = "") =>
  `<div class="stat ${cls}"><div class="k">${esc(k)}</div><div class="v">${v}</div>${s ? `<div class="s">${esc(s)}</div>` : ""}</div>`;

export const pill = (text, cls = "mut") => `<span class="pill ${cls}">${esc(text)}</span>`;

/** Read all [name] inputs inside a container into a plain object. */
export function formData(root) {
  const out = {};
  root.querySelectorAll("[name]").forEach((el) => {
    if (el.type === "checkbox") out[el.name] = el.checked;
    else if (el.type === "radio") { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value;
  });
  return out;
}
