/* ============================================================
   demo SAREES - Firebase configuration
   ------------------------------------------------------------
   These values come from the Firebase console:
   Project settings > Your apps > Web app > SDK setup and
   configuration > Config.

   The apiKey is not a secret - it only names the project. What
   actually protects the shop's data is firestore.rules and
   storage.rules in the project root.
   ============================================================ */

export const firebaseConfig = {
  apiKey: "AIzaSyCXFhzRJpvJTMvEliiBUYIP_UBV1C_wpr8",
  authDomain: "simple-pos-app-aa312.firebaseapp.com",
  projectId: "simple-pos-app-aa312",
  storageBucket: "simple-pos-app-aa312.firebasestorage.app",
  messagingSenderId: "1015316530659",
  appId: "1:1015316530659:web:ca934ea69b6b309d7f4cd6",
  measurementId: "G-L2W7YM44XN"
};

/* Firebase JS SDK pulled from Google's CDN, so the app stays a
   plain set of ES modules with no build step. */
export const SDK = "https://www.gstatic.com/firebasejs/12.12.0";
