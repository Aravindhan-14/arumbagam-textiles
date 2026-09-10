# VYRA SAREES — Setup

The shop's data lives in **Firebase** (project `vyra-sarees`): Firestore holds
the products, bills and customers, Firebase Auth holds the logins, and Cloud
Storage holds the photos. There is no database to install and no server to
run — the phone or the till talks to Firebase directly, and keeps working
from its own on-device copy when the Wi-Fi drops.

---

## 1. What you need once

| | |
|---|---|
| **A Firebase project** | Already created: `vyra-sarees`. Its settings are in `public/js/firebase-config.js`. |
| **Node.js 18 or newer** | <https://nodejs.org> — only to open the app on `http://localhost` on the shop PC, and to publish updates. |

Check Node is there:

```bash
node -v
```

---

## 2. Turn on the three Firebase services

In the [Firebase console](https://console.firebase.google.com) for
**vyra-sarees**:

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

Double-click **`START VYRA SAREES.bat`**. It serves the `public` folder on
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

## 6. Or put it online (recommended)

Firebase Hosting gives the shop a proper address that works from anywhere —
home, a second shop, a phone on mobile data — with no PC left running:

```bash
firebase deploy --only hosting
```

The app is then at `https://vyra-sarees.web.app`. Add it to the phone's home
screen and it behaves like an installed app.

---

## 7. Day-to-day

| | |
|---|---|
| **Offline** | Billing continues with no network. Bills are held on the device and sent as soon as it returns. The invoice numbers are reserved in advance, so two tills can never mint the same number. |
| **Backup** | Firestore keeps the data; for a copy of your own, export any screen to CSV from Reports. |
| **Cost prices** | Purchase price, supplier, margin, profit and stock value are the owner's alone. They are stored in a separate collection that the rules do not open to staff, so a staff phone is never sent them at all. |
| **GST** | Settings has a master **Charge GST on bills** switch, and the billing screen has a per-bill **GST on / off** button for a single estimate or a no-GST customer. |

---

## 8. If something is wrong

| Symptom | Cause |
|---|---|
| Spins on "Still starting…" | The first open needs the internet. After that it works offline. |
| "Missing or insufficient permissions" | The rules are not published yet — see step 3. |
| Login works but the app says the account is not set up | That Auth user has no profile. Add them from **Staff**, or, if this is the very first account, save Settings while logged in as them. |
| Photos do not upload | Cloud Storage is not enabled — see step 2. Everything else still works. |
| A report says an index is needed | Run the deploy in step 3, or click the link in the browser console. |
