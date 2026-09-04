# VYRA SAREES — Boutique Billing, Inventory & Sales Management

A mobile-first web application for the day-to-day running of a saree and boutique shop:
products, stock, QR/barcode labels, billing on the phone, Bluetooth thermal printing,
purchases, customers, suppliers, returns, GST and reports.

**Stack:** plain HTML / CSS / JavaScript (ES modules, no build step) + Firebase
(Authentication, Cloud Firestore, Storage, Security Rules).

**Primary device:** Android phone in Chrome, with a Bluetooth 2D scanner (HID mode)
and a Bluetooth ESC/POS thermal printer.

---

## 1. Quick start

```bash
# 1. Create a Firebase project at https://console.firebase.google.com
#    - Enable Authentication  > Sign-in method > Email/Password
#    - Create a Cloud Firestore database (production mode)
#    - Enable Cloud Storage

# 2. Paste your web app config into public/js/firebase-config.js

# 3. Deploy rules, indexes and the app
npm install -g firebase-tools
firebase login
firebase use --add            # pick your project
firebase deploy
```

Then open the hosted URL on the phone and **Add to Home screen**.

To run locally instead:

```bash
firebase serve            # or: npx serve public
```

Open `http://localhost:5000`. A plain `file://` open will not work — ES modules and
service workers need `http(s)`.

Full step-by-step instructions, including the first login, are in **[SETUP.md](SETUP.md)**.

---

## 2. What is in the box

| Area | Covered by |
|---|---|
| Authentication, roles, permissions | `js/auth.js`, `js/store.js`, `js/pages/staff.js` |
| Dashboard, alerts, quick actions | `js/pages/dashboard.js` |
| Products, SKU, images, QR, barcode | `js/pages/products.js`, `js/pages/_shared.js`, `js/codes/codes.js` |
| Categories | `js/pages/categories.js` |
| Scanning (HID scanner + camera) | `js/hw/scanner.js`, `js/pages/scan.js` |
| Billing / POS, GST, payments | `js/pages/billing.js`, `computeBill()` in `js/utils.js` |
| Thermal printing (receipts, labels) | `js/hw/printer.js`, `js/hw/documents.js` |
| Inventory, adjustments, history | `js/pages/inventory.js` |
| Purchases & suppliers | `js/pages/purchases.js`, `js/pages/suppliers.js` |
| Customers, dues, collections | `js/pages/customers.js` |
| Returns & exchanges | `js/pages/returns.js` |
| Sales history, reprint, cancel | `js/pages/sales.js` |
| Reports (sales, GST, profit, stock) | `js/pages/reports.js` |
| Bulk QR / barcode label printing | `js/pages/labels.js` |
| Business settings | `js/pages/settings.js` |
| Audit log | `js/pages/activity.js` |
| Security | `firestore.rules`, `storage.rules` |

---

## 3. Architecture notes

### Local cache, instant search
Products, categories, customers and suppliers are mirrored into memory with
`onSnapshot` listeners (`js/store.js`). Every search, scan look-up and filter runs
against that cache, so results are instant and keep working offline. Firestore cannot
do substring search, so this also gives real "search by anything" behaviour.

### Offline billing without duplicate invoices
Firestore transactions need the network, which would block billing when the shop's
connection drops. Instead:

* **Writes** use `writeBatch` with `FieldValue.increment()`. Batches queue locally and
  replay when the network returns, and increments merge safely across devices.
* **Invoice numbers** are drawn from a block reserved ahead of time
  (`reserveBlock`/`takeSequence` in `js/db.js`). Each device holds its own block, so two
  phones can never mint the same invoice number, online or off. Blocks top up
  automatically whenever the app is online.

The Hardware panel (top-right of the app bar) shows how many numbers are in reserve.

### Bill maths
`computeBill()` in `js/utils.js` is the single source of truth for pricing. It handles
per-line discounts, a bill-level discount spread proportionally across lines (so
per-line GST stays correct), GST inclusive or exclusive, CGST/SGST vs IGST, and
round-off. Billing, purchases and the receipt all use it.

### Printing
`js/hw/printer.js` speaks ESC/POS over Web Bluetooth (Chrome on Android). Three
transports are available and selectable in the Hardware panel:

1. **Web Bluetooth** — direct to the printer's serial GATT characteristic.
2. **RawBT** — hands raw ESC/POS bytes to the RawBT Android app, for browsers without
   Web Bluetooth.
3. **Browser print** — renders the receipt as HTML and calls `window.print()`.

Receipts print as ESC/POS text (fast and crisp). QR/barcode **stickers** render to a
canvas at printer resolution and print as a raster image, so the layout survives on
both receipt printers and dedicated label printers. Label size is configurable in
Settings; A4 sheet printing is offered as a fallback in the label preview.

> The rupee sign is not in the ESC/POS character set, so printed receipts show `Rs.`
> The on-screen UI uses `₹` throughout.

### Scanner
A Bluetooth scanner paired in **HID / keyboard** mode types the code and sends Enter.
`js/hw/scanner.js` watches keystroke *timing* to tell a scan from human typing, so codes
are captured no matter which field has focus. Pages register a handler with
`setScanHandler()`; anything unhandled opens the Scan screen with the code. A camera
fallback (`BarcodeDetector`) and manual entry are on the Scan screen.

