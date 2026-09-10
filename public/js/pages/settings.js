/* ============================================================
   VYRA SAREES - Business settings
   ============================================================ */
import { state, can, isAdmin } from "../store.js";
import { saveSettings, uploadImage, DEFAULT_SETTINGS, peekBlockSize, ensureBlocks, logActivity } from "../db.js";
import { changePassword } from "../auth.js";
import { icon, openSheet, emptyState, ok, err, warn, busy, confirmDialog, formData, toast } from "../ui.js";
import { esc, fileUrl, toNum, toInt, validGstin, upper } from "../utils.js";
import { setPaperWidth, printerMode, setPrinterMode, printerStatus, Escpos, printHtmlFallback } from "../hw/printer.js";
import { usesBrowserPrint } from "../hw/documents.js";

export const title = "Settings";

/** Change the signed-in account's own password. */
function passwordSheet() {
  openSheet({
    title: "Change my password",
    body: `
      <label class="field req"><span>Current password</span>
        <input name="currentPassword" type="password" autocomplete="current-password" required></label>
      <label class="field req"><span>New password</span>
        <input name="newPassword" type="password" autocomplete="new-password" minlength="6" required></label>
      <label class="field req"><span>Repeat the new password</span>
        <input name="repeat" type="password" autocomplete="new-password" minlength="6" required></label>
      <div id="pw-err" class="form-error hidden"></div>`,
    footer: `<button class="btn btn-soft" data-close>Cancel</button>
             <button class="btn btn-primary" id="pw-save">Change password</button>`,
    onMount(api) {
      const fail = (m) => { const b = api.root.querySelector("#pw-err"); b.textContent = m; b.classList.remove("hidden"); };
      api.root.querySelector("#pw-save").onclick = async () => {
        const d = formData(api.root);
        if ((d.newPassword || "").length < 6) return fail("The new password must be at least 6 characters.");
        if (d.newPassword !== d.repeat) return fail("The two new passwords do not match.");
        try {
          busy(true, "Saving…");
          await changePassword(d.currentPassword, d.newPassword);
          api.close(); ok("Password changed");
        } catch (e) { fail(e.message); } finally { busy(false); }
      };
    }
  });
}

