/* ============================================================
   VYRA SAREES - camera scanning
   ------------------------------------------------------------
   Two decoders, because neither one is available everywhere:

   1. BarcodeDetector - native, fast, reads QR *and* 1D barcodes.
      Present on Chrome/Android and Chrome/macOS. NOT present on
      desktop Windows Chrome or on iOS, and on some Android
      phones it exists but never returns a result because the
      Play Services barcode module was never installed.

   2. jsQR - pure JavaScript, QR only, loaded on demand. Works
      in every browser and covers the phones the native path
      leaves behind.

   The loop runs whichever decoders are usable. If the native one
   has produced nothing after a few seconds, jsQR is pulled in and
   run alongside it, which is what rescues the "exists but silently
   broken" phones.
   ============================================================ */

const JSQR_URL = "https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js";
const NATIVE_FORMATS = ["qr_code", "code_128", "ean_13", "ean_8", "code_39", "upc_a", "upc_e", "itf", "codabar"];
const SCAN_INTERVAL = 130;      // ms between decode attempts
const NATIVE_GRACE = 4500;      // ms to trust the native decoder alone
const REPEAT_MS = 2200;         // ignore the same code for this long

/* ---------- capability probe ---------- */
export function cameraSupport() {
  if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    return { ok: false, reason: "insecure", message: "The camera only works over https. Open the hosted app link (or localhost) instead of the plain IP address." };
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return { ok: false, reason: "unsupported", message: "This browser cannot open the camera. Use the Bluetooth scanner, or try Chrome." };
  }
  return { ok: true, native: "BarcodeDetector" in window };
}

/* ---------- lazy jsQR loader ---------- */
let jsQrPromise = null;
function loadJsQr() {
  if (window.jsQR) return Promise.resolve(true);
  if (jsQrPromise) return jsQrPromise;
  jsQrPromise = new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = JSQR_URL;
    s.async = true;
    s.onload = () => resolve(!!window.jsQR);
    s.onerror = () => { jsQrPromise = null; resolve(false); };
    document.head.appendChild(s);
  });
  return jsQrPromise;
}
/** Warm the fallback decoder up before the user taps Scan. */
export const preloadCameraDecoder = () => loadJsQr();

/* ---------- friendly getUserMedia errors ---------- */
function mediaError(e) {
  switch (e && e.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera permission was blocked. Allow it from the padlock icon in the address bar, then try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No usable camera was found on this device.";
    case "NotReadableError":
      return "The camera is already in use by another app. Close it and try again.";
    case "AbortError":
      return "The camera stopped unexpectedly. Please try again.";
    default:
      return (e && e.message) || "The camera could not be started.";
  }
}

/**
 * Start scanning into a <video> element.
 *
 * @param {object}   opts
 * @param {HTMLVideoElement} opts.video
 * @param {(code:string, format:string) => void} opts.onCode
 * @param {(state:string, detail?:string) => void} [opts.onStatus]
 * @param {string}   [opts.facingMode="environment"]
 * @returns {Promise<object>} controller: { stop, toggleTorch, hasTorch, switchCamera, decoder }
 */
