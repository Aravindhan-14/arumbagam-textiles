/* ============================================================
   ARUMBAGAM - Business settings
   ============================================================ */
import { state, can, isAdmin, costsStatus, refreshCosts } from "../store.js";
import { saveSettings, uploadImage, DEFAULT_SETTINGS, peekBlockSize, ensureBlocks, logActivity } from "../db.js";
import { changePassword } from "../auth.js";
import { icon, openSheet, emptyState, ok, err, warn, busy, confirmDialog, formData, toast } from "../ui.js";
import { esc, fileUrl, toNum, toInt, validGstin, upper } from "../utils.js";
import {
  setPaperWidth, printerMode, setPrinterMode, printerStatus, printHtmlFallback,
  labelRotation, setLabelRotation, labelPrinter
} from "../hw/printer.js";
import { usesBrowserPrint, newReceiptDoc, sendDoc } from "../hw/documents.js";
import { printLabels, printSizeTest } from "../hw/labels.js";

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
        <label class="field"><span>Bill paper width</span>
          <select name="printerWidth" ${editable ? "" : "disabled"}>
            <option value="58" ${toNum(s.printerWidth) === 58 ? "selected" : ""}>58 mm</option>
            <option value="80" ${toNum(s.printerWidth) === 80 ? "selected" : ""}>80 mm</option>
            <option value="100" ${toNum(s.printerWidth) === 100 ? "selected" : ""}>100 mm (4 inch roll)</option>
          </select></label>
        <label class="field"><span>Print mode</span>
          <select id="se-printmode">
            <option value="auto">Automatic</option>
            <option value="wired">Wired printer (no dialog)</option>
            <option value="browser">Browser print</option>
          </select></label>
      </div>
      ${editable ? `
      <div class="grid2">
        <label class="field"><span>One label width (mm)</span>
          <input name="labelWidthMm" type="number" inputmode="numeric" min="20" max="120" value="${toNum(s.labelWidthMm)}"></label>
        <label class="field"><span>One label height (mm)</span>
          <input name="labelHeightMm" type="number" inputmode="numeric" min="10" max="120" value="${toNum(s.labelHeightMm)}"></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Labels across the roll</span>
          <select name="labelsPerRow">
            ${[1, 2, 3, 4].map((n) => `<option value="${n}" ${toInt(s.labelsPerRow, 1) === n ? "selected" : ""}>${n} per row</option>`).join("")}
          </select></label>
        <label class="field"><span>Gap between them (mm)</span>
          <input name="labelGapMm" type="number" inputmode="numeric" min="0" max="20" step="0.5" value="${toNum(s.labelGapMm)}"></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Move printing across (mm)</span>
          <input name="labelShiftXMm" type="number" inputmode="decimal" min="-40" max="40" step="0.5" value="${toNum(s.labelShiftXMm)}"></label>
        <label class="field"><span>Move printing down (mm)</span>
          <input name="labelShiftYMm" type="number" inputmode="decimal" min="-20" max="20" step="0.5" value="${toNum(s.labelShiftYMm)}"></label>
      </div>
      <p class="form-note">If the printing sits to one side of the stickers rather than in the
        middle of them, measure how far out it is and put that here - <b>minus</b> to move it
        left or up, <b>plus</b> to move it right or down. Print the size test, adjust, print again.</p>
      <p class="form-note">The roll carries <b>${toInt(s.labelsPerRow, 1)} labels side by side</b>, so one
        printed row is ${toInt(s.labelsPerRow, 1)} stickers of the same product -
        <b>${toNum(s.labelWidthMm)} x ${toNum(s.labelHeightMm)} mm</b> each, printed as one
        <b>${toNum(s.labelWidthMm) * Math.max(1, toInt(s.labelsPerRow, 1)) + toNum(s.labelGapMm) * (Math.max(1, toInt(s.labelsPerRow, 1)) - 1)} x ${toNum(s.labelHeightMm)} mm</b> row.
        Ten labels then come out as five rows. Set the <b>printer's own paper size to that row</b>,
        not to one sticker - <b>Print size test</b> below checks it.</p>
      <label class="check"><input type="checkbox" name="labelShowPrice" ${s.labelShowPrice !== false ? "checked" : ""}><span>Print price on labels</span></label>
      <label class="check"><input type="checkbox" name="labelShowShopName" ${s.labelShowShopName ? "checked" : ""}><span>Print shop name on labels</span></label>
      <label class="field"><span>Turn labels on the roll</span>
        <select id="se-labelrotate">
          ${[0, 90, 180, 270].map((d) => `<option value="${d}" ${labelRotation() === d ? "selected" : ""}>${d === 0 ? "No turn" : d + "°"}</option>`).join("")}
        </select></label>` : ""}
      <div class="small muted mb">Printer status: ${esc(printerStatus().text)}</div>
      <div class="btn-row">
        <button class="btn btn-soft btn-sm" id="se-test">${icon("print")} Test bill</button>
        <button class="btn btn-soft btn-sm" id="se-testlabel">${icon("qr")} Test label row</button>
        <button class="btn btn-soft btn-sm" id="se-sizetest">${icon("tag")} Print size test</button>
        <button class="btn btn-soft btn-sm" id="se-hw">${icon("print")} Printer setup</button>
      </div>
    </div>

    ${isAdmin() ? `
    <div class="sec-title">Owner figures</div>
    <div class="card">
      <div class="trow"><span>Purchase prices held</span>
        <b>${Object.keys(state.costs || {}).length} product${Object.keys(state.costs || {}).length === 1 ? "" : "s"}</b></div>
      <div class="trow"><span>Last load</span>
        <b>${costsStatus().loaded ? "OK" : "failed"}</b></div>
      ${costsStatus().loaded ? "" : `<p class="form-error">${esc(costsStatus().error || "Not loaded yet.")}</p>`}
      <button class="btn btn-soft btn-sm mt" id="se-costs-retry">Load purchase prices again</button>
      <p class="form-note">Purchase price, supplier, margin and stock value are yours alone - staff
        devices are never sent them. A product showing <b>Not recorded</b> simply has no purchase
        price saved yet: open it and use <b>Edit</b>.</p>
    </div>` : ""}

    <div class="sec-title">Account</div>
    <div class="card">
      <div class="row" style="cursor:default;padding-left:0;padding-right:0">
        <div class="mid"><b>${esc(state.user?.name || "")}</b><small>${esc(state.user?.email || "")} · ${esc(state.user?.role || "")}</small></div>
      </div>
      <button class="btn btn-soft btn-block mt" id="se-pwd">Change my password</button>
    </div>

    ${editable ? `<button class="btn btn-primary btn-block btn-lg mt" id="se-save">${icon("check")} Save Settings</button>` : ""}
    <div class="small muted tc mt">ARUMBAGAM · Boutique Billing &amp; Inventory · v1.0</div>`;

  /* ---------- wiring ---------- */
  view.querySelector("#se-printmode").value = printerMode();
  view.querySelector("#se-printmode").onchange = (e) => { setPrinterMode(e.target.value); ok("Print mode saved"); };

  const rotateSel = view.querySelector("#se-labelrotate");
  if (rotateSel) rotateSel.onchange = (e) => { setLabelRotation(e.target.value); ok("Label turn saved"); };

  /* One row of sample stickers, so the roll can be lined up without
     spending a bill on it. */
  const testLabelBtn = view.querySelector("#se-testlabel");
  if (testLabelBtn) testLabelBtn.onclick = async () => {
    const across = Math.max(1, toInt(fieldVal("labelsPerRow", s.labelsPerRow), 1));
    try {
      busy(true, "Printing…");
      await printLabels([{
        product: {
          id: "test", productName: s.businessName || "ARUMBAGAM",
          sku: "TEST-1234", barcode: "TEST-1234", sellingPrice: 999,
          colour: "Test", size: "-"
        },
        qty: across,
        type: "barcode"
      }], {
        ...s,
        labelWidthMm: toInt(fieldVal("labelWidthMm", s.labelWidthMm), 50),
        labelHeightMm: toInt(fieldVal("labelHeightMm", s.labelHeightMm), 25),
        labelsPerRow: across,
        labelGapMm: toNum(fieldVal("labelGapMm", s.labelGapMm), 0),
        labelShiftXMm: toNum(fieldVal("labelShiftXMm", s.labelShiftXMm), 0),
        labelShiftYMm: toNum(fieldVal("labelShiftYMm", s.labelShiftYMm), 0)
      });
      ok(`One row of ${across} sent to ${labelPrinter() || "the label printer"}`);
    } catch (e) { err(e.message); } finally { busy(false); }
  };

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
          `<div class="c big">${esc(fieldVal("businessName", s.businessName) || "ARUMBAGAM")}</div>
           <div class="c">${esc(fieldVal("businessType", s.businessType))}</div><hr>
           <table><tr><td>Test</td><td class="r">OK</td></tr></table><hr>
           <div class="c">${esc(fieldVal("footerMessage", s.footerMessage) || "Thank you")}</div>`,
          "Test print");
        ok("Print preview opened"); return;
      }
      const p = newReceiptDoc({ ...s, printerWidth: toNum(fieldVal("printerWidth", s.printerWidth), 58) });
      p.align("center").bold(true).size(2, 2).line(fieldVal("businessName", s.businessName) || "ARUMBAGAM")
        .size(1, 1).bold(false).line(fieldVal("businessType", s.businessType))
        .rule().align("left").lr("Test", "OK").rule()
        .align("center").line(fieldVal("footerMessage", s.footerMessage) || "Thank you").feed(2).cut();
      await sendDoc(p); ok("Test sent");
    } catch (e) { err(e.message); }
  };
  /* Prints a ruler at the row's true size. Measured against a tape it
     shows in one go whether the printer is scaling the artwork. */
  const sizeBtn = view.querySelector("#se-sizetest");
  if (sizeBtn) sizeBtn.onclick = async () => {
    const settings = {
      ...s,
      labelWidthMm: toInt(fieldVal("labelWidthMm", s.labelWidthMm), 50),
      labelHeightMm: toInt(fieldVal("labelHeightMm", s.labelHeightMm), 25),
      labelsPerRow: Math.max(1, toInt(fieldVal("labelsPerRow", s.labelsPerRow), 1)),
      labelGapMm: toNum(fieldVal("labelGapMm", s.labelGapMm), 0),
      labelShiftXMm: toNum(fieldVal("labelShiftXMm", s.labelShiftXMm), 0),
      labelShiftYMm: toNum(fieldVal("labelShiftYMm", s.labelShiftYMm), 0)
    };
    try {
      busy(true, "Printing…");
      const out = await printSizeTest(settings);
      busy(false);
      await confirmDialog(
        [
          `A test row went to ${labelPrinter() || "the printer"}.`,
          "",
          `It should measure ${out.rowMm} mm across and ${out.heightMm} mm tall,`,
          `as ${out.across} stickers of ${out.widthMm} x ${out.heightMm} mm.`,
          "",
          "Hold a tape against it:",
          `• Right size, frame inside each sticker — nothing to change.`,
          `• Everything squeezed into ONE sticker — the printer's paper is set`,
          `  to one label. Set it to ${out.rowMm} x ${out.heightMm} mm in the`,
          "  printer's preferences in Windows.",
          "• Right shape but too big or small — set Scale to 100 in the print box.",
          "• Sticker itself is a different size — type its real size above."
        ].join("\n"),
        { okText: "Got it", cancelText: "" });
    } catch (e) { err(e.message); } finally { busy(false); }
  };

  const costsRetry = view.querySelector("#se-costs-retry");
  if (costsRetry) costsRetry.onclick = async () => {
    try {
      busy(true, "Loading…");
      await refreshCosts({ retries: 0 });
      const st = costsStatus();
      if (st.loaded) ok(`${Object.keys(state.costs || {}).length} purchase prices loaded`);
      else err(st.error);
      go("#/settings");
    } catch (e) { err(e.message); } finally { busy(false); }
  };

  view.querySelector("#se-pwd").onclick = () => passwordSheet();

  const saveBtn = view.querySelector("#se-save");
  if (saveBtn) saveBtn.onclick = async () => {
    const d = formData(view);
    if (d.gstin && !validGstin(d.gstin)) return warn("That GSTIN does not look valid.");
    try {
      busy(true, "Saving…");
      const patch = {
        businessName: d.businessName.trim() || "ARUMBAGAM",
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
        labelsPerRow: Math.min(4, Math.max(1, toInt(d.labelsPerRow, 1))),
        labelGapMm: toNum(d.labelGapMm),
        labelShiftXMm: toNum(d.labelShiftXMm),
        labelShiftYMm: toNum(d.labelShiftYMm),
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
