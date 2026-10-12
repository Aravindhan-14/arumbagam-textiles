/* ============================================================
   ARUMBAGAM - Firebase configuration
   ------------------------------------------------------------
   These values come from the Firebase console:
   Project settings > Your apps > Web app > SDK setup and
   configuration > Config.

   The apiKey is not a secret - it only names the project. What
   actually protects the shop's data is firestore.rules and
   storage.rules in the project root.
   ============================================================ */

export const firebaseConfig = {
  apiKey: "AIzaSyAdwpDQcAhverr3K3oHRFd7Ai7CPpR6DfQ",
  authDomain: "arumbagam-clothing-store.firebaseapp.com",
  databaseURL: "https://arumbagam-clothing-store-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "arumbagam-clothing-store",
  storageBucket: "arumbagam-clothing-store.firebasestorage.app",
  messagingSenderId: "542790950641",
  appId: "1:542790950641:web:46a74aa39efbc8f0b35350",
  measurementId: "G-9H43ZCYQ17"
};

/* Firebase JS SDK pulled from Google's CDN, so the app stays a
   plain set of ES modules with no build step. */
export const SDK = "https://www.gstatic.com/firebasejs/12.12.0";