---

## 4. Data model

```
users/{uid}              name, email, role(admin|staff), status, permissions{}
products/{id}            productName, sku, productCode, barcode, categoryId, brand,
                         colour, fabric, size, purchasePrice, sellingPrice, discount,
                         gstRate, stock, minimumStock, supplierId, imageUrl, status
product_variants/{id}    productId, colour, size, sku, barcode, stock, prices
categories/{id}          name, code (used in SKUs), sortOrder, status
customers/{id}           name, mobile, email, address, gstin, totalPurchases, outstanding
suppliers/{id}           name, mobile, email, address, gstin, totalPurchases, outstanding
sales/{id}               invoiceNumber, customerId, staffId, items[], subtotal, discount,
                         taxableAmount, cgst, sgst, igst, tax, roundOff, grandTotal,
                         paymentMethod, paymentStatus, amountReceived, status, profit
purchases/{id}           purchaseNumber, supplierId, items[], totals, amountPaid, status
returns/{id}             returnNumber, type(RETURN|EXCHANGE), saleId, returnedItems[],
                         newItems[], returnValue, refundAmount, differenceAmount, reason
stock_history/{id}       productId, type, quantity, previousStock, newStock,
                         referenceId, referenceNo, userId, createdAt
activity_log/{id}        action, entity, entityId, detail, userId, userName, createdAt
settings/business        shop details, GST, prefixes, printing and selling rules
settings/counters        invoice / purchase / return / sku sequences
```

SKU format: `VYS-SAR-00125` (`skuPrefix` — category `code` — sequence).
Barcodes are EAN-13 style with a valid check digit, generated from the same sequence.

---

## 5. Roles & permissions

**Admin** has everything. **Staff** get billing, scanning, product search, customers and
their own sales by default; everything else is granted per-account from
**Staff → *person* → Permissions**. The same flags are enforced twice: in the UI
(`can()` in `js/store.js`) and in `firestore.rules`.

Two deliberate trade-offs in the rules, both easy to tighten:

* Any active user may **read** `sales` and `purchases`. Restricting reads per-staff at
  the rules level breaks list queries; the app filters staff to their own sales in the
  UI. For a single-shop team this is the usual choice — if you need it enforced, add
  `where("staffId","==",uid)` to the queries and tighten the rule to match.
* Any active user may update a product's `stock` field, because billing has to move
  stock. Everything else on a product needs `products.edit`.

Bills are **never deleted** — they are cancelled, which reverses stock and customer
balances and leaves an audit record.

---

## 6. Hardware

| Item | Requirement |
|---|---|
| Phone | Android, Chrome 90+ (Web Bluetooth needs Chrome; iOS Safari falls back to RawBT/browser print) |
| Scanner | Bluetooth 2D (1D + 2D + QR), **HID / Keyboard mode** |
| Printer | Bluetooth ESC/POS, 58 mm or 80 mm |
| Labels | Optional thermal label printer for adhesive stickers |

Pair both devices in Android's Bluetooth settings first. The scanner then works
immediately. For the printer, open the Hardware panel in the app and tap **Connect** —
Chrome shows its own device picker (this is required and cannot be skipped).

---

## 7. Project layout

```
firebase.json               hosting, rules, emulator config
firestore.rules             role + permission enforcement
firestore.indexes.json      composite indexes
storage.rules               product image / logo upload rules
public/
  index.html                app shell, login screen, boot guard
  manifest.json  sw.js      installable PWA + offline shell cache
  css/styles.css            complete mobile-first stylesheet
  img/icon.svg
  js/
    firebase-config.js      >>> paste your Firebase config here <<<
    app.js                  router, drawer/tab navigation, hardware panel
    auth.js                 login, profile bootstrap, session
    db.js                   Firebase init + all data access
    store.js                live local cache, search, permissions
    ui.js                   toasts, bottom sheets, dialogs, icons
    utils.js                money, dates, SKU/barcode, computeBill()
    codes/codes.js          QR + barcode + sticker canvas rendering
    hw/scanner.js           HID keyboard-wedge capture
    hw/printer.js           ESC/POS builder + Web Bluetooth / RawBT / browser
    hw/documents.js         receipts, label jobs, return slips
    pages/*.js              one module per screen, lazy-loaded by the router
```

---

## 8. Things worth knowing

* **Firestore indexes.** The composite indexes in `firestore.indexes.json` are deployed
  by `firebase deploy`. If you add a query and see an index error in the console,
  Firebase prints a one-click link to create it.
* **CDN libraries.** `qrcodejs` and `JsBarcode` load from cdnjs in `index.html`; the
  Firebase SDK loads from `gstatic` (version pinned in `firebase-config.js`). All three
  are cached by the service worker.
* **Profit reporting** needs purchase prices on products. Purchases write the latest
  landed cost back onto the product automatically. Reports show how much of the data is
  costed so the numbers are never silently misleading.
* **GST** is optional (`Settings → GST`). With a state code configured, customers whose
  GSTIN starts with a different state code are billed IGST instead of CGST+SGST.
* **Product variants** have a collection and rules in place; the current UI models
  colour/size as fields on the product, which is how a boutique usually tags stock. Wire
  `product_variants` into the product editor if you need per-variant stock.
