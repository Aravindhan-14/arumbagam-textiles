# demo SAREES — Boutique Billing, Inventory & Sales Management

A mobile-first web application for the day-to-day running of a saree and boutique shop:
products, stock, QR/barcode labels, billing on the phone, wired USB printing of bills
and stickers, purchases, customers, suppliers, returns, GST and reports.

**Stack:** plain HTML / CSS / JavaScript (ES modules, no build step) talking straight to
**Firebase** — Firestore for the data, Firebase Auth for the logins, Cloud Storage for
the photos. There is no server of our own to run and no database to install. The
Firestore SDK keeps a copy of everything on the device, so the counter keeps billing
when the Wi-Fi drops and syncs when it returns.

**Primary device:** the shop PC in Chrome for printing, plus any phone on the shop
Wi-Fi for billing. The printers (a TVS LP 46 Lite label printer, an ESC/POS receipt
printer, or both) plug into the PC by USB; the scanner is an HID keyboard-wedge.

---

## 1. Quick start

```bash
# 1. In the Firebase console for project "demo-sarees":
#      Authentication -> Email/Password -> Enable
#      Firestore Database -> Create
#      Storage -> Get started            (photos only; optional)

# 2. Publish the security rules - this is what protects the shop's data
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules,firestore:indexes,storage

# 3. Open the app on the shop PC
node tools/serve.js                 # http://localhost:5000
```

Or double-click **`START demo SAREES.bat`**, which does the last step and opens the
browser for you.

Create the owner's login in **Authentication → Users → Add user**, sign in with it, and
save Settings — the first account to log in on an unconfigured project becomes the
administrator. Everybody else is added from **Staff**.

`firebase deploy --only hosting` publishes the app to `https://demo-sarees.web.app`, and
then no PC in the shop needs to be running at all.

Full step-by-step instructions are in **[SETUP.md](SETUP.md)**.

---

## 2. What is in the box

| Area | Covered by |
|---|---|
| Firebase bootstrap, all data access | `public/js/db.js` |
| Login, session, profiles | `public/js/auth.js`, `public/js/pages/staff.js` |
| Who may see and do what | `firestore.rules`, `public/js/store.js` |
| Live local cache and search | `public/js/store.js` |
| Dashboard, alerts, quick actions | `public/js/pages/dashboard.js` |
| Products, SKU, images, QR, barcode | `public/js/pages/products.js`, `pages/_shared.js`, `codes/codes.js` |
| Scanning (HID scanner + camera) | `public/js/hw/scanner.js`, `pages/scan.js` |
| Billing / POS, GST, payments | `public/js/pages/billing.js`, `computeBill()` in `js/utils.js` |
| Printing (bills, labels) | `public/js/hw/printer.js`, `hw/paper.js`, `hw/documents.js`, `tools/print.ps1` |
| Inventory, adjustments, history | `public/js/pages/inventory.js` |
| Purchases, suppliers, customers | `public/js/pages/purchases.js`, `suppliers.js`, `customers.js` |
| Returns & exchanges | `public/js/pages/returns.js` |
| Sales history, reprint, cancel | `public/js/pages/sales.js` |
| Reports (sales, GST, profit, stock) | `public/js/pages/reports.js` |
| Audit log | `public/js/pages/activity.js` |
| Local http address + print bridge | `tools/serve.js`, `tools/print.ps1` |

---

## 3. Architecture notes

### No middle tier
The browser is the client. `public/js/db.js` is the only module that touches Firebase;
every page goes through it. What would normally be server-side authorisation lives in
`firestore.rules`, which Firebase evaluates on **every** read and write against the
caller's live `users/{uid}` profile — so switching an account off or revoking a
permission takes effect on that person's next tap, not at their next login.

### The cost wall
This is the part worth reading carefully. Purchase price, margin, profit, supplier and
stock value belong to the owner. The design makes it structural rather than cosmetic:

1. **The cost is not on the product.** `products/{id}` carries the selling price only.
   What the shop paid lives in `product_costs/{productId}`.
