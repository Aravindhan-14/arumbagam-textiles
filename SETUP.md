# demo SAREES — Setup

The shop's data lives in **Firebase** (project `demo-sarees`): Firestore holds
the products, bills and customers, Firebase Auth holds the logins, and Cloud
Storage holds the photos. There is no database to install and no server to
run — the phone or the till talks to Firebase directly, and keeps working
from its own on-device copy when the Wi-Fi drops.

---

## 1. What you need once

| | |
|---|---|
| **A Firebase project** | Already created: `demo-sarees`. Its settings are in `public/js/firebase-config.js`. |
| **Node.js 18 or newer** | <https://nodejs.org> — only to open the app on `http://localhost` on the shop PC, and to publish updates. |

Check Node is there:

```bash
node -v
```

---

## 2. Turn on the three Firebase services

In the [Firebase console](https://console.firebase.google.com) for
**demo-sarees**:

1. **Build → Authentication → Get started → Sign-in method →
   Email/Password → Enable.**
2. **Build → Firestore Database → Create database →** production mode, region
   `asia-south1` (Mumbai).
3. **Build → Storage → Get started** (same region). This needs the Blaze plan
   on new projects; if you skip it, everything works except product photos and
   the shop logo.

---

## 3. Publish the rules

The rules are what actually protect the shop — they decide who may read what,
and they are the reason staff never receive cost prices. Install the Firebase
CLI once:

```bash
npm install -g firebase-tools
firebase login
```

Then, from the project folder:

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
```

Run this again any time `firestore.rules`, `firestore.indexes.json` or
`storage.rules` changes.

---

## 4. Create the owner's account

1. Start the app (below) and open it.
2. On the login screen there is no sign-up: create the first account in the
   console — **Authentication → Users → Add user** — with the owner's email
   and a password.
3. Log in with it. The **first** account to log in while the shop settings are
   still empty becomes the **administrator** automatically.
4. Go to **Settings**, fill in the shop details and press **Save Settings**.
   That closes the window: no later account can make itself an admin.

Every other person is added by the owner from **Staff → Add Staff Member**,
which creates their login and their permissions in one step.

> Use an email address each person can actually open. A forgotten password is
> reset with an email link — the owner can send one from **Staff**, and the
> person can use **Forgot password?** on the login screen themselves.

---

## 5. Start the app in the shop

Double-click **`START demo SAREES.bat`**. It serves the `public` folder on
port 5000 and opens the browser:

```
This PC          http://localhost:5000
Phone / tablet   http://<the PC's IP>:5000
```

Keep the black window open while the shop is billing. Phones on the same
Wi-Fi can use the address it prints.

To run it by hand:

```bash
node tools/serve.js
```

---

## 6. Connect the printer

The printers plug into the billing PC by **USB** - nothing here needs
Bluetooth, and the TVS LP 46 Lite has none.

1. Plug the printer in and install the driver that came with it (or the one
   from the maker's site). Print a **Windows test page** once, from
   Settings > Printers & scanners, so Windows is happy with it.
2. Load the label roll and set the **row size** in the driver's preferences:
   for a two-up roll of 50 x 25 mm stickers that is **100 x 25 mm** - the
   printer feeds one whole row at a time, not one sticker. Setting it to one
   sticker is what squeezes both labels into one, at half size.
3. Open the app **on that PC** with `START demo SAREES.bat`.
4. Tap the printer icon in the top bar > **Find printers**, then choose
   which printer takes the **bills** and which takes the **labels**. They can
   be the same printer or two different ones.
5. Tap **Test print**.

Then, in **Settings > Printing**, set the size of **one** sticker (50 x 30 mm),
**Labels across the roll** (2 for the shop's roll) and the gap between them.
One printed row is then two stickers of the same product, so ten labels come
out as five rows. If the stickers come out sideways, set **Turn labels on the
roll** to 90°. Bill width is separate: 58 mm, 80 mm, or 100 mm for a 4 inch roll.

**Test label row** prints one row of real stickers, and **Print size test**
prints the same row carrying a ruler: hold a tape against it and it says
straight away whether the printer is putting the row out at its true size.

### Printing without the black window

The wired path needs the app opened from the shop PC's own address. When it
is opened from anywhere else - the hosted address, a phone, a shared port -
printing falls back to the **browser's own print box**, and the labels are
laid into the page at the exact row size. Nothing else is needed, but the
print box has to be set once (the browser then remembers it per printer):

* **Printer** - the label printer
* **Paper size** - the label stock, i.e. one printed row
* **Margins** - None, **Scale** - 100 (Default)
* **Headers and footers** - unticked (otherwise `about:blank` and the date
  print on the sticker, and the artwork is shrunk to make room)

The app shows this list before it opens the print box.

Bills go out as artwork through the printer's own Windows driver, which is
what lets one printer handle both the bill and the barcode stickers. If the
bills are going to an ESC/POS receipt printer and you would rather send it
the raw bytes, tick **Send bills as raw ESC/POS** in the printer panel.

Phones on the shop Wi-Fi print on the shop's printer too, as long as they
open the `http://<the PC's IP>:5000` address that the black window prints -
the print jobs travel through the PC.

---

## 7. Or put it online (recommended)

Firebase Hosting gives the shop a proper address that works from anywhere —
home, a second shop, a phone on mobile data — with no PC left running:

```bash
firebase deploy --only hosting
```

The app is then at `https://demo-sarees.web.app`. Add it to the phone's home
screen and it behaves like an installed app.

One thing to know: the hosted address has no wired printing, because the
print bridge runs on the shop PC. Opened from the hosted address, printing
falls back to the browser's print dialog. For silent printing, open the app
from the PC's own `http://localhost:5000` address.

---

## 8. Day-to-day

| | |
|---|---|
| **Offline** | Billing continues with no network. Bills are held on the device and sent as soon as it returns. The invoice numbers are reserved in advance, so two tills can never mint the same number. |
| **Backup** | Firestore keeps the data; for a copy of your own, export any screen to CSV from Reports. |
| **Cost prices** | Purchase price, supplier, margin, profit and stock value are the owner's alone. They are stored in a separate collection that the rules do not open to staff, so a staff phone is never sent them at all. |
| **GST** | Settings has a master **Charge GST on bills** switch, and the billing screen has a per-bill **GST on / off** button for a single estimate or a no-GST customer. |

---

## 9. If something is wrong

| Symptom | Cause |
|---|---|
| Spins on "Still starting…" | The first open needs the internet. After that it works offline. |
| "Missing or insufficient permissions" | The rules are not published yet — see step 3. |
| Login works but the app says the account is not set up | That Auth user has no profile. Add them from **Staff**, or, if this is the very first account, save Settings while logged in as them. |
| Photos do not upload | Cloud Storage is not enabled — see step 2. Everything else still works. |
| A report says an index is needed | Run the deploy in step 3, or click the link in the browser console. |
| Printing opens a dialog instead of just printing | The app was opened from the hosted address, or from another device. Open it on the billing PC. |
| "No wired printer found" | The black window is not running, or the app was opened from a different address than the one it prints. Start it with `START demo SAREES.bat`, then tap **Find printers**. |
| "The demo SAREES window is an older version" | A black window from before this update is still running. Close it and double-click `START demo SAREES.bat` again - it now replaces an old one by itself. Then reload the page with **Ctrl+Shift+R**. |
| Labels come out sideways with `about:blank` printed on them | The print box's paper settings are wrong. Set Paper size to the label stock, Margins to None, Scale to 100, and untick Headers and footers. |
| Labels print at the wrong size | The driver's paper size must be the **row** (102 x 30 mm for a two-up roll of 50 x 30 stickers), while **Settings > Printing** holds one sticker's size plus how many are across. |
| Stickers come out sideways | Set **Turn labels on the roll** to 90° in Settings > Printing, and check the driver's preferences are set to portrait. |
| Only one sticker of each pair prints | **Labels across the roll** is still 1. Set it to 2. |
| The bill prints as gibberish | A label printer was sent raw ESC/POS. Untick **Send bills as raw ESC/POS** in the printer panel. |
