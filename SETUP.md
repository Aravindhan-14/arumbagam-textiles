# VYRA SAREES — Setup Guide

Follow these steps once. It takes about 20 minutes.

---

## Step 1 — Create the Firebase project

1. Go to <https://console.firebase.google.com> and click **Add project**.
   Name it something like `vyra-sarees`. Google Analytics is not needed.
2. In the left menu open **Build → Authentication → Get started**, choose
   **Email/Password**, and enable the first toggle. Save.
3. Open **Build → Firestore Database → Create database**.
   Choose **Production mode** and a location close to you (`asia-south1` for India).
4. Open **Build → Storage → Get started** and accept the defaults.

---

## Step 2 — Register the web app and copy the config

1. Click the gear icon → **Project settings**.
2. Scroll to **Your apps** and click the **web** icon `</>`.
3. Give it a nickname (`VYRA SAREES web`), register the app. **Do not** tick Hosting yet.
4. Firebase shows a `firebaseConfig` object. Copy those values into
   `public/js/firebase-config.js`:

```js
export const firebaseConfig = {
  apiKey:            "AIza…",
  authDomain:        "vyra-sarees.firebaseapp.com",
  projectId:         "vyra-sarees",
  storageBucket:     "vyra-sarees.appspot.com",
  messagingSenderId: "123456789012",
  appId:             "1:123456789012:web:abc123"
};
```

> These values are **not** secrets — they identify the project. Access is controlled by
> the security rules in `firestore.rules`, which this project ships with.

---

## Step 3 — Create the owner's login

In the Firebase console: **Authentication → Users → Add user**.
Enter the shop owner's email and a password (at least 6 characters). Save.

This is the account that becomes the **admin** on first login.

---

## Step 4 — Deploy

```bash
npm install -g firebase-tools
firebase login
cd "D:\vyra sarees"
firebase use --add          # select the project you created, alias: default
firebase deploy
```

This uploads the app, the Firestore rules, the indexes and the Storage rules.
The console prints a **Hosting URL** — that is the shop's app.

**To test locally instead:**

```bash
firebase serve
# then open http://localhost:5000
```

---

## Step 5 — First login and setup

1. Open the Hosting URL on the phone (or laptop) and log in with the account from Step 3.
2. The very first account on a new project automatically becomes the **administrator**.
3. The dashboard shows a **Finish setting up** card. Work through it:

   **a. Settings** — fill in the business name, address, mobile, GSTIN, GST rate,
   invoice prefix and receipt footer. Press **Save Settings**.
   *This is important:* saving closes the one-time bootstrap window in the security
   rules, after which only admins can create admin accounts.

   **b. Categories** — open Categories and tap **Load default boutique categories**
   (Sarees, Silk, Cotton, Designer, Bridal, Chudidars, Kurtis, Blouses, Kids Wear,
   Accessories, Jewellery…), or add your own. The 3–4 letter **code** on each category
   becomes part of the SKU, e.g. `VYS-SAR-00125`.

   **c. Products** — add your first products. Leave SKU, product code and barcode blank
   and the app generates them.

4. **Add to Home screen** from the Chrome menu so it opens like an app.

---

## Step 6 — Add staff

**Staff → Add Staff Member.** Enter a name, email and a temporary password, choose the
role, and tick the permissions they need. The account is created without logging you
out, and they can log in straight away.

Sensible starting permissions for a shop assistant:

| Permission | Give it? |
|---|---|
| Create bills | ✅ yes |
| Process returns & exchanges | ✅ usually |
| Add / edit products | ⬜ owner only |
| Adjust stock | ⬜ owner only |
| Cancel bills | ⬜ owner only |
| Change item price while billing | ⬜ owner only |
| Full business reports | ⬜ owner only |
| Change business settings | ⬜ owner only |

The maximum discount a staff member may apply is set in **Settings → Selling Rules**
(default 10%). Admins have no cap.

---

## Step 7 — Pair the hardware

### Bluetooth 2D scanner

1. Put the scanner into **HID / Keyboard mode**. Most scanners have a setup barcode in
   the manual labelled *"Bluetooth HID"* or *"Keyboard mode"* — scan it.
2. On the phone: **Settings → Bluetooth → Pair new device** and pick the scanner.
3. Open the app, go to **Scan** and scan any product tag. The code appears immediately.

If nothing happens, the scanner is probably in SPP or BLE mode — rescan the HID setup
barcode from its manual.

### Bluetooth thermal printer

1. Pair the printer in Android's Bluetooth settings first.
2. In the app, tap the **hardware icon** in the top-right → **Connect**.
3. Chrome shows its own device picker — choose the printer. (Chrome requires this
   picker every session for security; it cannot be skipped.)
4. Tap **Test print**.

If Connect is greyed out, the browser has no Web Bluetooth. Install **RawBT** from the
Play Store and set the print mode to **RawBT app** in the same panel.

Set the paper width (58 mm or 80 mm) in **Settings → Printing**.

---

## Step 8 — Print product labels

1. Go to **QR / Barcode Labels**.
2. Choose QR or barcode, then scan or tap products to add them. Each product defaults
   to one label per piece in stock; adjust the quantity per product.
3. **Preview** to check the layout, then **Print**.

Label size is set in **Settings → Printing** (default 50 × 25 mm). If you do not have a
label printer, the preview's **Print on A4** button lays the labels out on sticker sheets.

---

## Daily use

```
Staff logs in
  → New Bill
  → scan tags (they drop straight into the cart)
  → adjust quantity / discount
  → attach the customer (needed for credit)
  → Payment → method, amount received
  → Save & Print
```

Stock decreases automatically, the sale is recorded, the customer's outstanding balance
updates, and the bill prints. If the network is down it all still works and syncs later.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Stuck on the loading screen | `js/firebase-config.js` still has the placeholder values, or the browser console shows a Firebase error |
| "Missing or insufficient permissions" | The user's `users/{uid}` profile is missing, `status` is not `active`, or the rules were not deployed (`firebase deploy --only firestore:rules`) |
| Login says the account is not active | An admin must open **Staff** and tick *Account active* |
| A query fails with an index error | Click the link Firebase prints in the console, or run `firebase deploy --only firestore:indexes` |
| Scanner types into the search box but nothing is found | The code is not on any product — check the barcode field, or scan from the Scan screen and use *Add a product with this code* |
| Camera scan does nothing | Must be served over **https** (the hosted URL) or `localhost` — a plain `http://192.168.x.x` address blocks the camera. Allow the camera permission from the padlock icon |
| Camera opens but never reads the code | It falls back to jsQR automatically after ~4s, which reads **QR only**. Print QR labels rather than barcodes for camera use, or use the Bluetooth scanner for 1D barcodes |
| Printer connects but prints nothing | Try the other paper width; some printers need `Escpos` chunk delays — increase `CHUNK`/delay in `js/hw/printer.js` |
| Receipt shows `Rs.` instead of `₹` | Expected: the rupee sign is not in the ESC/POS character set |
| Invoice numbers run out offline | Go online once; the app reserves 25 at a time (see the Hardware panel) |

---

## Backing up

Firestore holds the live data. For scheduled backups enable
**Firestore → Backups** in the Firebase console, or export on demand:

```bash
gcloud firestore export gs://YOUR-BUCKET/backups/$(date +%F)
```

Every list screen in the app also has an **Export CSV** button (products, stock, sales,
customers, suppliers, purchases, reports, activity log).
