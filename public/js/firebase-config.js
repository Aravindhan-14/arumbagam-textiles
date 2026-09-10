/* ============================================================
   VYRA SAREES - Firebase configuration
   ------------------------------------------------------------
   These values come from the Firebase console:
   Project settings > Your apps > Web app > SDK setup and
   configuration > Config.

   The apiKey is not a secret - it only names the project. What
   actually protects the shop's data is firestore.rules and
   storage.rules in the project root.
   ============================================================ */

export const firebaseConfig = {
  apiKey: "AIzaSyDABOdRUV6taJ1bV1P63nRiLGG6ScIG9yM",
  authDomain: "vyra-sarees.firebaseapp.com",
  projectId: "vyra-sarees",
  storageBucket: "vyra-sarees.firebasestorage.app",
  messagingSenderId: "76685008008",
  appId: "1:76685008008:web:e1ab3f58290f103881d33d",
  measurementId: "G-3YMVTQYG1M"
};

/* Firebase JS SDK pulled from Google's CDN, so the app stays a
   plain set of ES modules with no build step. */
export const SDK = "https://www.gstatic.com/firebasejs/12.12.0";