2. **`firestore.rules` opens that collection to admins alone**, and does the same for
   `suppliers` and `purchases`. A staff device asking for them gets permission-denied,
   so the numbers are never in the payload, never in the device's cache, and not in the
   browser's dev tools either.
3. **Bills do not carry cost.** A sale records what was charged. Profit is worked out
   for the owner, on the owner's device, against the cost on file
   (`lineProfit()` in `pages/reports.js`).
4. `cost.view`, `purchases.manage` and `suppliers.manage` are in `ADMIN_ONLY` in
   `public/js/store.js`, so `can()` returns false for them even if the flag is set to
   `true` on a staff profile. There is no way to grant them.

`canSeeCost()` and `costOf()` in `store.js` decide what the UI draws — but the rules are
what decide what the device is given.

### Everything a bill touches, in one batch
Saving a bill writes the sale, moves stock on every line, appends a stock-history row
per line, updates the customer's balance and logs the activity — as a single Firestore
`writeBatch`, so a half-saved bill is not a state the data can be in. Purchases, returns
and stock adjustments work the same way. Stock arithmetic uses `increment()` rather than
read-then-write, so two tills selling the same item cannot overwrite each other's count.

### Live local cache, instant search
Products, categories, customers and (for the owner) suppliers are mirrored into memory
by `public/js/store.js`. Every search, scan look-up and filter runs against that mirror,
so results are instant. Each mirror is a Firestore **listener**, not a poll: the first
callback comes from the on-device cache within a tick, and after that only what actually
changed is fetched — a price edit on the till appears on the phone by itself. The last
good copy is also kept in `localStorage`, so the product list opens on a cold start with
no network at all.

### Offline billing without duplicate invoices
* **Invoice numbers** are drawn from a block reserved ahead of time
  (`reserveBlock`/`takeSequence` in `public/js/db.js`). The block is cut from a shared
  counter document inside a Firestore transaction and held in `localStorage`, so two
  phones can never mint the same number, online or off.
* **Bills** made with no network are applied to the device's own copy immediately and
  replayed by the Firestore SDK when the connection returns. A write is never awaited
  past a few seconds (`settle()` in `db.js`), because a Firestore write promise only
  settles on the server's acknowledgement — the till must not wait for that.

The Hardware panel (top-right of the app bar) shows the reserve and anything still
waiting to sync.

### Dates
Firestore hands back `Timestamp` objects; `db.js` converts them to ISO strings on the
way out, so the rest of the app only ever deals with ordinary JavaScript dates.
Documents are stamped with a client `createdAt` *and* a server `serverCreatedAt`: the
client one is what date filters and ordering use, so a bill written offline is in
today's list straight away.

### Bill maths
`computeBill()` in `public/js/utils.js` is the single source of truth for pricing. It
handles per-line discounts, a bill-level discount spread proportionally across lines (so
per-line GST stays correct), GST inclusive or exclusive, CGST/SGST vs IGST, and
round-off. Billing, purchases and the receipt all use it.

GST has two switches: **Settings → GST → Charge GST on bills** for the shop, and a
**GST on / off** button on the billing screen for one bill. The bill stores the flag it
was raised with, so a reprint months later prints exactly what the customer got.

### Printing
The printers are wired to the shop PC by USB, so the browser cannot reach them on its
own. `tools/serve.js` carries a small **print bridge** (`/api/print/*`) that hands jobs
to the Windows spooler through `tools/print.ps1`. Because the bridge lives in the same
server that serves the app, a phone on the shop Wi-Fi prints on the shop's printer too.

Modes, in the Printer panel:

1. **Wired printer** (default) — the page is drawn as artwork at print resolution and
   printed through the printer's own Windows driver, at an exact page size in
   millimetres. No dialog and no pop-up, and it works on any printer Windows can
   already print to — including a label printer such as the **TVS LP 46 Lite**, which
   does not understand ESC/POS at all.
2. **Raw ESC/POS** — a tick box for receipt printers that prefer the bytes untouched;
   they go straight down the wire with no driver in the way.
