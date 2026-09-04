/* ============================================================
   VYRA SAREES - Business settings
   ============================================================ */
import { state, can, isAdmin } from "../store.js";
import { saveSettings, uploadImage, DEFAULT_SETTINGS, peekBlockSize, ensureBlocks, logActivity, auth, sendPasswordResetEmail } from "../db.js";
import { icon, openSheet, emptyState, ok, err, warn, busy, confirmDialog, formData, toast } from "../ui.js";
import { esc, toNum, toInt, validGstin, upper } from "../utils.js";
import { setPaperWidth, printerMode, setPrinterMode, printerStatus, Escpos } from "../hw/printer.js";

export const title = "Settings";

export async function mount(view, { go }) {
  const editable = can("settings.manage");
  const s = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };

  view.innerHTML = `
    ${editable ? "" : `<div class="card"><p class="mb0 muted">You can view these settings but only the shop owner can change them.</p></div>`}

    <div class="sec-title">Business Information</div>
    <div class="card">
      <div class="flex mb">
        <div class="thumb" id="se-logo" style="width:64px;height:64px;border-radius:12px">
          ${s.logoUrl ? `<img src="${esc(s.logoUrl)}">` : icon("tag")}
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
    </div>

    <div class="sec-title">Printing</div>
    <div class="card">
      <div class="grid2">
        <label class="field"><span>Receipt paper width</span>
          <select name="printerWidth">
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
      <div class="grid2">
        <label class="field"><span>Label width (mm)</span>
          <input name="labelWidthMm" type="number" inputmode="numeric" min="20" max="80" value="${toNum(s.labelWidthMm)}"></label>
        <label class="field"><span>Label height (mm)</span>
          <input name="labelHeightMm" type="number" inputmode="numeric" min="10" max="80" value="${toNum(s.labelHeightMm)}"></label>
      </div>
      <label class="check"><input type="checkbox" name="labelShowPrice" ${s.labelShowPrice !== false ? "checked" : ""}><span>Print price on labels</span></label>
      <label class="check"><input type="checkbox" name="labelShowShopName" ${s.labelShowShopName ? "checked" : ""}><span>Print shop name on labels</span></label>
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
  if (!editable) view.querySelectorAll("input,select,textarea").forEach((el) => { el.disabled = true; });
  view.querySelector("#se-printmode").value = printerMode();
  view.querySelector("#se-printmode").onchange = (e) => { setPrinterMode(e.target.value); ok("Print mode saved"); };

  let logoFile = null;
  view.querySelector("#se-logo-btn").onclick = () => view.querySelector("#se-logo-file").click();
  view.querySelector("#se-logo-file").onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 2 * 1024 * 1024) return warn("Choose an image under 2 MB");
    logoFile = f;
    const r = new FileReader();
    r.onload = () => { view.querySelector("#se-logo").innerHTML = `<img src="${r.result}">`; };
    r.readAsDataURL(f);
  };

  view.querySelector("#se-reserve").onclick = async () => {
    try { busy(true, "Reserving…"); await ensureBlocks(["invoice", "sku", "purchase", "return"]); ok(`${peekBlockSize("invoice")} invoice numbers ready`); }
    catch (e) { err(e.message); } finally { busy(false); }
  };
  view.querySelector("#se-hw").onclick = () => document.getElementById("hw-btn").click();
  view.querySelector("#se-test").onclick = async () => {
    try {
      const p = new Escpos(toNum(view.querySelector("[name=printerWidth]").value, 58));
      p.align("center").bold(true).size(2, 2).line(view.querySelector("[name=businessName]").value || "VYRA SAREES")
        .size(1, 1).bold(false).line(view.querySelector("[name=businessType]").value || "")
        .rule().align("left").lr("Test", "OK").rule()
        .align("center").line(view.querySelector("[name=footerMessage]").value || "Thank you").feed(2).cut();
      await p.print(); ok("Test sent");
    } catch (e) { err(e.message); }
  };
  view.querySelector("#se-pwd").onclick = async () => {
    const email = state.user?.email;
    if (!email) return;
    if (!await confirmDialog(`Send a password reset link to ${email}?`, { okText: "Send" })) return;
    try { await sendPasswordResetEmail(auth, email); ok("Reset link sent"); } catch (e) { err(e.message); }
  };

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
      if (logoFile) patch.logoUrl = await uploadImage(logoFile, `business/logo_${Date.now()}_${logoFile.name}`);
      await saveSettings(patch);
      setPaperWidth(patch.printerWidth);
      logActivity(null, "SETTINGS_UPDATED", "Business settings saved");
      ok("Settings saved");
    } catch (e) { console.error(e); err(e.message || "Could not save settings."); }
    finally { busy(false); }
  };
}
