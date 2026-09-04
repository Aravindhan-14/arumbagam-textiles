/* ============================================================
   VYRA SAREES - authentication & session
   ============================================================ */
import {
  auth, db, C, ref, getDoc, setDoc, updateDoc, getDocs, query, col, limit,
  serverTimestamp, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  sendPasswordResetEmail, logActivity, ensureBlocks
} from "./db.js";
import { startStore, stopStore, state } from "./store.js";

/** Friendly text for Firebase auth error codes. */
export function authMessage(e) {
  const c = e?.code || "";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found"))
    return "Incorrect email or password.";
  if (c.includes("invalid-email")) return "That email address is not valid.";
  if (c.includes("too-many-requests")) return "Too many attempts. Please wait a minute and try again.";
  if (c.includes("network-request-failed")) return "No internet connection. Please check your network.";
  if (c.includes("user-disabled")) return "This account has been disabled.";
  return e?.message || "Something went wrong. Please try again.";
}

export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
}

export async function logout() {
  try { logActivity(null, "LOGOUT", state.user?.email || ""); } catch {}
  stopStore();
  await signOut(auth);
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email.trim());
}

/**
 * Load (or bootstrap) the Firestore profile for a signed-in account.
 * The very first account on a brand-new project becomes the admin;
 * after business settings exist, new accounts land as inactive staff
 * until an admin activates them.
 */
export async function loadProfile(fbUser) {
  const uRef = ref(C.users, fbUser.uid);
  const snap = await getDoc(uRef);
  if (snap.exists()) {
    const data = snap.data();
    return { uid: fbUser.uid, email: fbUser.email, ...data };
  }

  // No profile yet - decide whether this is the bootstrap admin.
  let isFirst = false;
  try {
    const settings = await getDoc(ref(C.settings, "business"));
    if (!settings.exists()) {
      const anyUser = await getDocs(query(col(C.users), limit(1)));
      isFirst = anyUser.empty;
    }
  } catch { /* rules may block the probe - treat as not first */ }

  const profile = {
    name: fbUser.displayName || (fbUser.email || "").split("@")[0],
    email: fbUser.email,
    role: isFirst ? "admin" : "staff",
    status: isFirst ? "active" : "inactive",
    permissions: {},
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await setDoc(uRef, profile);
  return { uid: fbUser.uid, ...profile };
}

/**
 * Wire up the auth listener.
 * onReady(user|null, reason)  reason: "inactive" when the account is disabled.
 */
export function watchAuth(onReady) {
  onAuthStateChanged(auth, async (fbUser) => {
    if (!fbUser) { stopStore(); onReady(null); return; }
    try {
      const profile = await loadProfile(fbUser);
      if ((profile.status || "active") !== "active") {
        await signOut(auth);
        onReady(null, "inactive");
        return;
      }
      await startStore(profile);
      updateDoc(ref(C.users, fbUser.uid), { lastLoginAt: serverTimestamp() }).catch(() => {});
      logActivity(null, "LOGIN", profile.email || "");
      ensureBlocks(["invoice", "sku"]);
      onReady(profile);
    } catch (e) {
      console.error("profile load failed", e);
      onReady(null, "error:" + (e?.message || ""));
    }
  });
}
