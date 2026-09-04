/* ============================================================
   VYRA SAREES - Staff & access control
   ============================================================ */
import { state, can, isAdmin } from "../store.js";
import { C, col, getDocs, query, orderBy, ref, setDoc, updateDoc, serverTimestamp, logActivity, sendPasswordResetEmail, auth } from "../db.js";
import { firebaseConfig, SDK } from "../firebase-config.js";
import { icon, openSheet, emptyState, ok, err, warn, busy, confirmDialog, formData, toast } from "../ui.js";
import { esc, fmtDateTime, validEmail, ago } from "../utils.js";

export const title = "Staff";

/* Permissions a staff member can be granted. Admin always has everything. */
const PERMS = [
  ["sales.create", "Create bills", true],
  ["sales.viewAll", "See all staff's sales", false],
  ["sales.cancel", "Cancel bills", false],
  ["sales.editPrice", "Change item price while billing", false],
  ["products.create", "Add products", false],
  ["products.edit", "Edit products", false],
  ["products.delete", "Delete products", false],
  ["categories.manage", "Manage categories", false],
  ["inventory.adjust", "Adjust stock", false],
  ["purchases.manage", "Record purchases", false],
  ["suppliers.manage", "Manage suppliers", false],
  ["returns.create", "Process returns & exchanges", false],
  ["reports.full", "See full business reports", false],
  ["settings.manage", "Change business settings", false],
  ["staff.manage", "Manage staff", false]
];

export async function mount(view, { go }) {
  if (!can("staff.manage")) { view.innerHTML = emptyState("Not permitted", "Only the shop owner can manage staff", "alert"); return; }

  const load = async () => {
    view.innerHTML = `<div class="empty">${icon("clock")}<b>Loading…</b></div>`;
    let users = [];
    try {
      const snap = await getDocs(query(col(C.users), orderBy("name")));
      users = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    } catch (e) {
      try {
        const snap = await getDocs(col(C.users));
        users = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
      } catch (e2) { view.innerHTML = emptyState("Could not load staff", e2.message, "alert"); return; }
    }

    view.innerHTML = `
      <button class="btn btn-primary btn-block mb" id="st-add">${icon("plus")} Add Staff Member</button>
      <ul class="list card pad0">
        ${users.map((u) => `
          <li class="row" data-uid="${u.uid}">
            <div class="thumb">${esc((u.name || u.email || "?").slice(0, 2).toUpperCase())}</div>
            <div class="mid"><b>${esc(u.name || u.email)}${u.uid === state.user?.uid ? ' <span class="pill info">You</span>' : ""}</b>
              <small>${esc(u.email || "")}${u.lastLoginAt ? " · seen " + ago(u.lastLoginAt) : ""}</small></div>
            <div class="end">
              <small class="pill ${u.role === "admin" ? "info" : "mut"}">${esc(u.role || "staff")}</small>
              <small class="pill ${(u.status || "active") === "active" ? "ok" : "danger"}">${esc(u.status || "active")}</small>
            </div>
          </li>`).join("")}
      </ul>
      <p class="form-note mt">Staff accounts are created with an email and password. Ask each person to change their password after the first login.</p>`;

    view.querySelector("#st-add").onclick = () => addStaff(load);
    view.querySelectorAll("[data-uid]").forEach((li) => {
      li.onclick = () => staffSheet(users.find((u) => u.uid === li.dataset.uid), load);
    });
  };

  await load();
}

/* ============================================================
   Create a staff account
   ============================================================ */
