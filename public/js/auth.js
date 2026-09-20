/* ============================================================
   demo SAREES - authentication & session
   ------------------------------------------------------------
   Firebase Auth holds the session, so reopening the app on the
   phone does not ask for the password again. Who a person is
   (admin or staff, and what they may do) lives in their
   users/{uid} profile, which the security rules read on every
   single request - so switching an account off takes effect on
   that person's next tap, everywhere.
   ============================================================ */
import {
  auth, db, C, doc, getDoc, setDoc, updateDoc, getDocs, query, collection, limit,
  serverTimestamp, Timestamp, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  sendPasswordResetEmail, updatePassword, EmailAuthProvider, reauthenticateWithCredential,
  logActivity, ensureBlocks, flushOutbox
} from "./db.js";
import { startStore, stopStore, state } from "./store.js";

const userRef = (uid) => doc(db, C.users, uid);

/** Friendly text for Firebase auth error codes. */
export function authMessage(e) {
  const c = e?.code || "";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found"))
    return "Incorrect email or password.";
  if (c.includes("invalid-email")) return "That email address is not valid.";
  if (c.includes("email-already-in-use")) return "That email address already has an account.";
  if (c.includes("weak-password")) return "Choose a password of at least 6 characters.";
  if (c.includes("too-many-requests")) return "Too many attempts. Please wait a minute and try again.";
  if (c.includes("network-request-failed")) return "No internet connection. Please check your network.";
  if (c.includes("user-disabled")) return "This account has been disabled.";
  if (c.includes("requires-recent-login")) return "Please log out and back in, then try again.";
  if (c.includes("permission-denied")) return "This account is not allowed to open the shop data.";
  return e?.message || "Something went wrong. Please try again.";
}

/**
 * Load (or bootstrap) the Firestore profile for a signed-in account.
 * The very first account on a brand-new project becomes the admin;
 * everybody else is created by the owner from the Staff screen, so an
 * account with no profile is simply not allowed in.
 */
export async function loadProfile(fbUser) {
  const snap = await getDoc(userRef(fbUser.uid));
  if (snap.exists()) {
    const data = snap.data();
    return { ...data, uid: fbUser.uid, email: fbUser.email || data.email || "" };
  }

  // No profile yet - is this the very first account on the project?
  let isFirst = false;
  try {
    const settings = await getDoc(doc(db, C.settings, "business"));
    if (!settings.exists()) {
      const anyUser = await getDocs(query(collection(db, C.users), limit(1)));
      isFirst = anyUser.empty;
    }
  } catch { /* the rules may block the probe - treat as not first */ }

  if (!isFirst) {
    const e = new Error("no-profile");
    e.code = "demo/no-profile";
    throw e;
  }

  const profile = {
    uid: fbUser.uid,
    name: fbUser.displayName || (fbUser.email || "").split("@")[0],
    email: fbUser.email,
    role: "admin",
    status: "active",
    permissions: {},
    createdAt: Timestamp.now(),
    updatedAt: serverTimestamp()
  };
  await setDoc(userRef(fbUser.uid), profile);
  return profile;
}

/* The login form drives the session itself; the auth listener stays out
   of the way while it does, so the store is not started twice. */
let signingIn = false;

export async function login(email, password) {
  signingIn = true;
  try {
    const cred = await signInWithEmailAndPassword(auth, String(email).trim(), password);
    const profile = await loadProfile(cred.user);
    if ((profile.status || "active") !== "active") {
      await signOut(auth);
      const e = new Error("This account is not active yet. Ask the shop owner to activate it.");
      e.code = "demo/inactive";
      throw e;
    }
    return profile;
  } catch (e) {
    signingIn = false;
    if (e?.code === "demo/no-profile") {
      await signOut(auth).catch(() => {});
      const x = new Error("This account has not been set up for the shop yet. Ask the owner to add you under Staff.");
      x.code = "demo/no-profile";
      throw x;
    }
    throw e;
  }
}

export async function logout() {
  try { logActivity("LOGOUT", state.user?.email || ""); } catch { /* going anyway */ }
  stopStore();
  await signOut(auth);
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, String(email).trim());
}

/** Change the signed-in account's own password. */
export async function changePassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  if (!user) throw new Error("You are not signed in.");
  const cred = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, cred);
  await updatePassword(user, newPassword);
}

/** Everything that has to happen once a profile is in hand. */
async function begin(profile, onReady, reason) {
  await startStore(profile);
  updateDoc(userRef(profile.uid), { lastLoginAt: Timestamp.now() }).catch(() => {});
  logActivity(reason === "resumed" ? "SESSION_RESUMED" : "LOGIN", profile.email || "");
  ensureBlocks(["invoice", "sku"]);
  flushOutbox().catch(() => {});
  onReady(profile);
}

/**
 * Wire up the auth listener.
 * onReady(user|null, reason)  reason: "inactive" when the account is disabled.
 */
export function watchAuth(onReady) {
  onAuthStateChanged(auth, async (fbUser) => {
    if (!fbUser) { stopStore(); onReady(null); return; }
    if (signingIn) return;                 // the login form is handling this one

    try {
      const profile = await loadProfile(fbUser);
      if ((profile.status || "active") !== "active") {
        await signOut(auth);
        onReady(null, "inactive");
        return;
      }
      await begin(profile, onReady, "resumed");
    } catch (e) {
      console.error("profile load failed", e);
      if (e?.code === "demo/no-profile") {
        await signOut(auth).catch(() => {});
        onReady(null, "error:This account has not been set up for the shop yet.");
        return;
      }
      onReady(null, "error:" + authMessage(e));
    }
  });
}

/** Called by the login form once login() has returned a profile. */
export async function startSession(profile, onReady) {
  try {
    await begin(profile, onReady, "login");
  } finally {
    signingIn = false;
  }
}

export { state };