export async function startCameraScanner({ video, onCode, onStatus, facingMode = "environment" }) {
  const support = cameraSupport();
  if (!support.ok) throw Object.assign(new Error(support.message), { reason: support.reason });

  const say = (s, d) => { if (onStatus) onStatus(s, d); };
  say("starting");

  /* ---- open the stream ---- */
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });
  } catch (e) {
    // Some phones reject the ideal constraints; retry with the bare minimum.
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } catch (e2) {
      throw Object.assign(new Error(mediaError(e2)), { reason: e2 && e2.name });
    }
  }

  video.srcObject = stream;
  video.setAttribute("playsinline", "");
  video.muted = true;
  try { await video.play(); } catch { /* some browsers resolve late; the loop copes */ }

  /* wait for real frame dimensions before decoding */
  await new Promise((resolve) => {
    if (video.videoWidth) return resolve();
    const done = () => { video.removeEventListener("loadedmetadata", done); resolve(); };
    video.addEventListener("loadedmetadata", done);
    setTimeout(done, 2500);
  });

  const track = stream.getVideoTracks()[0];
  const caps = (track && track.getCapabilities) ? (track.getCapabilities() || {}) : {};

  /* ---- decoders ---- */
  let detector = null;
  let useNative = false;
  if ("BarcodeDetector" in window) {
    try {
      const available = await window.BarcodeDetector.getSupportedFormats();
      const formats = available.filter((f) => NATIVE_FORMATS.includes(f));
      if (formats.length) { detector = new window.BarcodeDetector({ formats }); useNative = true; }
    } catch { useNative = false; }
  }

  let useJsQr = false;
  if (!useNative) {
    say("loading-decoder");
    useJsQr = await loadJsQr();
    if (!useJsQr) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("The QR decoder could not be downloaded. Check the internet connection and try again.");
    }
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  let running = true;
  let timer = 0;
  let lastCode = "", lastAt = 0;
  let nativeFails = 0;
  let nativeHits = 0;
  const startedAt = Date.now();
  let rescued = false;

  say("scanning", useNative ? "native" : "jsqr");

  function decodeJsQr() {
    if (!window.jsQR || !video.videoWidth) return null;
    const scale = Math.min(1, 640 / video.videoWidth);
    const w = Math.max(2, Math.round(video.videoWidth * scale));
    const h = Math.max(2, Math.round(video.videoHeight * scale));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.drawImage(video, 0, 0, w, h);
    let img;
    try { img = ctx.getImageData(0, 0, w, h); } catch { return null; }
    const res = window.jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
    return res && res.data ? { value: res.data, format: "qr_code" } : null;
  }

  async function tick() {
    if (!running) return;

    /* The native decoder can be present but permanently silent on phones
       without the Play Services barcode module. Bring jsQR in alongside it. */
    if (useNative && !useJsQr && !rescued && nativeHits === 0 && Date.now() - startedAt > NATIVE_GRACE) {
      rescued = true;
      useJsQr = await loadJsQr();
      if (useJsQr) say("scanning", "native+jsqr");
    }

    let hit = null;

    if (useNative && detector) {
      try {
        const found = await detector.detect(video);
        if (found && found.length) {
          hit = { value: found[0].rawValue, format: found[0].format || "" };
          nativeHits++;
        }
        nativeFails = 0;
      } catch {
        if (++nativeFails >= 3) {
          useNative = false;
          if (!useJsQr) { useJsQr = await loadJsQr(); }
          say("scanning", useJsQr ? "jsqr" : "none");
        }
      }
    }

    if (!hit && useJsQr) hit = decodeJsQr();

    if (hit && hit.value) {
      const now = Date.now();
      if (hit.value !== lastCode || now - lastAt > REPEAT_MS) {
        lastCode = hit.value; lastAt = now;
        if (navigator.vibrate) navigator.vibrate(45);
        try { onCode(hit.value, hit.format); } catch (e) { console.error(e); }
      }
    }

    if (running) timer = setTimeout(tick, SCAN_INTERVAL);
  }
  timer = setTimeout(tick, 200);

  /* ---- controller ---- */
  let torchOn = false;
  const controller = {
    get decoder() { return useNative ? (useJsQr ? "native+jsqr" : "native") : "jsqr"; },
    hasTorch: !!caps.torch,
    get torchOn() { return torchOn; },

    async toggleTorch() {
      if (!caps.torch || !track) return false;
      torchOn = !torchOn;
      try { await track.applyConstraints({ advanced: [{ torch: torchOn }] }); }
      catch { torchOn = false; }
      return torchOn;
    },

    async switchCamera() {
      const next = facingMode === "environment" ? "user" : "environment";
      controller.stop();
      return startCameraScanner({ video, onCode, onStatus, facingMode: next });
    },

    stop() {
      running = false;
      clearTimeout(timer);
      try { stream.getTracks().forEach((t) => t.stop()); } catch {}
      if (video) { video.srcObject = null; }
      say("stopped");
    }
  };
  return controller;
}