function addStaff(onDone) {
  openSheet({
    title: "Add Staff Member",
    body: `
      <label class="field req"><span>Full name</span><input name="name" required></label>
      <label class="field req"><span>Email (used to log in)</span><input name="email" type="email" required></label>
      <label class="field req"><span>Temporary password</span>
        <input name="password" type="text" value="${suggestPassword()}" minlength="6" required></label>
      <p class="form-note">Share this password with the staff member. They can change it later from the login screen.</p>
      <label class="field"><span>Role</span>
        <select name="role"><option value="staff">Staff</option><option value="admin">Administrator</option></select></label>
      <div class="sec-title">Permissions</div>
      ${PERMS.map(([k, label, def]) => `<label class="check">
        <input type="checkbox" name="perm:${k}" ${def ? "checked" : ""}><span>${esc(label)}</span></label>`).join("")}
      <div id="sa-err" class="form-error hidden"></div>`,
    footer: `<button class="btn btn-soft" data-close>Cancel</button>
             <button class="btn btn-primary" id="sa-save">Create account</button>`,
    onMount(api) {
      const fail = (m) => { const b = api.root.querySelector("#sa-err"); b.textContent = m; b.classList.remove("hidden"); };
      api.root.querySelector("#sa-save").onclick = async () => {
        const d = formData(api.root);
        if (!d.name.trim()) return fail("Name is required.");
        if (!validEmail(d.email)) return fail("Enter a valid email address.");
        if ((d.password || "").length < 6) return fail("Password must be at least 6 characters.");

        let secondary = null;
        try {
          busy(true, "Creating account…");
          /* A second Firebase app keeps the owner signed in while the new
             account is created. */
          const { initializeApp, deleteApp } = await import(`${SDK}/firebase-app.js`);
          const { getAuth, createUserWithEmailAndPassword, signOut } = await import(`${SDK}/firebase-auth.js`);
          secondary = initializeApp(firebaseConfig, "vyra-staff-" + Date.now());
          const sAuth = getAuth(secondary);
          const cred = await createUserWithEmailAndPassword(sAuth, d.email.trim(), d.password);

          const permissions = {};
          PERMS.forEach(([k]) => { permissions[k] = !!d["perm:" + k]; });

          await setDoc(ref(C.users, cred.user.uid), {
            name: d.name.trim(), email: d.email.trim().toLowerCase(),
            role: d.role, status: "active", permissions,
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
            createdBy: state.user?.uid || ""
          });
          logActivity(null, "STAFF_ADDED", `${d.name} (${d.email})`, "user", cred.user.uid);

          await signOut(sAuth);
          await deleteApp(secondary); secondary = null;

          api.close();
          ok(`${d.name} can now log in`);
          onDone();
        } catch (e) {
          const c = e?.code || "";
          fail(c.includes("email-already-in-use") ? "That email already has an account."
            : c.includes("weak-password") ? "Choose a stronger password."
              : e.message || "Could not create the account.");
          if (secondary) { try { const { deleteApp } = await import(`${SDK}/firebase-app.js`); await deleteApp(secondary); } catch {} }
        } finally { busy(false); }
      };
    }
  });
}

/* ============================================================
   Edit an existing staff member
   ============================================================ */
function staffSheet(u, onDone) {
  if (!u) return;
  const isSelf = u.uid === state.user?.uid;
  const perms = u.permissions || {};

  openSheet({
    title: u.name || u.email,
    body: `
      <div class="card pad0 mb">
        <div class="row" style="cursor:default"><div class="mid"><small>Email</small></div><div class="end"><b>${esc(u.email || "-")}</b></div></div>
        <div class="row" style="cursor:default"><div class="mid"><small>Added</small></div><div class="end"><b>${fmtDateTime(u.createdAt)}</b></div></div>
        <div class="row" style="cursor:default"><div class="mid"><small>Last login</small></div><div class="end"><b>${u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "Never"}</b></div></div>
      </div>

      <label class="field"><span>Full name</span><input name="name" value="${esc(u.name || "")}"></label>
      <label class="field"><span>Role</span>
        <select name="role" ${isSelf ? "disabled" : ""}>
          <option value="staff" ${u.role === "staff" ? "selected" : ""}>Staff</option>
          <option value="admin" ${u.role === "admin" ? "selected" : ""}>Administrator</option>
        </select></label>
      <label class="check"><input type="checkbox" name="active" ${(u.status || "active") === "active" ? "checked" : ""} ${isSelf ? "disabled" : ""}>
        <span>Account active</span></label>

      <div class="sec-title">Permissions</div>
      <p class="form-note">Administrators always have full access; these apply to staff accounts.</p>
      ${PERMS.map(([k, label]) => `<label class="check">
        <input type="checkbox" name="perm:${k}" ${perms[k] ? "checked" : ""}><span>${esc(label)}</span></label>`).join("")}

      <div class="divider"></div>
      <button class="btn btn-soft btn-block" id="sf-reset">Send password reset email</button>
      <div id="sf-err" class="form-error hidden"></div>`,
    footer: `<button class="btn btn-soft" data-close>Cancel</button>
             <button class="btn btn-primary" id="sf-save">Save</button>`,
    onMount(api) {
      const fail = (m) => { const b = api.root.querySelector("#sf-err"); b.textContent = m; b.classList.remove("hidden"); };

      api.root.querySelector("#sf-reset").onclick = async () => {
        if (!u.email) return fail("No email on record.");
        try { await sendPasswordResetEmail(auth, u.email); ok("Reset link sent to " + u.email); }
        catch (e) { fail(e.message); }
      };

      api.root.querySelector("#sf-save").onclick = async () => {
        const d = formData(api.root);
        const permissions = {};
        PERMS.forEach(([k]) => { permissions[k] = !!d["perm:" + k]; });
        try {
          busy(true, "Saving…");
          const patch = { name: (d.name || "").trim(), permissions, updatedAt: serverTimestamp() };
          if (!isSelf) { patch.role = d.role; patch.status = d.active ? "active" : "inactive"; }
          await updateDoc(ref(C.users, u.uid), patch);
          logActivity(null, "STAFF_UPDATED", `${patch.name || u.email}`, "user", u.uid);
          api.close(); ok("Saved"); onDone();
        } catch (e) { fail(e.message); } finally { busy(false); }
      };
    }
  });
}

function suggestPassword() {
  const words = ["Saree", "Silk", "Vyra", "Kurti", "Boutique"];
  return words[Math.floor(Math.random() * words.length)] + Math.floor(1000 + Math.random() * 9000);
}