export async function mount(view, { go }) {
  const editable = can("settings.manage");
  const s = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };

  view.innerHTML = `
    ${editable ? `
    <div class="sec-title">Business Information</div>
    <div class="card">
      <div class="flex mb">
        <div class="thumb" id="se-logo" style="width:64px;height:64px;border-radius:12px">
          ${s.logoUrl ? `<img src="${esc(fileUrl(s.logoUrl))}">` : icon("tag")}
        </div>
        <div class="grow">
          <button class="btn btn-soft btn-sm" id="se-logo-btn" ${editable ? "" : "disabled"}>Shop logo</button>
          <div class="small muted mt">Shown on screen; thermal receipts print the name in text.</div>
        </div>
        <input type="file" id="se-logo-file" accept="image/*" class="hidden">
      </div>
      <label class="field"><span>Business name</span><input name="businessName" value="${esc(s.businessName)}"></label>
      <label class="field"><span>Business type</span><input name="businessType" value="${esc(s.businessType)}"></label>
      <label class="field"><span>Address</span><textarea name="address">${esc(s.address)}</textarea></label>
      <div class="grid2">
        <label class="field"><span>Mobile</span><input name="mobile" type="tel" inputmode="numeric" value="${esc(s.mobile)}"></label>
        <label class="field"><span>Email</span><input name="email" type="email" value="${esc(s.email)}"></label>
      </div>
    </div>

    <div class="sec-title">GST</div>
    <div class="card">
      <label class="check"><input type="checkbox" name="gstEnabled" ${s.gstEnabled ? "checked" : ""}><span>Charge GST on bills</span></label>
      <p class="form-note">This is the shop's normal setting. A single bill can still be switched
        the other way with the <b>GST on / off</b> button on the billing screen.</p>
      <label class="field"><span>Business GSTIN</span><input name="gstin" class="mono" maxlength="15" value="${esc(s.gstin)}"></label>
      <div class="grid2">
        <label class="field"><span>Default GST rate</span>
          <select name="defaultGstRate">${[0, 3, 5, 12, 18, 28].map((r) => `<option value="${r}" ${toNum(s.defaultGstRate) === r ? "selected" : ""}>${r}%</option>`).join("")}</select></label>
        <label class="field"><span>Price mode</span>
          <select name="gstMode">
            <option value="exclusive" ${s.gstMode === "exclusive" ? "selected" : ""}>GST added to price</option>
            <option value="inclusive" ${s.gstMode === "inclusive" ? "selected" : ""}>Price includes GST</option>
          </select></label>
      </div>
      <label class="field"><span>State code (first 2 digits of your GSTIN)</span>
        <input name="stateCode" class="mono" maxlength="2" inputmode="numeric" value="${esc(s.stateCode)}"></label>
      <p class="form-note">Customers with a GSTIN from another state are billed IGST automatically.</p>
    </div>

    <div class="sec-title">Invoice &amp; Numbering</div>
    <div class="card">
      <div class="grid3">
        <label class="field"><span>Invoice prefix</span><input name="invoicePrefix" class="mono" value="${esc(s.invoicePrefix)}"></label>
        <label class="field"><span>Purchase prefix</span><input name="purchasePrefix" class="mono" value="${esc(s.purchasePrefix)}"></label>
        <label class="field"><span>Return prefix</span><input name="returnPrefix" class="mono" value="${esc(s.returnPrefix)}"></label>
      </div>
      <label class="field"><span>SKU prefix</span><input name="skuPrefix" class="mono" value="${esc(s.skuPrefix)}"></label>
      <label class="check"><input type="checkbox" name="roundOff" ${s.roundOff !== false ? "checked" : ""}><span>Round bill totals to the nearest rupee</span></label>
      <label class="field"><span>Receipt footer message</span><textarea name="footerMessage">${esc(s.footerMessage)}</textarea></label>
      <label class="check"><input type="checkbox" name="showInvoiceQr" ${s.showInvoiceQr !== false ? "checked" : ""}><span>Print a QR of the invoice number on bills</span></label>
      <label class="check"><input type="checkbox" name="showGstSummary" ${s.showGstSummary !== false ? "checked" : ""}><span>Print the GST rate summary on bills</span></label>
      <div class="trow mt"><span>Invoice numbers reserved offline</span><b>${peekBlockSize("invoice")}</b></div>
      <button class="btn btn-soft btn-sm mt" id="se-reserve">Reserve more numbers</button>
    </div>

    <div class="sec-title">Selling Rules</div>
    <div class="card">
      <div class="grid2">
        <label class="field"><span>Max staff discount (%)</span>
          <input name="maxStaffDiscountPct" type="number" inputmode="numeric" min="0" max="100" value="${toNum(s.maxStaffDiscountPct)}"></label>
        <label class="field"><span>Default minimum stock</span>
          <input name="lowStockDefault" type="number" inputmode="numeric" min="0" value="${toNum(s.lowStockDefault)}"></label>
      </div>
      <label class="check"><input type="checkbox" name="allowNegativeStock" ${s.allowNegativeStock ? "checked" : ""}>
        <span>Allow selling when stock is zero</span></label>
      <p class="form-note">Leave this off so the app blocks sales of items you no longer have.</p>
    </div>` : ""}

    <div class="sec-title">Printing</div>
    <div class="card">
      <div class="grid2">
        <label class="field"><span>Receipt paper width</span>
          <select name="printerWidth" ${editable ? "" : "disabled"}>
            <option value="58" ${toNum(s.printerWidth) === 58 ? "selected" : ""}>58 mm</option>
            <option value="80" ${toNum(s.printerWidth) === 80 ? "selected" : ""}>80 mm</option>
          </select></label>
        <label class="field"><span>Print mode</span>
          <select id="se-printmode">
            <option value="auto">Automatic</option>
            <option value="bluetooth">Web Bluetooth</option>
            <option value="rawbt">RawBT app</option>
            <option value="browser">Browser print</option>
          </select></label>
      </div>
      ${editable ? `
      <div class="grid2">
        <label class="field"><span>Label width (mm)</span>
          <input name="labelWidthMm" type="number" inputmode="numeric" min="20" max="80" value="${toNum(s.labelWidthMm)}"></label>
        <label class="field"><span>Label height (mm)</span>
          <input name="labelHeightMm" type="number" inputmode="numeric" min="10" max="80" value="${toNum(s.labelHeightMm)}"></label>
      </div>
      <label class="check"><input type="checkbox" name="labelShowPrice" ${s.labelShowPrice !== false ? "checked" : ""}><span>Print price on labels</span></label>
      <label class="check"><input type="checkbox" name="labelShowShopName" ${s.labelShowShopName ? "checked" : ""}><span>Print shop name on labels</span></label>` : ""}
      <div class="small muted mb">Printer status: ${esc(printerStatus().text)}</div>
      <div class="btn-row">
        <button class="btn btn-soft btn-sm" id="se-test">${icon("print")} Test print</button>
        <button class="btn btn-soft btn-sm" id="se-hw">${icon("bt")} Hardware panel</button>
      </div>
    </div>

    <div class="sec-title">Account</div>
    <div class="card">
      <div class="row" style="cursor:default;padding-left:0;padding-right:0">
        <div class="mid"><b>${esc(state.user?.name || "")}</b><small>${esc(state.user?.email || "")} · ${esc(state.user?.role || "")}</small></div>
      </div>
      <button class="btn btn-soft btn-block mt" id="se-pwd">Change my password</button>
    </div>

    ${editable ? `<button class="btn btn-primary btn-block btn-lg mt" id="se-save">${icon("check")} Save Settings</button>` : ""}
    <div class="small muted tc mt">VYRA SAREES · Boutique Billing &amp; Inventory · v1.0</div>`;

  /* ---------- wiring ---------- */
  view.querySelector("#se-printmode").value = printerMode();
  view.querySelector("#se-printmode").onchange = (e) => { setPrinterMode(e.target.value); ok("Print mode saved"); };

  let logoFile = null;
  const logoBtn = view.querySelector("#se-logo-btn");
  if (logoBtn) {
    logoBtn.onclick = () => view.querySelector("#se-logo-file").click();
    view.querySelector("#se-logo-file").onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 2 * 1024 * 1024) return warn("Choose an image under 2 MB");
      logoFile = f;
      const r = new FileReader();
      r.onload = () => { view.querySelector("#se-logo").innerHTML = `<img src="${r.result}">`; };
      r.readAsDataURL(f);
    };
  }

  const reserveBtn = view.querySelector("#se-reserve");
  if (reserveBtn) reserveBtn.onclick = async () => {
    try { busy(true, "Reserving…"); await ensureBlocks(["invoice", "sku", "purchase", "return"]); ok(`${peekBlockSize("invoice")} invoice numbers ready`); }
    catch (e) { err(e.message); } finally { busy(false); }
  };
  view.querySelector("#se-hw").onclick = () => document.getElementById("hw-btn").click();
  const fieldVal = (name, fallback) => {
    const el = view.querySelector(`[name=${name}]`);
    return (el && el.value) || fallback || "";
  };
  view.querySelector("#se-test").onclick = async () => {
    try {
      if (usesBrowserPrint()) {
        printHtmlFallback(
          `<div class="c big">${esc(fieldVal("businessName", s.businessName) || "VYRA SAREES")}</div>
           <div class="c">${esc(fieldVal("businessType", s.businessType))}</div><hr>
           <table><tr><td>Test</td><td class="r">OK</td></tr></table><hr>
           <div class="c">${esc(fieldVal("footerMessage", s.footerMessage) || "Thank you")}</div>`,
          "Test print");
        ok("Print preview opened"); return;
      }
      const p = new Escpos(toNum(fieldVal("printerWidth", s.printerWidth), 58));
      p.align("center").bold(true).size(2, 2).line(fieldVal("businessName", s.businessName) || "VYRA SAREES")
        .size(1, 1).bold(false).line(fieldVal("businessType", s.businessType))
        .rule().align("left").lr("Test", "OK").rule()
        .align("center").line(fieldVal("footerMessage", s.footerMessage) || "Thank you").feed(2).cut();
      await p.print(); ok("Test sent");
    } catch (e) { err(e.message); }
  };
  view.querySelector("#se-pwd").onclick = () => passwordSheet();

  const saveBtn = view.querySelector("#se-save");
  if (saveBtn) saveBtn.onclick = async () => {
    const d = formData(view);
    if (d.gstin && !validGstin(d.gstin)) return warn("That GSTIN does not look valid.");
    try {
      busy(true, "Saving…");
      const patch = {
        businessName: d.businessName.trim() || "VYRA SAREES",
        businessType: d.businessType.trim(),
        address: d.address.trim(), mobile: d.mobile.trim(), email: d.email.trim(),
        gstEnabled: !!d.gstEnabled, gstin: upper(d.gstin),
        defaultGstRate: toNum(d.defaultGstRate), gstMode: d.gstMode,
        stateCode: String(d.stateCode || "").trim(),
        invoicePrefix: upper(d.invoicePrefix) || "INV",
        purchasePrefix: upper(d.purchasePrefix) || "PUR",
        returnPrefix: upper(d.returnPrefix) || "RET",
        skuPrefix: upper(d.skuPrefix) || "VYS",
        roundOff: !!d.roundOff,
        footerMessage: d.footerMessage,
        showInvoiceQr: !!d.showInvoiceQr,
        showGstSummary: !!d.showGstSummary,
        maxStaffDiscountPct: toNum(d.maxStaffDiscountPct),
        lowStockDefault: toInt(d.lowStockDefault, 3),
        allowNegativeStock: !!d.allowNegativeStock,
        printerWidth: toInt(d.printerWidth, 58),
        labelWidthMm: toInt(d.labelWidthMm, 50),
        labelHeightMm: toInt(d.labelHeightMm, 25),
        labelShowPrice: !!d.labelShowPrice,
        labelShowShopName: !!d.labelShowShopName
      };
      if (logoFile) patch.logoUrl = await uploadImage(logoFile);
      await saveSettings(patch);
      setPaperWidth(patch.printerWidth);
      logActivity("SETTINGS_UPDATED", "Business settings saved");
      ok("Settings saved");
    } catch (e) { console.error(e); err(e.message || "Could not save settings."); }
    finally { busy(false); }
  };
}