3. **Browser print** — for when the app is opened away from the shop PC (the hosted
   address, a phone, a shared port). Labels are laid into the page itself at the exact
   row size and `window.print()` is called: no pop-up window to be blocked, and no
   `about:blank` in the header. The print box still has to be set to the label paper
   with no margins, no scaling and headers off - the app shows that list first.

Bills and stickers share one layout. `hw/documents.js` writes the receipt once against
a builder interface, and either builder can carry it: `Escpos` in `hw/printer.js` emits
ESC/POS bytes, `PaperDoc` in `hw/paper.js` paints the same document onto a canvas at
203 dpi for the driver.

QR/barcode **stickers** are always artwork. The roll carries several stickers side by
side, so the page the printer feeds is a whole **row** - the same product's sticker
repeated across it (`labelRowCanvas()` in `codes/codes.js`). With the shop's two-up
roll, a run of ten labels is five rows of two. **Labels across the roll** and the gap
between them are in Settings > Printing; **Turn labels on the roll** rotates the
artwork 90/180/270° for a roll that feeds the other way.

Bills and labels can go to **different printers** — stickers to the label printer,
bills to the receipt printer — chosen in the Printer panel.

> The rupee sign is not in the ESC/POS character set, so printed bills show `Rs.`
> The on-screen UI uses `₹` throughout.

### Scanner
A scanner in **HID / keyboard** mode - USB or wireless - types the code and sends Enter.
`public/js/hw/scanner.js` watches keystroke *timing* to tell a scan from human typing, so
codes are captured no matter which field has focus. Pages register a handler with
`setScanHandler()`; anything unhandled opens the Scan screen with the code. A camera
fallback (`BarcodeDetector`) and manual entry are on the Scan screen.

---

## 4. Data model

Firestore collections. Field names are the same ones the browser works with.

```
users            uid, name, email, role(admin|staff), status, permissions{}
products         productName, sku, productCode, barcode, categoryId, brand, colour,
                 fabric, size, sellingPrice, discount, gstRate, stock, minimumStock,
                 imageUrl, status, search[]
product_costs *  productId, purchasePrice, supplierId, supplierName
categories       name, code (used in SKUs), sortOrder, status
customers        name, mobile, email, address, gstin, totalPurchases, outstanding
suppliers     *  name, mobile, email, address, gstin, totalPurchases, outstanding
sales            invoiceNumber, customerId, staffId, items[], subtotal, discount,
                 taxableAmount, cgst, sgst, igst, tax, roundOff, grandTotal,
                 paymentMethod, paymentStatus, amountReceived, gstEnabled, status
purchases     *  purchaseNumber, supplierId, items[], totals, amountPaid, status
returns          returnNumber, type(RETURN|EXCHANGE), saleId, returnedItems[],
                 newItems[], returnValue, refundAmount, differenceAmount, reason
stock_history    productId, type, quantity, previousStock, newStock, referenceId, userId
activity_log     action, entity, entityId, detail, userId, userName, createdAt
settings/business  the shop settings
settings/counters  invoice / purchase / return / sku sequence positions
```

`*` marks the collections `firestore.rules` opens to the admin only — see *The cost
wall*. Note what is **not** in `products` or in `sales.items`: a purchase price.

SKU format: `VYS-SAR-00125` (`skuPrefix` — category `code` — sequence).
Barcodes are EAN-13 style with a valid check digit, generated from the same sequence.

Composite indexes are declared in `firestore.indexes.json` and deployed with the rules.

---

## 5. Roles & permissions

**Admin** has everything.

**Staff** start with the counter work only — create bills, the product list at selling
price, customers, print labels. Everything else is granted per account from
**Staff → *person* → Permissions**: stock, returns, reports, categories, settings,
cancelling bills, changing a price while billing, seeing other staff's sales.

Purchase price, margin, profit, suppliers and purchases have no permission at all — see
*The cost wall* above.

The same rules live in two places: `firestore.rules` decides what a device is allowed to
read and write, `public/js/store.js` decides what the UI bothers to draw. The rules are
authoritative and are re-evaluated on every request.

