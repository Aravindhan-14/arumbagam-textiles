/* ============================================================
   demo SAREES - Bluetooth 2D scanner (HID / keyboard-wedge)
   ------------------------------------------------------------
   A Bluetooth scanner paired in HID mode behaves like a keyboard:
   it "types" the code very fast and finishes with Enter.  We watch
   the keystroke timing to tell a scan apart from a human typing,
   so the code is captured no matter which field has focus.
   ============================================================ */

const MAX_GAP_MS = 60;      // a human rarely types faster than this
const MIN_LENGTH = 3;
const RESET_MS = 300;

let buffer = "";
let lastKey = 0;
let fastKeys = 0;
let enabled = true;
let lastScanAt = 0;
const handlers = new Set();

function flush(code) {
  buffer = ""; fastKeys = 0;
  if (!code || code.length < MIN_LENGTH) return;
  lastScanAt = Date.now();
  handlers.forEach((h) => { try { h(code); } catch (e) { console.error(e); } });
}

function onKeyDown(e) {
  if (!enabled) return;
  const now = Date.now();
  const gap = now - lastKey;
  lastKey = now;
  if (gap > RESET_MS) { buffer = ""; fastKeys = 0; }

  if (e.key === "Enter") {
    const looksScanned = buffer.length >= MIN_LENGTH && fastKeys >= Math.max(2, buffer.length - 2);
    if (looksScanned) {
      const target = e.target;
      const isScanField = target && target.dataset && target.dataset.scanField === "true";
      if (!isScanField) e.preventDefault();
      const code = buffer;
      flush(code);
      // Clear the code out of whatever field swallowed it, unless that field wants it.
      if (target && !isScanField && "value" in target && String(target.value).endsWith(code)) {
        target.value = String(target.value).slice(0, -code.length);
      }
    } else { buffer = ""; fastKeys = 0; }
    return;
  }

  if (e.key.length === 1) {
    buffer += e.key;
    if (gap <= MAX_GAP_MS) fastKeys++;
    if (buffer.length > 64) buffer = buffer.slice(-64);
  } else if (e.key !== "Shift" && e.key !== "Control" && e.key !== "Alt" && e.key !== "Meta") {
    buffer = ""; fastKeys = 0;
  }
}

document.addEventListener("keydown", onKeyDown, true);

/* ---------- public API ---------- */

/** Subscribe to scans. Returns an unsubscribe function. */
export function onScan(handler) {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/** Temporarily switch the wedge off (e.g. while typing a long description). */
export function setScannerEnabled(v) { enabled = !!v; }
export const isScannerEnabled = () => enabled;

/** Feed a code in manually - used by the on-screen keypad and camera fallback. */
export function emitScan(code) { flush(String(code || "").trim()); }

/** "Connected" is inferred: a scanner that has fired in this session is live. */
export function scannerSeen() { return lastScanAt > 0; }
export function lastScanAge() { return lastScanAt ? Date.now() - lastScanAt : Infinity; }
export function scannerStatus() {
  if (!lastScanAt) return { ok: false, text: "No scan detected yet" };
  const mins = Math.round(lastScanAge() / 60000);
  return { ok: true, text: mins < 1 ? "Active - last scan just now" : `Active - last scan ${mins}m ago` };
}
