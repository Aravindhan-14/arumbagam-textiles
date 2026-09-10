/* ============================================================
   VYRA SAREES - Scan screen
   ------------------------------------------------------------
   Primary input is the Bluetooth HID scanner. The camera is a
   full fallback (see js/hw/camera.js) and manual entry is always
   available.
   ============================================================ */
import { state, findByCode, can } from "../store.js";
import { icon, emptyState, toast, ok, err, warn, busy } from "../ui.js";
import { esc, fileUrl, money, toNum, stockStatus } from "../utils.js";
import { setScanHandler } from "../app.js";
import { scannerStatus } from "../hw/scanner.js";
import { startCameraScanner, cameraSupport, preloadCameraDecoder } from "../hw/camera.js";
import { openProductSheet } from "./products.js";
import { pickProduct } from "./_shared.js";

export const title = "Scan Product";

export async function mount(view, { params, go }) {
  let cam = null;                 // active camera controller

  view.innerHTML = `
    <div class="card tc" id="sc-target" style="cursor:pointer">
      <div style="width:112px;height:112px;margin:6px auto 12px;border-radius:50%;
           background:var(--maroon);color:#fff;display:grid;place-items:center">
        <svg viewBox="0 0 24 24" style="width:52px;height:52px"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M3 12h18"/></svg>
      </div>
      <h3 style="margin:0 0 4px">Ready to scan</h3>
      <p class="small muted" id="sc-status">Point the Bluetooth scanner at the product tag</p>
    </div>

    <div class="searchbar">
      <div class="swrap">${icon("search")}
        <input id="sc-manual" placeholder="Or type the SKU / barcode" data-scan-field="true" autocomplete="off">
      </div>
      <button class="icon-btn" id="sc-find">${icon("check")}</button>
    </div>

    <div class="btn-row mb">
      <button class="btn btn-primary btn-sm" id="sc-cam">${icon("scan")} Scan with camera</button>
      <button class="btn btn-soft btn-sm" id="sc-browse">${icon("box")} Browse products</button>
    </div>

    <div id="sc-camwrap" class="card pad0 hidden" style="overflow:hidden">
      <div class="cam-stage">
        <video id="sc-video" playsinline muted autoplay></video>
        <div class="cam-frame"></div>
        <div class="cam-hint" id="sc-camhint">Starting camera…</div>
      </div>
      <div class="flex between" style="padding:10px 12px">
        <button class="btn btn-ghost btn-sm" id="sc-camstop">Stop camera</button>
        <div class="flex" style="gap:6px">
          <button class="btn btn-soft btn-sm hidden" id="sc-torch">Torch</button>
          <button class="btn btn-soft btn-sm" id="sc-flip">Flip</button>
        </div>
      </div>
    </div>

    <div id="sc-result"></div>
    <div class="sec-title">Recent scans</div>
    <ul class="list card pad0" id="sc-recent"></ul>`;

  const statusEl = view.querySelector("#sc-status");
  const resultEl = view.querySelector("#sc-result");
  const recentEl = view.querySelector("#sc-recent");
  const camWrap = view.querySelector("#sc-camwrap");
  const camHint = view.querySelector("#sc-camhint");
  const videoEl = view.querySelector("#sc-video");
  const torchBtn = view.querySelector("#sc-torch");
  const camBtn = view.querySelector("#sc-cam");
  const recents = [];

  const paintStatus = () => {
    const s = scannerStatus();
    statusEl.textContent = s.ok
      ? s.text
      : "Scanner not detected yet. Pair it in HID / Keyboard mode, or use the camera below.";
  };
  paintStatus();

  const paintRecent = () => {
    recentEl.innerHTML = recents.length
      ? recents.map((p) => `<li class="row" data-id="${p.id}">
          <div class="thumb">${p.imageUrl ? `<img src="${esc(fileUrl(p.imageUrl))}">` : esc((p.productName || "?").slice(0, 2).toUpperCase())}</div>
          <div class="mid"><b>${esc(p.productName)}</b><small>${esc(p.sku)}</small></div>
          <div class="end"><b>${money(p.sellingPrice)}</b></div></li>`).join("")
      : emptyState("No scans yet", "Scanned products appear here", "scan");
  };
  paintRecent();
  recentEl.onclick = (e) => {
    const li = e.target.closest("[data-id]");
    if (li) openProductSheet(li.dataset.id, () => {}, go);
  };

  /* ============================================================
     Handle a code from any source
     ============================================================ */
  const handle = (code, source = "") => {
    const p = findByCode(code);

    if (!p) {
      resultEl.innerHTML = `<div class="card" style="border-color:var(--danger)">
        <div class="flex"><div class="thumb" style="background:var(--danger-bg);color:var(--danger);border:none">${icon("alert")}</div>
        <div class="grow"><b>Product not found</b><div class="small muted">Please check the QR/Barcode.</div>
        <div class="mono small mt">${esc(code)}</div></div></div>
        ${can("products.create") ? `<button class="btn btn-outline btn-block mt" id="sc-new">${icon("plus")} Add a product with this code</button>` : ""}
      </div>`;
      const nb = resultEl.querySelector("#sc-new");
      if (nb) nb.onclick = async () => {
        const { openProductEditor } = await import("./_shared.js");
        openProductEditor({
          barcode: code,
          gstRate: toNum(state.settings?.defaultGstRate, 5),
          minimumStock: toNum(state.settings?.lowStockDefault, 3),
          status: "active"
        }, () => ok("Product created"));
      };
      if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
      if (source === "camera") camHint.textContent = "Not in catalogue: " + code;
      resultEl.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (navigator.vibrate) navigator.vibrate(40);
    if (!recents.find((r) => r.id === p.id)) { recents.unshift(p); recents.splice(6); paintRecent(); }
    if (source === "camera") camHint.textContent = "Found: " + p.productName;

    const st = stockStatus(p);
    const blocked = st.key === "out" && state.settings?.allowNegativeStock !== true;
    resultEl.innerHTML = `
      <div class="card" style="border-color:var(--ok)">
        <div class="flex mb">
          <div class="thumb" style="width:72px;height:72px;border-radius:12px">
            ${p.imageUrl ? `<img src="${esc(fileUrl(p.imageUrl))}">` : icon("box")}
          </div>
          <div class="grow">
            <b style="font-size:16px">${esc(p.productName)}</b>
            <div class="mono small muted">${esc(p.sku || "")}</div>
            <div style="font-size:22px;font-weight:700;color:var(--maroon)">${money(p.sellingPrice)}</div>
            <span class="pill ${st.cls}">${st.key === "ok" ? toNum(p.stock) + " in stock" : st.label}</span>
          </div>
        </div>
        <div class="small muted mb">${[p.categoryName, p.colour, p.size, p.fabric].filter(Boolean).map(esc).join(" · ")}</div>
        <div class="btn-row">
          <button class="btn btn-primary" id="sc-add" ${blocked ? "disabled" : ""}>${icon("bill")} Add to bill</button>
          <button class="btn btn-soft" id="sc-detail">Details</button>
        </div>
        ${st.key === "out" ? `<p class="form-note mt">This product is currently out of stock.</p>` : ""}
      </div>`;
    resultEl.querySelector("#sc-detail").onclick = () => openProductSheet(p.id, () => {}, go);
    const add = resultEl.querySelector("#sc-add");
    if (add) add.onclick = () => {
      sessionStorage.setItem("vyra.pendingScan", p.barcode || p.sku || p.id);
      go("#/billing");
    };
    // The camera fills the screen, so bring the result into view on a hit.
    resultEl.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  setScanHandler((code) => { paintStatus(); handle(code); });

  /* ============================================================
     Manual entry
     ============================================================ */
  view.querySelector("#sc-find").onclick = () => {
    const v = view.querySelector("#sc-manual").value.trim();
    if (v) handle(v);
  };
  view.querySelector("#sc-manual").onkeydown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); const v = e.target.value.trim(); if (v) { handle(v); e.target.value = ""; } }
  };
  view.querySelector("#sc-browse").onclick = () => pickProduct((p) => handle(p.barcode || p.sku || p.id));
  view.querySelector("#sc-target").onclick = () => view.querySelector("#sc-manual").focus();

  /* ============================================================
     Camera
     ============================================================ */
  const support = cameraSupport();
  if (!support.ok) {
    camBtn.classList.remove("btn-primary");
    camBtn.classList.add("btn-soft");
    camBtn.title = support.message;
  } else if (!support.native) {
    preloadCameraDecoder();     // pull jsQR in early on browsers that need it
  }

  const stopCam = () => {
    if (cam) { cam.stop(); cam = null; }
    camWrap.classList.add("hidden");
    torchBtn.classList.add("hidden");
    camBtn.innerHTML = `${icon("scan")} Scan with camera`;
  };

  const onStatus = (s, detail) => {
    if (s === "starting") camHint.textContent = "Starting camera…";
    else if (s === "loading-decoder") camHint.textContent = "Loading QR decoder…";
    else if (s === "scanning") camHint.textContent = "Point at the QR code" + (detail === "jsqr" ? " (QR only)" : "");
  };

  const startCam = async (facing = "environment") => {
    const sup = cameraSupport();
    if (!sup.ok) { err(sup.message); return; }
    try {
      busy(true, "Starting camera…");
      camWrap.classList.remove("hidden");
      cam = await startCameraScanner({
        video: videoEl,
        facingMode: facing,
        onStatus,
        onCode: (code) => handle(code, "camera")
      });
      camBtn.innerHTML = `${icon("x")} Stop camera`;
      torchBtn.classList.toggle("hidden", !cam.hasTorch);
      camWrap.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) {
      stopCam();
      err(e.message || "The camera could not be started.");
    } finally { busy(false); }
  };

  camBtn.onclick = () => { if (cam) stopCam(); else startCam(); };
  view.querySelector("#sc-camstop").onclick = stopCam;
  torchBtn.onclick = async () => {
    if (!cam) return;
    const on = await cam.toggleTorch();
    torchBtn.classList.toggle("btn-gold", on);
    torchBtn.classList.toggle("btn-soft", !on);
  };
  view.querySelector("#sc-flip").onclick = async () => {
    if (!cam) return startCam("user");
    try {
      busy(true, "Switching camera…");
      cam = await cam.switchCamera();
      torchBtn.classList.toggle("hidden", !cam.hasTorch);
    } catch (e) { err(e.message); stopCam(); }
    finally { busy(false); }
  };

  if (params.code) handle(params.code);

  return () => stopCam();
}