Staff accounts are created from the app: `createUser()` in `db.js` mints the Firebase
Auth account through a second, throwaway app instance, so the owner's own session is
never disturbed. A forgotten password is reset by email — **Staff → Send a password
reset email**, or **Forgot password?** on the login screen.

Bills are **never deleted** — they are cancelled, which reverses stock and customer
balances and leaves an audit record.

---

## 6. Hardware

| Item | Requirement |
|---|---|
| Billing PC | Windows 10 or later, Node.js, Chrome. The printers plug in here. |
| Phone | Any phone on the shop Wi-Fi, Chrome or Safari — it prints through the PC |
| Scanner | 2D (1D + 2D + QR) in **HID / Keyboard mode**, USB or wireless |
| Label printer | USB, with its Windows driver installed — e.g. TVS LP 46 Lite |
| Receipt printer | USB ESC/POS, 58 mm or 80 mm (optional) |

Plug each printer in, install the driver that came with it, and print a Windows test
page once so Windows is happy. Then open the app on that PC, tap the printer icon in
the top bar, tap **Find printers**, and choose which printer takes the bills and which
takes the labels. **Test print** proves the whole path.

Nothing needs pairing, and no printer needs Bluetooth — the TVS LP 46 Lite has none.

---

## 7. Project layout

```
firebase.json               hosting, rules and emulator configuration
.firebaserc                 the project this deploys to (demo-sarees)
firestore.rules             who may read and write what - the real access control
firestore.indexes.json      composite indexes the reports need
storage.rules               product photos and the shop logo

tools/
  serve.js                  dependency-free static server + the print bridge
  print.ps1                 hands print jobs to the Windows spooler

public/
  index.html                app shell, login screen, boot guard
  manifest.json  sw.js      installable PWA + offline shell cache
  css/styles.css            complete mobile-first stylesheet
  js/
    firebase-config.js      the Firebase project settings and SDK version
    db.js                   Firebase bootstrap, all reads and writes, number blocks
    auth.js                 login, session, profiles, password changes
    app.js                  router, drawer/tab navigation, hardware panel
    store.js                live local cache, search, permissions, cost wall
    ui.js                   toasts, bottom sheets, dialogs, icons
    utils.js                money, dates, SKU/barcode, computeBill()
    codes/codes.js          QR + barcode + sticker canvas rendering
    hw/scanner.js           HID keyboard-wedge capture
    hw/printer.js           wired transport (print bridge) + ESC/POS builder
    hw/paper.js             the same documents painted as artwork for the driver
    hw/documents.js         receipts, label jobs, return slips
    pages/*.js              one module per screen, lazy-loaded by the router
```

---

## 8. Things worth knowing

* **Nothing in the shop has to be running.** Deploy to Firebase Hosting and the app is
  a URL; `START demo SAREES.bat` is only for running it off the shop PC.
* **The rules are the security.** The Firebase `apiKey` in `firebase-config.js` is not a
  secret — it only names the project. Re-run
  `firebase deploy --only firestore:rules,storage` after any rules change.
* **Backups.** Firestore holds the data; for a copy of your own, export any screen to
  CSV from Reports, or schedule a Firestore export in the Google Cloud console.
* **Reads cost money.** That is why the mirrors are listeners rather than a poll, and
  why the app never re-reads a whole collection on a timer. Keep it that way.
* **CDN libraries.** The Firebase SDK loads from `gstatic.com`; `qrcodejs` and
  `JsBarcode` from cdnjs. All are cached by the service worker after the first open.
* **Profit reporting** needs purchase prices. Set them on the product (owner only), or
  record a purchase — which writes the latest landed cost back automatically. Reports
  show how much of the data is costed so the numbers are never silently misleading.
* **GST** is optional per shop and per bill. With a state code configured, customers
  whose GSTIN starts with a different state code are billed IGST instead of CGST+SGST.
* **Cloud Storage needs the Blaze plan** on new Firebase projects. Everything except
  product photos and the shop logo works without it.
