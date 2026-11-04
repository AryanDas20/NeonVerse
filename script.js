import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, onAuthStateChanged, signOut, updateProfile, sendEmailVerification
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, getDocs, getDocsFromServer,
  query, where, orderBy, limit, startAfter, onSnapshot, serverTimestamp, arrayUnion, getDocFromServer
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// Campus aliases are canonicalised so names such as "LPU" and
// "Lovely Professional University" resolve to the same campus key.
// Add institution-approved aliases here when onboarding another university.
const CAMPUS_ALIASES = {
  lpu: "lovely-professional-university",
  lovelyprofessionaluniversity: "lovely-professional-university",
  lovelyprofessionaluniversitylpu: "lovely-professional-university",
  lpuphagwara: "lovely-professional-university",
  lovelyprofessionaluniversityphagwara: "lovely-professional-university"
};

const configured = Boolean(firebaseConfig?.apiKey && !firebaseConfig.apiKey.startsWith("PASTE_") &&
  firebaseConfig?.projectId && !firebaseConfig.projectId.startsWith("YOUR_"));
let auth, db, currentUser = null, currentProfile = null;
let authMode = "signin", roleMode = false, activeConversation = null;
let unsubscribeMessages = null, unsubscribeNotifications = null;
let unsubscribeProfile = null, unsubscribeRole = null;
let currentPage = "overview", pageHistory = [], tourIndex = 0, lockedModal = false, firstProfileSnapshot = true;
let conversationCache = [], peopleCache = [], peopleSearchTimer = null;
const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const initials = value => String(value || "N").trim().split(/\s+/).slice(0, 2).map(v => v[0] || "").join("").toUpperCase();
const roleLabel = role => ({student:"Student",warden:"Warden",admin:"Administrator",faculty:"Faculty",verifier:"College verifier"}[role] || "Student");
const isStaff = () => ["warden", "admin", "faculty", "verifier"].includes(currentProfile?.role);
const canVerifyStudents = () => ["admin", "warden", "faculty"].includes(currentProfile?.role);
const communityVerified = () => currentProfile?.membershipStatus === "verified" || isStaff();
const campusKeyFor = value => {
  const normal = String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return CAMPUS_ALIASES[normal] || normal;
};
const normaliseSearch = value => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9@+]/g, " ").replace(/\s+/g, " ").trim();
const dateText = value => value?.toDate?.().toLocaleString?.([], {dateStyle:"medium", timeStyle:"short"}) || "Just now";
const timeText = value => value?.toDate?.().toLocaleTimeString?.([], {hour:"2-digit", minute:"2-digit"}) || "Sending…";

function toast(message) {
  const root = $("toast-root");
  if (!root) return;
  const el = document.createElement("div"); el.className = "toast"; el.textContent = message; root.append(el);
  window.setTimeout(() => el.remove(), 4200);
}
function setAuthError(message) { $("auth-error").textContent = message; $("auth-error").classList.remove("hidden"); }
function clearAuthError() { $("auth-error").classList.add("hidden"); }
function showLanding() { setAgent37Visible(false); $("auth-screen").classList.add("hidden"); $("app-shell").classList.add("hidden"); $("landing").classList.remove("hidden"); }
function showAuth() { setAgent37Visible(false); $("landing").classList.add("hidden"); $("app-shell").classList.add("hidden"); $("auth-screen").classList.remove("hidden"); }
function initFirebase() {
  if (!configured) { console.warn("NeonVerse: update firebase-config.js with your Firebase Web App values."); return false; }
  try { const app = initializeApp(firebaseConfig); auth = getAuth(app); db = getFirestore(app); return true; }
  catch (error) { console.error("Firebase initialisation failed", error); return false; }
}
const firebaseReady = initFirebase();
function requireFirebase() { if (!firebaseReady) { toast("Add your Firebase Web configuration in firebase-config.js first."); return false; } return true; }

function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll(".auth-tab").forEach(button => button.classList.toggle("active", button.dataset.authMode === mode));
  $("signup-extra").classList.toggle("hidden", mode !== "signup");
  $("auth-title").innerHTML = mode === "signup" ? 'Create your<br><span class="gradient-text">campus identity.</span>' : 'Sign in to<br><span class="gradient-text">your universe.</span>';
  $("auth-sub").textContent = mode === "signup" ? "Create your student account to join a campus community." : "Continue with your university account.";
  $("auth-submit").innerHTML = mode === "signup" ? "Create account <span>↗</span>" : "Sign in <span>↗</span>";
  $("auth-password").autocomplete = mode === "signup" ? "new-password" : "current-password";
  clearAuthError();
}
function friendlyAuthError(error) {
  const messages = {
    "auth/invalid-credential":"Email or password is incorrect.",
    "auth/email-already-in-use":"An account already exists with this email.",
    "auth/weak-password":"Choose a password with at least 6 characters.",
    "auth/invalid-email":"Enter a valid email address.",
    "auth/popup-closed-by-user":"Google sign-in was closed.",
    "auth/unauthorized-domain":"Add this website hostname to Firebase Authentication → Settings → Authorized domains.",
    "permission-denied":"Firestore blocked this action. Check that the latest firestore.rules are published, your roles/{uid} document has the correct staff role, and your own profiles/{uid} record has the matching universityKey. Do not make the database public to bypass this error.",
    "failed-precondition":"Firestore needs an index for this query. Open the index creation link in the Firebase error and wait until it is Enabled."
  };
  return messages[error?.code] || error?.message || "Something went wrong. Please try again.";
}
async function getRole(uid) {
  // Always read the authoritative role document from Firestore, not a stale
  // browser cache. The user may have just been promoted by the project owner.
  const roleSnap = await getDocFromServer(doc(db, "roles", uid));
  return roleSnap.exists() ? roleSnap.data().role : "student";
}
async function ensureProfile(user, extra = {}) {
  const ref = doc(db, "profiles", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const university = String(extra.university || "").trim();
    const profile = {
      uid:user.uid, name:extra.name || user.displayName || user.email?.split("@")[0] || "Student",
      email:user.email || "", emailVerified:Boolean(user.emailVerified), phone:"", collegeId:"", university, universityShortName:String(extra.universityShortName || "").trim(),
      universityKey:campusKeyFor(university), membershipStatus:"pending", department:"", degree:"", degreeKey:"", course:"", courseKey:"", year:"",
      hostel:"", hostelKey:"", room:"", bio:"", role:"student", profileComplete:false,
      createdAt:serverTimestamp(), updatedAt:serverTimestamp()
    };
    await setDoc(ref, profile);
    return profile;
  }
  const profile = snap.data();
  // One-time migration for accounts created with the earlier starter files.
  const migration = {};
  if (!profile.universityKey && profile.university) { profile.universityKey = campusKeyFor(profile.university); migration.universityKey = profile.universityKey; }
  if (!profile.membershipStatus) { profile.membershipStatus = "pending"; migration.membershipStatus = "pending"; }
  if (Object.keys(migration).length) { migration.updatedAt = serverTimestamp(); await updateDoc(ref, migration); }
  return profile;
}
async function refreshCurrentProfileFromServer() {
  if (!currentUser || !db) return currentProfile;
  const [profileSnap, roleSnap] = await Promise.all([
    getDocFromServer(doc(db, "profiles", currentUser.uid)),
    getDocFromServer(doc(db, "roles", currentUser.uid))
  ]);
  if (!profileSnap.exists()) throw new Error("Your campus profile could not be found. Sign out and sign in again.");
  const profile = profileSnap.data();
  const assignedRole = roleSnap.exists() ? (roleSnap.data().role || "student") : "student";
  currentProfile = {...profile, uid:currentUser.uid, role:assignedRole, profileRole:profile.role || "student"};
  return currentProfile;
}
function stopSessionWatchers() {
  if (unsubscribeProfile) unsubscribeProfile();
  if (unsubscribeRole) unsubscribeRole();
  unsubscribeProfile = null;
  unsubscribeRole = null;
}
function watchSessionDocuments() {
  stopSessionWatchers();
  if (!currentUser || !db) return;
  unsubscribeProfile = onSnapshot(doc(db, "profiles", currentUser.uid), snapshot => {
    if (!snapshot.exists() || !currentUser) return;
    const incoming = snapshot.data();
    const previousStatus = currentProfile?.membershipStatus;
    const previousCampus = currentProfile?.universityKey;
    const previousComplete = currentProfile?.profileComplete;
    currentProfile = {...incoming, uid:currentUser.uid, role:currentProfile?.role || incoming.role || "student", profileRole:incoming.role || "student"};
    // The first listener event can already contain a newer server value than
    // the profile read used during sign-in. Do not ignore that first change.
    const changed = previousStatus !== incoming.membershipStatus
      || previousCampus !== incoming.universityKey
      || previousComplete !== incoming.profileComplete;
    firstProfileSnapshot = false;
    if (changed) {
      if (incoming.membershipStatus === "verified") {
        autoEnrollStudentIntoMatchingChannels({...incoming, uid:currentUser.uid}).catch(error => console.warn("Automatic channel enrolment skipped", error));
      }
      renderPage(currentPage, false).catch(error => console.warn("Workspace refresh after profile update failed", error));
    }
  }, error => console.warn("Profile status listener failed", error));
  unsubscribeRole = onSnapshot(doc(db, "roles", currentUser.uid), snapshot => {
    if (!currentUser || !currentProfile) return;
    const assignedRole = snapshot.exists() ? (snapshot.data().role || "student") : "student";
    if (assignedRole !== currentProfile.role) {
      currentProfile = {...currentProfile, role:assignedRole};
      configureNavigation();
      if (["warden", "faculty", "admin"].includes(assignedRole)) {
        syncAssignedStaffProfile().then(() => renderPage(currentPage, false)).catch(error => {
          console.error("Staff profile setup failed", error);
          toast("Staff role was found, but profile setup was blocked. Check the published Firestore rules.");
        });
      } else {
        renderPage(currentPage, false).catch(error => console.warn("Workspace refresh after role change failed", error));
      }
    }
  }, error => console.warn("Role listener failed", error));
}

async function finishLogin(user, extra = {}) {
  currentUser = user;
  try {
    const [role, profile] = await Promise.all([getRole(user.uid), ensureProfile(user, extra)]);
    if (user.emailVerified && profile.emailVerified !== true) {
      await updateDoc(doc(db, "profiles", user.uid), {emailVerified:true, updatedAt:serverTimestamp()});
      profile.emailVerified = true;
    }
    currentProfile = {...profile, role, profileRole: profile.role || "student"};
    const moderationSnap = await getDoc(doc(db, "userModeration", user.uid));
    if (moderationSnap.exists()) {
      const moderation = moderationSnap.data();
      const activeBan = moderation.status === "banned" && (moderation.banType === "permanent" || !moderation.expiresAt || moderation.expiresAt.toDate?.() > new Date());
      if (activeBan) {
        await signOut(auth); currentUser = null; currentProfile = null; showAuth();
        setAuthError(moderation.reason || "This account is temporarily or permanently restricted by the university. Contact the university helpdesk.");
        return;
      }
    }
    await syncAssignedStaffProfile();
    // Re-read the profile and the role from the server after any staff self-sync.
    // This prevents an older cached "pending" value from surviving a new login.
    await refreshCurrentProfileFromServer();
    if (currentProfile.membershipStatus === "verified") await autoEnrollStudentIntoMatchingChannels(currentProfile).catch(error => console.warn("Channel enrolment sync skipped", error));
    watchSessionDocuments();
    $("auth-screen").classList.add("hidden"); $("landing").classList.add("hidden"); $("app-shell").classList.remove("hidden");
    setAgent37Visible(true);
    configureNavigation();
    await loadWorkspace();
    if (isProfileComplete(currentProfile)) maybeTour();
    listenForNotifications();
  } catch (error) {
    console.error("Workspace setup failed", error);
    toast(friendlyAuthError(error));
  }
}
function isProfileComplete(profile) {
  return Boolean(profile?.profileComplete && profile.name?.trim() && profile.university?.trim() &&
    profile.universityKey && profile.collegeId?.trim() && (profile.degree||profile.department)?.trim() &&
    profile.course?.trim() && String(profile.year || "").trim());
}
async function syncAssignedStaffProfile() {
  if (!currentProfile || !currentUser || !isProfileComplete(currentProfile)) return;
  if (!["warden", "faculty", "admin", "verifier"].includes(currentProfile.role)) return;
  if (currentProfile.profileRole === currentProfile.role && currentProfile.membershipStatus === "verified") return;
  await updateDoc(doc(db, "profiles", currentUser.uid), {
    role: currentProfile.role, membershipStatus: "verified",
    membershipReviewedBy: currentUser.uid, membershipReviewedAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  currentProfile = {...currentProfile, profileRole: currentProfile.role, membershipStatus: "verified"};
}
function profileCompletionPercent(profile) {
  if (profile?.profileComplete === true) return 100;
  // Progress begins at 0% for a newly registered account; the required
  // campus-details form is the profile-update workflow, not sign-up metadata.
  const fields = [profile?.collegeId, profile?.degree||profile?.department, profile?.course, profile?.year,
    profile?.phone, profile?.hostel, profile?.room, profile?.bio];
  return Math.min(99, Math.round(fields.filter(value => String(value || "").trim()).length / fields.length * 100));
}
async function handleEmailAuth(event) {
  event.preventDefault();
  if (!requireFirebase()) return;
  clearAuthError();
  const email = $("auth-email").value.trim(), password = $("auth-password").value;
  const button = $("auth-submit"); button.disabled = true; button.textContent = "Please wait…";
  try {
    if (authMode === "signup") {
      const name = $("signup-name").value.trim(), university = $("signup-university").value.trim();
      const universityShortName = $("signup-university-short")?.value.trim() || "";
      if (!name || !university || !universityShortName) throw new Error("Enter your full name, university full name and short name.");
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, {displayName:name});
      await ensureProfile(credential.user, {name, university, universityShortName});
      await sendEmailVerification(credential.user);
      await signOut(auth);
      toast("Verification email sent. Open the link in your inbox, then return here and sign in. Check spam if needed.");
      return;
    } else {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      if (!credential.user.emailVerified) {
        await sendEmailVerification(credential.user).catch(() => {});
        await signOut(auth);
        throw new Error("Please verify your email first. We sent a fresh verification link. Check your inbox or spam folder.");
      }
      if (roleMode) {
        const role = await getRole(credential.user.uid);
        if (!["warden", "admin", "faculty", "verifier"].includes(role)) { await signOut(auth); throw new Error("This account is not authorised for staff access. Contact your university administrator."); }
      }
      await finishLogin(credential.user);
    }
  } catch (error) { setAuthError(friendlyAuthError(error)); }
  finally { button.disabled = false; button.innerHTML = authMode === "signup" ? "Create account <span>↗</span>" : "Sign in <span>↗</span>"; }
}
async function googleLogin() {
  if (!requireFirebase()) return;
  clearAuthError();
  try {
    const provider = new GoogleAuthProvider(); provider.setCustomParameters({prompt:"select_account"});
    const result = await signInWithPopup(auth, provider);
    if (!result.user.emailVerified) { await signOut(auth); throw new Error("This Google account does not report a verified email address. Use a verified email account."); }
    if (roleMode) {
      const role = await getRole(result.user.uid);
      if (!["warden", "admin", "faculty", "verifier"].includes(role)) { await signOut(auth); throw new Error("This Google account is not authorised for staff access."); }
    }
    await finishLogin(result.user);
  } catch (error) { setAuthError(friendlyAuthError(error)); }
}

function openModal(html, options = {}) {
  lockedModal = Boolean(options.locked);
  $("modal-content").innerHTML = html;
  $("modal-close").classList.toggle("hidden", lockedModal);
  $("modal-backdrop").classList.remove("hidden");
}
function closeModal(force = false) {
  if (lockedModal && !force) return;
  lockedModal = false; $("modal-close").classList.remove("hidden");
  $("modal-backdrop").classList.add("hidden"); $("modal-content").innerHTML = "";
}
function openProfileCompletion(force = false) {
  const p = currentProfile || {};
  openModal(`<span class="eyebrow">REQUIRED BEFORE CONTINUING</span><h2>Complete your campus profile</h2>
    <p>Fill in the required information so your university can identify your account. You cannot use the workspace until these fields are complete.</p>
    <form id="complete-profile" class="form-grid">
      <div class="field full"><label>Full name *</label><input name="name" required value="${esc(p.name)}"></div>
      <div class="field"><label>University full name *</label><input name="university" required value="${esc(p.university)}" placeholder="e.g. Lovely Professional University"></div>
      <div class="field"><label>College short name *</label><input name="universityShortName" required value="${esc(p.universityShortName||"")}" placeholder="e.g. LPU"></div>
      <div class="field"><label>Registration / college ID *</label><input name="collegeId" required value="${esc(p.collegeId)}" autocomplete="off"></div>
      <div class="field"><label>Phone number</label><input name="phone" type="tel" value="${esc(p.phone)}" autocomplete="tel"></div>
      <div class="field"><label>Degree / programme *</label><input name="degree" required value="${esc(p.degree||p.department)}" placeholder="e.g. B.Tech Computer Science"></div>
      <div class="field"><label>Course / programme *</label><input name="course" required value="${esc(p.course)}"></div>
      <div class="field"><label>Year of study *</label><select name="year" required><option value="">Select year</option>${[1,2,3,4,5,6].map(n=>`<option value="${n}" ${String(p.year)===String(n)?"selected":""}>Year ${n}</option>`).join("")}</select></div>
      <div class="field"><label>Hostel</label><input name="hostel" value="${esc(p.hostel)}"></div>
      <div class="field"><label>Room</label><input name="room" value="${esc(p.room)}"></div>
      <div class="field full"><label>Short bio</label><textarea name="bio" rows="3">${esc(p.bio)}</textarea></div>
      <div class="field full"><button class="btn btn-primary btn-block" type="submit">Save and unlock workspace ↗</button></div>
    </form>`, {locked:force});
  $("complete-profile").onsubmit = async event => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    const campus = String(form.university || "").trim();
    const required = [form.name, campus, form.collegeId, form.degree, form.course, form.year];
    if (required.some(value => !String(value || "").trim())) { toast("Complete every field marked with *."); return; }
    const existingKey = currentProfile.universityKey || "";
    const newKey = campusKeyFor(campus);
    if (isProfileComplete(currentProfile) && existingKey !== newKey) {
      toast("Use Request campus change in your profile to move to another university community."); return;
    }
    try {
      await updateDoc(doc(db, "profiles", currentUser.uid), {
        ...form, department:String(form.degree||"").trim(), degree:String(form.degree||"").trim(), degreeKey:normaliseSearch(form.degree), courseKey:normaliseSearch(form.course), hostelKey:normaliseSearch(form.hostel), year:Number(form.year), university:campus, universityShortName:String(form.universityShortName||"").trim(), universityKey:newKey,
        email:currentUser.email || currentProfile.email || "", emailVerified:Boolean(currentUser.emailVerified), profileComplete:true, updatedAt:serverTimestamp()
      });
      currentProfile = {...currentProfile, ...form, department:String(form.degree||"").trim(), degree:String(form.degree||"").trim(), degreeKey:normaliseSearch(form.degree), courseKey:normaliseSearch(form.course), hostelKey:normaliseSearch(form.hostel), year:Number(form.year), university:campus, universityShortName:String(form.universityShortName||"").trim(), universityKey:newKey, profileComplete:true};
      await syncAssignedStaffProfile();
      closeModal(true); await loadWorkspace(); maybeTour(); toast("Your campus profile is complete.");
    } catch (error) { toast("Could not save profile: " + friendlyAuthError(error)); }
  };
}

function themeToggle() {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next; localStorage.setItem("neonverse-theme", next);
}
function applyTextScale(value) {
  const allowed = ["0.95", "1", "1.08", "1.16"];
  const scale = allowed.includes(String(value)) ? String(value) : "1.08";
  document.documentElement.style.setProperty("--ui-scale", scale);
  localStorage.setItem("neonverse-text-scale", scale);
}
function loadTheme() {
  const saved = localStorage.getItem("neonverse-theme");
  document.documentElement.dataset.theme = saved || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  applyTextScale(localStorage.getItem("neonverse-text-scale") || "1.08");
}
function pageHeading(kicker, title, description, action = "") {
  return `<div class="page-heading"><div><div class="page-kicker">${esc(kicker)}</div><h1>${title}</h1><p>${esc(description)}</p></div>${action}</div>`;
}
function empty(icon, title, description) {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><b>${esc(title)}</b><p>${esc(description)}</p></div>`;
}
function configureNavigation() {
  const nav = $("side-nav");
  document.querySelectorAll("[data-dynamic-nav]").forEach(node => node.remove());
  const addGroup = (label, items) => {
    if (!items.length) return;
    const divider = document.createElement("div"); divider.className = "nav-divider"; divider.dataset.dynamicNav = "1"; nav.append(divider);
    const heading = document.createElement("div"); heading.className = "workspace-label"; heading.textContent = label; heading.dataset.dynamicNav = "1"; nav.append(heading);
    items.forEach(([page, icon, title]) => { const button = document.createElement("button"); button.className = "side-link"; button.dataset.page = page; button.dataset.dynamicNav = "1"; button.innerHTML = `<span>${icon}</span> ${title}`; nav.append(button); });
  };
  addGroup("COMMUNITY", [["channels","▣","Class & subject groups"]]);
  if (currentProfile?.role === "faculty") addGroup("FACULTY DESK", [["faculty","▤","Faculty workspace"]]);
  if (currentProfile?.role === "warden") addGroup("WARDEN DESK", [["warden","⌂","Warden workspace"]]);
  if (currentProfile?.role === "admin") addGroup("UNIVERSITY OFFICE", [["university","◈","University administration"]]);
  addGroup("AI WORK", [["ai-work","✦","AI Work"]]);
}
async function loadWorkspace() {
  if (!currentUser || !db) return;
  configureNavigation();
  const name = currentProfile?.name || currentUser.displayName || "Student";
  $("top-name").textContent = name; $("top-role").textContent = roleLabel(currentProfile?.role);
  $("top-avatar").textContent = initials(name);
  await renderPage("overview", false);
}
async function renderPage(page, push = true) {
  if (!currentUser || !currentProfile) return;
  if (!isProfileComplete(currentProfile) && page !== "profile") { openProfileCompletion(true); toast("Complete your required profile information first."); return; }
  if (push && page !== currentPage) pageHistory.push(currentPage);
  currentPage = page;
  document.querySelectorAll(".side-link[data-page]").forEach(button => button.classList.toggle("active", button.dataset.page === page));
  const labels = {overview:"Overview",applications:"Applications",messages:"Messages",directory:"Student directory",notices:"Notice board",academics:"Academics",hostel:"Hostel services",events:"Events & clubs",profile:"My profile",settings:"Settings",channels:"Class & subject groups",faculty:"Faculty workspace",warden:"Warden workspace",university:"University administration","ai-work":"AI Work"};
  $("page-crumb").textContent = labels[page] || "Overview";
  closeSidebar();
  $("page-content").innerHTML = `<div class="loading-state"><div class="loader"></div>Loading ${esc((labels[page] || "workspace").toLowerCase())}…</div>`;
  try {
    const renderers = {overview:renderOverview,applications:renderApplications,messages:renderMessages,directory:renderDirectory,notices:renderNotices,academics:renderAcademics,hostel:renderHostel,events:renderEvents,profile:renderProfile,settings:renderSettings,channels:renderChannels,faculty:renderFacultyConsole,warden:renderWardenConsole,university:renderUniversityAdmin,"ai-work":renderAiWork};
    await (renderers[page] || renderOverview)();
  } catch (error) {
    console.error(`Could not load ${page}`, error);
    $("page-content").innerHTML = pageHeading("WORKSPACE", labels[page] || "Workspace", "This section could not be loaded.") + `<div class="panel">${empty("⚠", "Could not load this section", friendlyAuthError(error))}</div>`;
  }
}
function goBack() {
  if (pageHistory.length) { const previous = pageHistory.pop(); renderPage(previous, false); }
  else if (currentPage !== "overview") renderPage("overview", false);
  else toast("You are already at the first workspace page.");
}
function closeSidebar() { $("sidebar").classList.remove("open"); $("sidebar-scrim").classList.remove("show"); }

async function getMyApplications() {
  const q = query(collection(db,"applications"), where("studentUid","==",currentUser.uid), orderBy("createdAt","desc"), limit(30));
  const snap = await getDocs(q); return snap.docs.map(item => ({id:item.id,...item.data()}));
}
async function getPendingApplications() {
  const [currentSnap, legacySnap] = await Promise.all([
    getDocs(query(collection(db,"applications"), where("universityKey","==",currentProfile.universityKey), where("status","==","pending"), limit(50))),
    getDocs(query(collection(db,"applications"), where("university","==",currentProfile.university), where("status","==","pending"), limit(50)))
  ]);
  const merged = new Map();
  [...currentSnap.docs,...legacySnap.docs].forEach(item=>merged.set(item.id,{id:item.id,...item.data()}));
  return [...merged.values()];
}
// Agent37 AI Work: autonomous execution of explicitly requested, allow-listed actions.
// The model never receives credentials. Firestore Rules remain the final authority.
let aiWorkPlan = null, aiWorkBusy = false;
function renderAiWorkPlan(plan) {
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  const skipped = Array.isArray(plan?.skipped) ? plan.skipped : [];
  const rows = actions.map(a => `<tr><td><b>${esc(a.title || a.name || a.type || a.action)}</b></td><td>${esc(a.action.replaceAll("_", " "))}</td><td>${esc(a.studentName || "Your account")}</td></tr>`).join("");
  const skippedRows = skipped.map(x => `<div class="ai-work-skipped-row"><span>${esc(x.applicationId || "Item")}</span><small>${esc(x.reason || "Not actioned")}</small></div>`).join("");
  const result = $("ai-work-result"); if (!result) return;
  result.classList.remove("hidden");
  result.innerHTML = `<div class="ai-work-result-head"><div><div class="page-kicker">AGENT37 EXECUTION REPORT</div><h3>${esc(plan.summary || "Task processed")}</h3><p>${esc(plan.note || "Execution finished. See the activity summary below.")}</p></div><div class="ai-work-count"><strong>${Number(plan.completedCount || 0)}</strong><small>completed</small></div></div>${rows ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>TASK</th><th>ACTION</th><th>ACCOUNT</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="ai-work-no-actions">No supported action was requested or the instruction needs more detail. Nothing was changed.</div>`}${skippedRows ? `<details class="ai-work-skipped"><summary>See skipped items</summary>${skippedRows}</details>` : ""}`;
}
async function renderAiWork() {
  aiWorkPlan = null;
  const staff = ["warden", "faculty", "admin"].includes(currentProfile?.role);
  $("page-content").innerHTML = pageHeading("AGENT37 · AUTONOMOUS ASSISTANT", "AI Work", staff ? "Give your campus assistant a task. Supported actions execute automatically within your staff permissions." : "Ask NeonVerse AI to prepare and submit requests for your own student account.") +
    `<div class="ai-work-layout"><section class="panel ai-work-compose-panel"><div class="ai-work-intro"><div class="ai-work-symbol">✦</div><div><h2>What should I do?</h2><p>${staff ? "Write the task naturally. The agent can manage supported campus operations, create campus resources and process application workflows." : "Ask to submit a leave request, maintenance report or other campus service application."}</p></div></div>
      <div class="ai-work-chips">${staff ? `<button type="button" class="ai-work-chip" data-ai-example="Approve all pending leave applications for my campus.">Approve pending leave</button><button type="button" class="ai-work-chip" data-ai-example="Reject duplicate pending applications and explain the reason in the review note.">Reject duplicates</button><button type="button" class="ai-work-chip" data-ai-example="Summarise all pending applications without changing anything.">Summarise queue</button><button type="button" class="ai-work-chip" data-ai-example="Create a technical club named AI Innovators with a short description and an open membership.">Create club</button><button type="button" class="ai-work-chip" data-ai-example="Create a campus event named Innovation Day next Friday at the main auditorium. Ask me for missing date details if needed.">Create event</button><button type="button" class="ai-work-chip" data-ai-example="Publish an official notice reminding students to complete their registration.">Publish notice</button><button type="button" class="ai-work-chip" data-ai-example="Create a campus-wide chat channel named Student Help Desk.">Create chat group</button>${currentProfile.role==="admin" ? '<button type="button" class="ai-work-chip" data-ai-example="Restrict campus access for the user with campus ID 12345 because of the documented policy violation: [reason].">Restrict user access</button>' : ""}` : `<button type="button" class="ai-work-chip" data-ai-example="Submit a hostel leave application for tomorrow because I need to visit home.">Apply for leave</button><button type="button" class="ai-work-chip" data-ai-example="Submit a maintenance request: the fan in my room is not working.">Report maintenance</button>`}</div>
      <form id="ai-work-form"><label for="ai-work-input">Your instruction</label><textarea id="ai-work-input" rows="5" maxlength="1600" placeholder="${staff ? "Example: Approve all pending leave applications for my campus." : "Example: Apply for hostel leave this Friday to visit home."}" required></textarea><div class="ai-work-form-foot"><small>Agent actions are limited by your signed-in account and Firestore permissions. Each action is recorded.</small><button class="btn btn-primary" id="ai-work-submit" type="submit">✦ Run with Agent37</button></div></form><div id="ai-work-status" class="ai-work-status" aria-live="polite">Ready · ${staff ? "Staff" : "Student"} access verified</div></section>
    <aside class="panel ai-work-policy-panel"><div class="page-kicker">AUTOMATION & SAFEGUARDS</div><h3>What happens automatically</h3><div class="ai-work-policy-item"><span>✓</span><div><b>Instruction-led</b><small>No hard-coded three-day leave limit. The staff instruction and campus procedures guide the decision.</small></div></div><div class="ai-work-policy-item"><span>✓</span><div><b>Role and campus permissions</b><small>Staff can act only on records their role may review. Students can create requests only for themselves.</small></div></div><div class="ai-work-policy-item"><span>✓</span><div><b>Validated execution</b><small>Supported low-risk actions run after validation. Destructive changes are guarded and permission-checked.</small></div></div><div class="ai-work-policy-item"><span>✓</span><div><b>Audit and notifications</b><small>Application decisions record reviewer, timestamp and note. Students are notified after decisions.</small></div></div><p class="ai-work-policy-note">AI cannot bypass account permissions, campus isolation, consent, or Firestore security rules. Unsupported actions are reported rather than falsely marked complete.</p></aside></div><section id="ai-work-result" class="panel ai-work-result hidden" aria-live="polite"></section><section class="panel ai-work-history-panel"><div class="panel-title"><h3>AI Work history</h3><button class="btn btn-ghost btn-small" id="refresh-ai-history">Refresh</button></div><div id="ai-work-history"><p class="text-muted">Loading task history…</p></div></section>`;
  $("ai-work-form").addEventListener("submit", generateAiWorkPlan);
  document.querySelectorAll("[data-ai-example]").forEach(b => b.addEventListener("click", () => { $("ai-work-input").value = b.dataset.aiExample || ""; $("ai-work-input").focus(); })); $("refresh-ai-history").onclick=loadAiWorkHistory; await loadAiWorkHistory();
}
async function loadAiWorkHistory() {
  const host=$("ai-work-history"); if(!host)return;
  try {
    const snap=await getDocs(query(collection(db,"aiWorkHistory"),where("actorUid","==",currentUser.uid),orderBy("createdAt","desc"),limit(25)));
    const rows=snap.docs.map(d=>({id:d.id,...d.data()}));
    host.innerHTML=rows.length?rows.map(r=>`<article class="ai-work-history-row"><div><b>${esc(r.instruction||"Campus task")}</b><small>${esc(r.summary||"")}</small><small>${esc(r.status||"completed")} · ${esc(dateText(r.createdAt))} · ${Number(r.completedCount||0)} action(s)</small></div><span class="status ${r.status==="completed"?"approved":"pending"}">${esc(r.status||"logged")}</span></article>`).join(""):`<p class="text-muted">No AI Work tasks have been recorded yet.</p>`;
  } catch(error) { host.innerHTML=`<p class="text-muted">History could not be loaded: ${esc(friendlyAuthError(error))}</p>`; }
}
async function recordAiWorkHistory(instruction,report) {
  try { await addDoc(collection(db,"aiWorkHistory"),{actorUid:currentUser.uid,actorName:currentProfile.name||"Staff",role:currentProfile.role,universityKey:currentProfile.universityKey,instruction:String(instruction||"").slice(0,1600),summary:String(report.summary||"").slice(0,900),status:report.status||"completed",completedCount:Number(report.completedCount||0),actions:(report.actions||[]).slice(0,20).map(a=>({action:a.action,title:a.title||a.name||a.action})),createdAt:serverTimestamp()}); } catch(error) { console.warn("AI Work history could not be recorded",error); }
}
async function generateAiWorkPlan(event) {
  event?.preventDefault?.(); if (aiWorkBusy) return;
  const staff = ["warden", "faculty", "admin"].includes(currentProfile?.role);
  const instruction = String($("ai-work-input")?.value || "").trim();
  if (!instruction) return toast("Write an instruction first.");
  if (instruction.length > 1600) return toast("Please keep the instruction under 1,600 characters.");
  const submit = $("ai-work-submit"), status = $("ai-work-status"), resultBox = $("ai-work-result");
  aiWorkBusy = true; if (submit) { submit.disabled = true; submit.textContent = "Agent37 is working…"; }
  if (status) status.textContent = staff ? "Loading your campus application queue…" : "Preparing your student request…";
  if (resultBox) { resultBox.classList.add("hidden"); resultBox.replaceChildren(); }
  try {
    await refreshCurrentProfileFromServer();
    const stillStaff = ["warden", "faculty", "admin"].includes(currentProfile?.role);
    if (staff !== stillStaff) throw new Error("Your account role changed. Refresh and try again.");
    let applications = [];
    if (staff) {
      const pending = await getPendingApplications();
      applications = pending.filter(a => a.status === "pending" && (a.universityKey ? a.universityKey === currentProfile.universityKey : a.university === currentProfile.university)).slice(0, 100).map(a => ({id:a.id,title:a.title||"",type:a.type||"",studentName:a.studentName||"Student",status:a.status||"",fromDate:a.fromDate||"",toDate:a.toDate||"",fromTime:a.fromTime||"",toTime:a.toTime||"",universityKey:a.universityKey||"",university:a.university||""}));
    }
    const idToken = await currentUser.getIdToken();
    const response = await fetch("/api/agent37-work", {method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${idToken}`},body:JSON.stringify({instruction,applications})});
    const payload = await response.json().catch(()=>({})); if (!response.ok) throw new Error(payload.error || "Agent37 could not process this instruction.");
    aiWorkPlan = {...payload,instruction};
    if (status) status.textContent = "Agent37 completed its reasoning. Executing authorised actions…";
    const completed = await executeAiWorkPlan();
    const report = {...aiWorkPlan,completedCount:completed,note:`Finished automatically · ${completed} action(s) completed. Any unsupported or failed action is listed below.`};
    renderAiWorkPlan(report); await recordAiWorkHistory(instruction,{...report,status:"completed"}); await loadAiWorkHistory(); if (status) status.textContent = `Completed · ${completed} action(s) executed`;
  } catch (error) {
    await recordAiWorkHistory(instruction,{summary:error?.message||"Task failed",completedCount:0,status:"failed",actions:[]});
    await loadAiWorkHistory();
    if (status) status.textContent = "Could not complete this task.";
    if (resultBox) { resultBox.classList.remove("hidden"); resultBox.innerHTML = `<div class="ai-work-error"><b>AI Work could not complete this request</b><p>${esc(error?.message || "Please try again.")}</p></div>`; }
  } finally { aiWorkBusy = false; if (submit) { submit.disabled = false; submit.textContent = "✦ Run with Agent37"; } }
}
async function executeAiWorkPlan() {
  const actions = Array.isArray(aiWorkPlan?.actions) ? aiWorkPlan.actions.slice(0,30) : [];
  const staff = ["warden", "faculty", "admin"].includes(currentProfile?.role);
  let completed = 0; const skipped = [...(aiWorkPlan?.skipped || [])];
  for (const action of actions) {
    try {
      if (action.action === "submit_application" && !staff) {
        const type = String(action.type || "Other").slice(0,80), title = String(action.title || type).slice(0,140), details = String(action.details || "").slice(0,4000);
        if (!title || !details) throw new Error("Application title or details missing.");
        const candidate={type,title,details,fromDate:String(action.fromDate||""),toDate:String(action.toDate||"")};
        const duplicate=await findDuplicatePendingApplication(candidate);
        if(duplicate) throw new Error("An identical request is already awaiting approval. No duplicate was created.");
        await addDoc(collection(db,"applications"),{...candidate,studentUid:currentUser.uid,studentName:currentProfile.name,university:currentProfile.university,universityKey:currentProfile.universityKey,status:"pending",createdAt:serverTimestamp(),updatedAt:serverTimestamp(),history:[{status:"pending",by:currentUser.uid,at:new Date().toISOString(),comment:"Submitted by the student's AI Work assistant."}]});
        completed++; continue;
      }
      if (["approve_application","reject_application"].includes(action.action) && staff) {
        const id = String(action.applicationId||""); if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error("Invalid application reference.");
        const ref = doc(db,"applications",id), snap = await getDoc(ref); if (!snap.exists()) throw new Error("Application no longer exists.");
        const app = {id:snap.id,...snap.data()};
        const sameCampus = app.universityKey ? app.universityKey === currentProfile.universityKey : app.university === currentProfile.university;
        if (app.status !== "pending" || !sameCampus || !app.studentUid) throw new Error("Application is no longer pending or is outside your campus.");
        const status = action.action === "approve_application" ? "approved" : "rejected";
        const comment = String(action.comment || `Automatically ${status} by AI Work under staff instruction.`).slice(0,400);
        await updateDoc(ref,{status,reviewComment:comment,reviewedBy:currentUser.uid,updatedAt:serverTimestamp(),history:[...(Array.isArray(app.history)?app.history:[]),{status,by:currentUser.uid,at:new Date().toISOString(),comment}]});
        try { await addNotification(app.studentUid,{title:`Application ${status}`,body:`${app.title||app.type||"Your application"}: ${comment}`,type:"application",fromUid:currentUser.uid}); } catch (e) { console.warn("Application saved; notification failed",e); }
        completed++; continue;
      }
      if (staff && action.action === "create_club") {
        if (!["admin","faculty","warden"].includes(currentProfile.role)) throw new Error("Your role cannot create clubs.");
        const name=String(action.name||action.title||"").trim(); if(!name)throw new Error("Club name is required.");
        const club=await addDoc(collection(db,"clubs"),{name,category:String(action.category||"Other"),description:String(action.description||""),openToJoin:true,universityKey:currentProfile.universityKey,createdBy:currentUser.uid,coordinatorName:currentProfile.name,createdAt:serverTimestamp()});
        const channel=await addDoc(collection(db,"channels"),{title:name,kind:"club",clubId:club.id,description:String(action.description||""),universityKey:currentProfile.universityKey,createdByUid:currentUser.uid,createdByName:currentProfile.name,createdAt:serverTimestamp()});
        await setDoc(doc(db,"channelMemberships",`${channel.id}_${currentUser.uid}`),{channelId:channel.id,userUid:currentUser.uid,campusKey:currentProfile.universityKey,status:"active",createdAt:serverTimestamp()});
        completed++; continue;
      }
      if (staff && action.action === "create_event") {
        if (!["admin","faculty","warden"].includes(currentProfile.role)) throw new Error("Your role cannot publish events.");
        const title=String(action.title||action.name||"").trim(),date=String(action.date||"").trim(); if(!title||!/^\\d{4}-\\d{2}-\\d{2}$/.test(date))throw new Error("Event title and a valid YYYY-MM-DD date are required.");
        await addDoc(collection(db,"events"),{title,date,time:String(action.time||""),venue:String(action.venue||""),category:String(action.category||"University"),description:String(action.description||action.content||""),universityKey:currentProfile.universityKey,createdBy:currentUser.uid,createdAt:serverTimestamp()}); completed++; continue;
      }
      if (staff && action.action === "create_notice") {
        if (!["admin","warden","faculty"].includes(currentProfile.role)) throw new Error("Your role cannot publish official notices.");
        const title=String(action.title||action.name||"").trim(),content=String(action.content||action.description||"").trim(); if(!title||!content)throw new Error("Notice title and content are required.");
        await addDoc(collection(db,"notices"),{title,content,body:content,university:currentProfile.university,universityKey:currentProfile.universityKey,authorUid:currentUser.uid,authorName:currentProfile.name,createdAt:serverTimestamp(),updatedAt:serverTimestamp()}); completed++; continue;
      }
      if (staff && ["create_channel","create_group_chat"].includes(action.action)) {
        const title=String(action.title||action.name||"").trim(); if(!title)throw new Error("Chat group name is required.");
        const kind=String(action.kind||"campus").toLowerCase();
        if(!["class","subject","hostel","campus","club"].includes(kind))throw new Error("Unsupported chat group type.");
        if(kind==="campus" && currentProfile.role!=="admin")throw new Error("Only campus administrators can create campus-wide channels.");
        if(!["admin","faculty","warden"].includes(currentProfile.role))throw new Error("Staff access required.");
        const channel=await addDoc(collection(db,"channels"),{title,kind,description:String(action.description||""),enrollmentMode:"manual",universityKey:currentProfile.universityKey,createdByUid:currentUser.uid,createdByName:currentProfile.name,createdAt:serverTimestamp()});
        await setDoc(doc(db,"channelMemberships",`${channel.id}_${currentUser.uid}`),{channelId:channel.id,userUid:currentUser.uid,campusKey:currentProfile.universityKey,status:"active",createdAt:serverTimestamp()}); completed++; continue;
      }
      if (staff && action.action === "restrict_user") {
        if(currentProfile.role!=="admin")throw new Error("Only a campus administrator can restrict accounts.");
        const target=String(action.targetName||action.name||"").trim(); if(!target)throw new Error("Provide the exact user's name or campus ID.");
        const people=await getAllCampusProfilesForStaff();
        const matches=people.map(d=>({uid:d.id,...d.data()})).filter(p=>normaliseSearch(p.name)===normaliseSearch(target)||normaliseSearch(p.collegeId)===normaliseSearch(target));
        if(matches.length!==1)throw new Error(matches.length?"More than one user matches. Use the exact campus ID.":"No matching campus user was found.");
        const person=matches[0]; if(person.uid===currentUser.uid)throw new Error("You cannot restrict your own administrator account.");
        if(!confirm(`Restrict NeonVerse access for ${person.name||target}? This does not delete their Firebase account and can be reversed by an administrator.`)){skipped.push({applicationId:target,reason:"Admin cancelled the account restriction."});continue;}
        await setDoc(doc(db,"userModeration",person.uid),{userUid:person.uid,userName:person.name||"Campus member",universityKey:currentProfile.universityKey,status:"banned",banType:"permanent",expiresAt:null,reason:String(action.reason||"Access restricted by campus administrator through AI Work.").slice(0,400),updatedBy:currentUser.uid,updatedAt:serverTimestamp()});
        completed++; continue;
      }
      skipped.push({applicationId:action.applicationId||action.title||action.name||"Action",reason:"This action is not enabled or permitted for your account. Permanent Firebase Auth deletion and role changes require a separately secured Firebase Admin SDK service."});
    } catch (error) { skipped.push({applicationId:action.applicationId||action.title||"Action",reason:error?.message||"Execution failed"}); }
  }
  if (aiWorkPlan) aiWorkPlan.skipped = skipped;
  return completed;
}

async function getCampusTransferRequests() {
  const q = query(collection(db,"campusChangeRequests"), where("requestedUniversityKey","==",currentProfile.universityKey), where("status","==","pending"), limit(25));
  const snap = await getDocs(q); return snap.docs.map(item => ({id:item.id,...item.data()}));
}
function appRows(items) {
  if (!items.length) return empty("▤", "Nothing here yet", "Your applications will appear here.");
  return items.map(app => `<div class="application-row"><div class="row-icon">▤</div><div class="row-main"><b>${esc(app.title || app.type || "Application")}</b><small>${esc(app.studentName || "You")} · ${esc(dateText(app.createdAt))}</small></div><span class="status ${esc(app.status || "pending")}">${esc(app.status || "pending")}</span></div>`).join("");
}
async function renderOverview() {
  const staff = isStaff();
  const applications = staff ? await getPendingApplications() : await getMyApplications();
  const pending = applications.filter(app => app.status === "pending").length;
  $("pending-count").textContent = String(pending);
  const cards = staff ? [
    ["Pending reviews",pending,"Applications awaiting review","▤"],
    ["Total in queue",applications.length,"Recent campus requests","◷"],
    ["Your role",roleLabel(currentProfile.role),"Authorised workspace","◉"],
    ["Campus",currentProfile.university,"Active community","✳"]
  ] : [
    ["My applications",applications.length,"Your recent requests","▤"],
    ["Pending",pending,"Awaiting review","◷"],
    ["Profile completion", `${profileCompletionPercent(currentProfile)}%`, "Edit optional details to complete your campus identity", "◉"],
    ["Community", "Connected", currentProfile.university, "✳"]
  ];
  $("page-content").innerHTML = pageHeading("CAMPUS CONTROL CENTRE", `Welcome, ${esc((currentProfile.name || "there").split(" ")[0])}.`, "Your university workspace at a glance.", `<button class="btn btn-primary btn-small" id="new-app">＋ New application</button>`) +
    `<div class="grid stats-grid">${cards.map((card,i)=>`<div class="stat-card" style="--glow:${["#55e6f2","#a78bfa","#67e6b1","#ffb76a"][i]}"><span class="stat-icon">${card[3]}</span><div class="stat-label">${esc(card[0])}</div><div class="stat-value">${esc(card[1])}</div><div class="stat-foot">${esc(card[2])}</div></div>`).join("")}</div>
    <div class="grid dashboard-grid"><section class="panel"><div class="panel-title"><h3>${staff?"Applications needing review":"Recent applications"}</h3><button class="subtle-link" data-go="applications">View all →</button></div>${appRows(applications.slice(0,6))}</section>
    <section class="panel"><div class="panel-title"><h3>Quick actions</h3><span class="page-kicker">YOUR SHORTCUTS</span></div><div class="quick-grid"><button class="quick-action" data-action="new-app" data-application-type="Hostel leave"><span>▤</span><b>Hostel leave</b><small>Apply for an approved outing</small></button><button class="quick-action" data-action="new-app" data-application-type="Maintenance request"><span>⚒</span><b>Facility issue</b><small>Report a hostel or campus problem</small></button><button class="quick-action" data-action="new-app" data-application-type="Academic support"><span>▦</span><b>Academic request</b><small>Request an official academic service</small></button><button class="quick-action" data-go="messages"><span>✉</span><b>Open messages</b><small>Continue conversations</small></button><button class="quick-action" data-go="directory"><span>◎</span><b>Find students</b><small>Search your campus</small></button><button class="quick-action" data-go="hostel"><span>⌂</span><b>Hostel services</b><small>Send a service request</small></button></div></section></div>`;
  $("new-app").onclick = openApplicationForm;
  document.querySelectorAll("[data-go]").forEach(button => button.onclick = () => renderPage(button.dataset.go));
  document.querySelectorAll('[data-action="new-app"]').forEach(button => button.onclick = () => openApplicationForm(button.dataset.applicationType || ""));
}
function openApplicationForm(presetType = "") {
  openModal(`<span class="eyebrow">STUDENT SERVICES</span><h2>New application</h2><p>Submit a request to your campus review team.</p>
    <form id="application-form"><div class="field"><label>Application type *</label><select name="type" required><option>Hostel leave</option><option>Medical leave</option><option>Emergency leave</option><option>Event permission</option><option>Hostel room request</option><option>Maintenance request</option><option>Visitor pass</option><option>Academic support</option><option>Bonafide / certificate request</option><option>Fee / scholarship support</option><option>Other</option></select></div>
    <div class="field"><label>Subject *</label><input name="title" required maxlength="100" placeholder="e.g. Weekend hostel leave"></div><div class="form-grid"><div class="field"><label>From date</label><input name="fromDate" type="date"></div><div class="field"><label>To date</label><input name="toDate" type="date"></div><div class="field"><label>Departure time</label><input name="fromTime" type="time"></div><div class="field"><label>Return time</label><input name="toTime" type="time"></div></div><p class="form-hint">For hostel, medical or emergency leave, enter the expected departure and return times.</p>
    <div class="field"><label>Reason / details *</label><textarea name="details" rows="4" required maxlength="4000"></textarea></div><div class="field"><label>Supporting document reference (optional)</label><input name="documentNote" placeholder="Document name or reference; no upload"></div><button class="btn btn-primary btn-block" type="submit">Submit application ↗</button></form>`);
  if (presetType) $("application-form").elements.type.value = presetType;
  $("application-form").onsubmit = submitApplication;
}
function applicationFingerprint(app) {
  const norm = value => String(value || "").trim().toLowerCase().replace(/\s+/g," ");
  return [norm(app.type),norm(app.title),norm(app.fromDate),norm(app.toDate),norm(app.fromTime),norm(app.toTime),norm(app.details)].join("|");
}
async function findDuplicatePendingApplication(candidate) {
  const mine = await getMyApplications();
  const fingerprint = applicationFingerprint(candidate);
  return mine.find(app => app.status === "pending" && applicationFingerprint(app) === fingerprint) || null;
}
async function submitApplication(event) {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget));
  if (/leave/i.test(data.type||"")) {
    if (!data.fromDate || !data.toDate || !data.fromTime || !data.toTime) return toast("Please add leave dates, departure time and return time.");
    const start = new Date(`${data.fromDate}T${data.fromTime}`), end = new Date(`${data.toDate}T${data.toTime}`);
    if (!(end > start)) return toast("Return date and time must be after departure.");
  }
  try {
    const duplicate = await findDuplicatePendingApplication(data);
    if (duplicate) return toast("You already have an identical request awaiting approval. Open Applications to review it.");
    await addDoc(collection(db,"applications"), {...data, studentUid:currentUser.uid, studentName:currentProfile.name,
      university:currentProfile.university, universityKey:currentProfile.universityKey, status:"pending",
      createdAt:serverTimestamp(), updatedAt:serverTimestamp(), history:[{status:"pending",by:currentUser.uid,at:new Date().toISOString(),comment:"Application submitted"}]});
    closeModal(); toast("Application submitted — waiting for campus approval."); await renderPage("applications");
  } catch (error) { toast("Submission failed: " + friendlyAuthError(error)); }
}
async function renderApplications() {
  const staff = isStaff();
  const [applications, transfers] = await Promise.all([staff ? getPendingApplications() : getMyApplications(), canVerifyStudents() ? getCampusTransferRequests() : Promise.resolve([])]);
  $("page-content").innerHTML = pageHeading("REQUEST CENTRE", "Applications", "Submit requests, track decisions and review campus requests.", !staff ? '<button class="btn btn-primary btn-small" id="new-app">＋ New application</button>' : "") +
    `<div class="panel"><div class="toolbar"><input class="search-input" id="app-filter" placeholder="Search applications…"><select class="select-small" id="status-filter"><option value="">All statuses</option><option>pending</option><option>approved</option><option>rejected</option><option>escalated</option><option>cancelled</option></select></div>
    <div id="application-list">${applications.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>REQUEST</th><th>${staff?"STUDENT":"SUBMITTED"}</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>${applications.map(app=>`<tr data-search="${esc(normaliseSearch(`${app.title||""} ${app.studentName||""} ${app.type||""}`))}" data-status="${esc(app.status)}"><td><b>${esc(app.title||app.type)}</b><div class="text-muted">${esc(app.type||"")}</div></td><td>${esc(staff?app.studentName:dateText(app.createdAt))}</td><td><span class="status ${esc(app.status)}">${esc(app.status)}</span></td><td><button class="subtle-link" data-review="${esc(app.id)}">${staff?"Review":"Details"} →</button></td></tr>`).join("")}</tbody></table></div>` : empty("▤", "No applications found", "New requests and reviews will appear here.")}</div></div>` +
    (canVerifyStudents() ? `<div class="panel" style="margin-top:16px"><div class="panel-title"><h3>Campus change requests</h3><span class="page-kicker">DESTINATION CAMPUS</span></div>${transfers.length ? transfers.map(request=>`<div class="application-row"><div class="row-main"><b>${esc(request.studentName||"Student")}</b><small>${esc(request.currentUniversity||"Current campus")} → ${esc(request.requestedUniversity||"")}</small></div><button class="btn btn-primary btn-small" data-campus-request="${esc(request.id)}">Review</button></div>`).join("") : empty("⇄","No pending campus transfers","Requests to join this campus will appear here for authorised staff review.")}</div>` : "");
  if ($("new-app")) $("new-app").onclick = openApplicationForm;
  $("app-filter").oninput = filterApplications; $("status-filter").onchange = filterApplications;
  document.querySelectorAll("[data-review]").forEach(button => button.onclick = () => openApplicationReview(button.dataset.review));
  document.querySelectorAll("[data-campus-request]").forEach(button => button.onclick = () => reviewCampusChange(button.dataset.campusRequest));
}
function filterApplications() {
  const term = normaliseSearch($("app-filter").value), status = $("status-filter").value;
  document.querySelectorAll("#application-list tbody tr").forEach(row => { row.style.display = (row.dataset.search.includes(term) && (!status || row.dataset.status === status)) ? "" : "none"; });
}
async function openApplicationReview(id) {
  const snap = await getDoc(doc(db,"applications",id)); if (!snap.exists()) return toast("Application not found.");
  const application = snap.data(), canReview = isStaff() && application.status === "pending";
  openModal(`<span class="eyebrow">APPLICATION DETAILS</span><h2>${esc(application.title||application.type)}</h2><p>${esc(application.studentName||"Student")} · ${esc(application.type)} · <span class="status ${esc(application.status)}">${esc(application.status)}</span></p>
    <div class="content-card"><p><b>Reason</b><br>${esc(application.details)}</p><p><b>Dates & timings</b><br>${esc(application.fromDate||"Not specified")} ${application.fromTime?`at ${esc(application.fromTime)}`:""} — ${esc(application.toDate||"Not specified")} ${application.toTime?`at ${esc(application.toTime)}`:""}</p><p><b>Supporting reference</b><br>${esc(application.documentNote||"None supplied")}</p><p><b>Reviewer comment</b><br>${esc(application.reviewComment||"No comment yet")}</p></div>
    ${canReview?`<div class="field" style="margin-top:15px"><label>Reviewer comment</label><textarea id="review-comment" placeholder="Add a reason or note…"></textarea></div><div class="chat-tools"><button class="btn btn-primary" id="approve-app">Approve</button><button class="btn btn-ghost" id="reject-app">Reject</button><button class="btn btn-ghost" id="escalate-app">Escalate</button></div>`:
    (!isStaff() && application.studentUid === currentUser.uid && application.status === "pending" ? `<button class="btn btn-ghost" id="cancel-app">Cancel pending application</button>` : "")}`);
  if (canReview) ["approve","reject","escalate"].forEach(action => $(`${action}-app`).onclick = () => updateApplicationStatus(id,action,$("review-comment").value));
  if ($("cancel-app")) $("cancel-app").onclick = () => cancelApplication(id);
}
async function updateApplicationStatus(id, status, comment) {
  try {
    const ref = doc(db,"applications",id), snap = await getDoc(ref); if (!snap.exists()) throw new Error("Application no longer exists.");
    const app = snap.data();
    await updateDoc(ref,{status,reviewComment:comment||"",reviewedBy:currentUser.uid,updatedAt:serverTimestamp(),history:[...(app.history||[]),{status,by:currentUser.uid,at:new Date().toISOString(),comment:comment||""}]});
    await addNotification(app.studentUid,{title:`Application ${status}`,body:`${app.title||app.type}: ${comment||`Your request was ${status}.`}`,type:"application",fromUid:currentUser.uid});
    closeModal(); toast(`Application ${status}.`); await renderPage("applications");
  } catch (error) { toast("Could not update application: " + friendlyAuthError(error)); }
}
async function cancelApplication(id) {
  try { await updateDoc(doc(db,"applications",id),{status:"cancelled",updatedAt:serverTimestamp(),cancelledAt:serverTimestamp()}); closeModal(); toast("Application cancelled."); await renderPage("applications"); }
  catch (error) { toast("Could not cancel: " + friendlyAuthError(error)); }
}
async function reviewCampusChange(id) {
  if (!canVerifyStudents()) return toast("Only an authorised Warden, Faculty member or University Administrator can approve campus transfers.");
  const requestSnap = await getDoc(doc(db,"campusChangeRequests",id));
  if (!requestSnap.exists()) return toast("Campus request not found.");
  const request = requestSnap.data();
  openModal(`<span class="eyebrow">CAMPUS MEMBERSHIP</span><h2>Review campus change</h2><div class="content-card"><p><b>Student</b><br>${esc(request.studentName)}</p><p><b>Current campus</b><br>${esc(request.currentUniversity)}</p><p><b>Requested campus</b><br>${esc(request.requestedUniversity)}</p><p><b>Registration ID</b><br>${esc(request.collegeId||"Not supplied")}</p></div><p>Approve only after checking the student's enrolment using your institution's own records.</p><div class="chat-tools"><button class="btn btn-primary" id="approve-campus">Approve transfer</button><button class="btn btn-ghost" id="reject-campus">Reject</button></div>`);
  $("approve-campus").onclick = () => processCampusChange(id,request,"approved");
  $("reject-campus").onclick = () => processCampusChange(id,request,"rejected");
}
async function processCampusChange(id, request, status) {
  if (!canVerifyStudents()) return toast("Only an authorised Warden, Faculty member or University Administrator can approve campus transfers.");
  try {
    await updateDoc(doc(db,"campusChangeRequests",id),{status,reviewedBy:currentUser.uid,reviewedAt:serverTimestamp()});
    if (status === "approved") {
      await updateDoc(doc(db,"profiles",request.studentUid),{university:request.requestedUniversity,universityKey:request.requestedUniversityKey,lastCampusTransferId:id,membershipStatus:"pending",membershipReviewedBy:null,updatedAt:serverTimestamp()});
      await addNotification(request.studentUid,{title:"Campus transfer approved",body:`Your campus community is now ${request.requestedUniversity}. Sign in again if your workspace does not refresh.`,type:"membership",requestId:id,fromUid:currentUser.uid});
    } else {
      await addNotification(request.studentUid,{title:"Campus transfer declined",body:`Your request to join ${request.requestedUniversity} was not approved. Contact the university office for details.`,type:"membership",requestId:id,fromUid:currentUser.uid});
    }
    closeModal(); toast(`Campus change ${status}.`); await renderPage("applications");
  } catch (error) { toast("Could not process campus request: " + friendlyAuthError(error)); }
}

async function getCampusPeople() {
  const q = query(collection(db,"profiles"), where("universityKey","==",currentProfile.universityKey), where("membershipStatus","==","verified"), limit(150));
  const snap = await getDocs(q);
  return snap.docs.map(item => ({...item.data(),uid:item.id})).filter(person => person.uid !== currentUser.uid && person.profileComplete !== false && person.membershipStatus === "verified");
}
async function getAllCampusProfilesForStaff() {
  if (!canVerifyStudents() || !currentProfile?.universityKey) return [];
  const results = [];
  let cursor = null;
  while (true) {
    const constraints = [where("universityKey", "==", currentProfile.universityKey)];
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(500));
    const page = await getDocs(query(collection(db, "profiles"), ...constraints));
    results.push(...page.docs);
    if (page.size < 500) break;
    cursor = page.docs[page.docs.length - 1];
  }
  return results;
}
function personCard(person) {
  const searchable = normaliseSearch([person.name,person.collegeId,person.email,person.phone,person.department,person.course,person.year,person.university,person.universityShortName].join(" "));
  return `<article class="content-card person-card" data-search="${esc(searchable)}"><div style="display:flex;align-items:center;gap:11px"><div class="user-avatar">${esc(initials(person.name))}</div><div><b style="font-size:13px">${esc(person.name)}</b><div class="text-muted" style="font-size:11px;margin-top:4px">${esc(person.department||"Campus member")} · ${esc(roleLabel(person.role||"student"))}</div></div></div><p class="text-muted" style="font-size:11px">${esc(person.course||"")} ${person.year?`· Year ${esc(person.year)}`:""}</p><div class="meta-line"><span>Registration ID</span><b>${esc(person.collegeId||"Not shared")}</b></div><button class="btn btn-ghost btn-small" data-profile="${esc(person.uid)}">View profile ↗</button></article>`;
}
async function renderDirectory() {
  await refreshCurrentProfileFromServer();
  if (!communityVerified()) { $("page-content").innerHTML = pageHeading("CAMPUS COMMUNITY","Student directory","Find people from your verified campus community.") + `<div class="panel">${empty("◎","Membership verification pending","Your profile is complete, but a Warden, Faculty member or University Administrator must confirm your campus membership before you can browse the directory or start chats.")}</div>`; return; }
  peopleCache = await getCampusPeople();
  let pendingHtml = "";
  if (canVerifyStudents()) {
    // Query by campus only, then include every student who is not verified.
    // This intentionally includes new accounts with 0% / incomplete profiles.
    const campusProfileDocs = await getAllCampusProfilesForStaff();
    const pending = campusProfileDocs.map(item=>({...item.data(),uid:item.id})).filter(person=>person.uid!==currentUser.uid && !["admin","warden","faculty","verifier"].includes(person.role) && (person.membershipStatus==="pending" || !person.membershipStatus));
    pendingHtml = `<div class="panel pending-review-panel" style="margin-bottom:14px"><div class="panel-title"><div><h3>Pending student verification</h3><p class="text-muted" style="margin:5px 0 0">All registered students appear here, including profiles with 0% completion.</p></div><span class="page-kicker">CAMPUS ACCESS REVIEW · ${pending.length} PENDING</span></div>${pending.length?pending.map(person=>{const pct=profileCompletionPercent(person);const ready=person.profileComplete===true && person.emailVerified===true;return `<div class="application-row pending-student-row"><div class="row-icon">◎</div><div class="row-main"><b>${esc(person.name||"New student")}</b><small>${esc(person.email||"Email not added")} · ${esc(person.collegeId||"No registration ID")} · ${esc(person.department||"Department pending")} · ${esc(person.course||"Course pending")}</small><small>Profile ${pct}% complete · ${person.emailVerified===true?"Email verified":"Email not verified"} · ${esc(person.membershipStatus||"pending")}</small><div class="profile-progress"><span style="width:${pct}%"></span></div></div><button class="btn btn-primary btn-small" data-verify-student="${esc(person.uid)}" ${ready?"":"disabled title='Student must verify email and complete required profile first'"}>${ready?"Verify student":!person.emailVerified?"Verify email first":"Complete profile"}</button></div>`;}).join(""):empty("✓","No pending students","Every registered student in this campus is currently verified.")}</div>`;
  }
  $("page-content").innerHTML = pendingHtml + pageHeading("CAMPUS COMMUNITY","Student directory","Find verified students and teaching staff by name, email, phone, registration ID or department. Open a profile to start a campus chat.") +
    `<div class="panel"><div class="toolbar"><input id="directory-search" class="search-input" placeholder="Search name, email, ID, department or campus short name…"></div><div id="people-list" class="grid" style="grid-template-columns:repeat(auto-fill,minmax(min(100%,230px),1fr));gap:12px">${peopleCache.map(personCard).join("")||empty("◎","No other profiles yet","Your campus directory will grow as students complete their profiles.")}</div></div>`;
  $("directory-search").oninput = () => { const term = normaliseSearch($("directory-search").value); document.querySelectorAll(".person-card").forEach(card => card.style.display = card.dataset.search.includes(term) ? "" : "none"); };
  document.querySelectorAll("[data-profile]").forEach(button => button.onclick = () => showStudentProfile(button.dataset.profile));
  document.querySelectorAll("[data-verify-student]").forEach(button => button.onclick = () => verifyCampusStudent(button.dataset.verifyStudent));
}
async function autoEnrollStudentIntoMatchingChannels(profile) {
  if (!profile?.uid || !profile.profileComplete || profile.membershipStatus !== "verified" || !profile.universityKey) return 0;
  const channelsSnap = await getDocs(query(collection(db,"channels"),where("universityKey","==",profile.universityKey),limit(150)));
  const existingSnap=await getDocs(query(collection(db,"channelMemberships"),where("userUid","==",profile.uid),where("campusKey","==",profile.universityKey),limit(200)));
  const existingIds=new Set(existingSnap.docs.map(d=>d.data().channelId));
  const matches = channelsSnap.docs.map(d=>({id:d.id,...d.data()})).filter(channel => {
    if (existingIds.has(channel.id) || !["class","subject","hostel","campus"].includes(channel.kind)) return false;
    if (channel.kind === "campus") return channel.enrollmentMode === "auto";
    if (["class","subject"].includes(channel.kind)) {
      if (channel.department && normaliseSearch(channel.department) !== normaliseSearch(profile.department||"")) return false;
      if (channel.course && normaliseSearch(channel.course) !== normaliseSearch(profile.course||"")) return false;
      if (channel.year && Number(channel.year) !== Number(profile.year)) return false;
    }
    if (channel.kind === "hostel" && channel.hostel && normaliseSearch(channel.hostel) !== normaliseSearch(profile.hostel||"")) return false;
    return channel.enrollmentMode === "auto";
  });
  await Promise.all(matches.map(channel=>setDoc(doc(db,"channelMemberships",`${channel.id}_${profile.uid}`),{
    channelId:channel.id,userUid:profile.uid,campusKey:profile.universityKey,status:"active",createdAt:serverTimestamp()
  })));
  return matches.length;
}

async function approveCampusMembership(uid) {
  const ref = doc(db, "profiles", uid);
  const before = await getDocFromServer(ref);
  if (!before.exists()) throw new Error("Student profile not found.");
  const student = before.data();
  if (student.universityKey !== currentProfile.universityKey) throw new Error("This student belongs to a different campus.");
  if (student.emailVerified !== true) throw new Error("The student must verify their email address before approval.");
  if (student.profileComplete !== true) throw new Error("The student must complete the required profile before approval.");
  if (student.membershipStatus === "verified") return {alreadyVerified:true, enrolled:0};
  if (student.membershipStatus !== "pending") throw new Error(`This profile is currently ${student.membershipStatus || "unreviewed"}; only pending profiles can be approved.`);
  await updateDoc(ref, {membershipStatus:"verified",membershipReviewedBy:currentUser.uid,membershipReviewedAt:serverTimestamp(),updatedAt:serverTimestamp()});
  const after = await getDocFromServer(ref);
  if (!after.exists() || after.data().membershipStatus !== "verified") throw new Error("Firebase did not confirm the approval update. Check Firestore rules and try again.");
  let enrolled = 0;
  try { enrolled = await autoEnrollStudentIntoMatchingChannels({uid,...after.data()}); }
  catch (error) { console.warn("Student approved, but automatic channel enrolment needs attention", error); }
  return {alreadyVerified:false, enrolled};
}
async function verifyCampusStudent(uid) {
  if (!canVerifyStudents()) return toast("Only an authorised Warden, Faculty member or University Administrator can approve student membership.");
  if (!window.confirm("Confirm this student’s enrolment using your university records?")) return;
  try {
    const result = await approveCampusMembership(uid);
    toast(result.alreadyVerified ? "This student is already verified." : `Student approved. ${result.enrolled} matching class/subject channel(s) synchronised.`);
    await renderPage("directory",false);
  }
  catch(error) { toast("Could not verify student: "+friendlyAuthError(error)); }
}
async function showStudentProfile(uid) {
  const snap = await getDoc(doc(db,"profiles",uid));
  if (!snap.exists()) return toast("Profile unavailable.");
  const person = snap.data();
  if (person.universityKey !== currentProfile.universityKey) return toast("You can only view profiles in your current campus community.");
  openModal(`<div class="profile-avatar">${esc(initials(person.name))}</div><h2>${esc(person.name)}</h2><p>${esc(person.department||"University member")} · ${esc(person.university)}</p><div class="profile-meta"><div class="meta-line"><span>Course</span><b>${esc(person.course||"Not added")}</b></div><div class="meta-line"><span>Year</span><b>${esc(person.year||"Not added")}</b></div><div class="meta-line"><span>Registration ID</span><b>${esc(person.collegeId||"Not shared")}</b></div><div class="meta-line"><span>Email</span><b>${esc(person.email||"Not shared")}</b></div><div class="meta-line"><span>Phone</span><b>${esc(person.phone||"Not shared")}</b></div><div class="meta-line"><span>Bio</span><b>${esc(person.bio||"No bio yet")}</b></div></div><button class="btn btn-primary btn-block" id="profile-message">Start conversation ↗</button>`);
  $("profile-message").onclick = async () => { closeModal(); await startDirectConversation({uid,...person}); };
}

function conversationTitle(conversation) {
  if (conversation.type === "group") return conversation.groupName || "Campus group";
  const otherUid = conversation.participants.find(uid => uid !== currentUser.uid);
  return conversation.memberNames?.[otherUid] || "Student conversation";
}
function conversationSubtitle(conversation) {
  if (conversation.type === "group") return `${conversation.participants.length} members`;
  return "Direct message";
}
async function migrateLegacyConversations() {
  // Preserve the two-person conversations written by the earlier starter release.
  const legacyQuery=query(collection(db,"conversations"),where("participants","array-contains",currentUser.uid),where("university","==",currentProfile.university),limit(100));
  const legacySnap=await getDocs(legacyQuery);
  for (const item of legacySnap.docs) {
    const data=item.data();
    if (data.universityKey || !Array.isArray(data.participants) || data.participants.length!==2) continue;
    const members=await Promise.all(data.participants.map(async uid=>{const profileSnap=await getDoc(doc(db,"profiles",uid));return profileSnap.exists()?{uid,...profileSnap.data()}:null;}));
    if (members.some(person=>!person || person.universityKey!==currentProfile.universityKey || person.membershipStatus!=="verified")) continue;
    const memberNames={};members.forEach(person=>memberNames[person.uid]=person.name||"Campus member");
    await updateDoc(doc(db,"conversations",item.id),{type:"direct",groupName:"",admins:[],memberNames,universityKey:currentProfile.universityKey,updatedAt:serverTimestamp()});
  }
}
async function getMyConversations() {
  // Only load conversations carrying the current campus key. Legacy conversations
  // are intentionally not auto-migrated from a broad query because Firestore
  // Security Rules cannot safely prove that query is campus-scoped.
  const q = query(collection(db,"conversations"), where("participants","array-contains",currentUser.uid), where("universityKey","==",currentProfile.universityKey), limit(100));
  const snap = await getDocsFromServer(q);
  return snap.docs.map(item => ({id:item.id,...item.data()})).sort((a,b)=>(b.lastMessageAt?.seconds||0)-(a.lastMessageAt?.seconds||0));
}
async function renderMessages() {
  await refreshCurrentProfileFromServer();
  if (!communityVerified()) {
    $("page-content").innerHTML = pageHeading("CAMPUS COMMUNITY","Messages","Secure conversations for verified members of your campus.") +
      `<div class="panel">${empty("✉","Membership verification pending",`Your profile is complete, but the latest server profile still reports "${esc(currentProfile.membershipStatus || "pending")}". Ask an authorised Warden, Faculty member or University Administrator to approve this exact profile document.`)}<div class="meta-line"><span>Profile document / UID</span><b>${esc(currentUser.uid)}</b></div><div class="meta-line"><span>Campus key</span><b>${esc(currentProfile.universityKey || "Missing")}</b></div><button class="btn btn-primary btn-small" id="refresh-membership-status">Refresh approval status</button></div>`;
    $("refresh-membership-status").onclick = async () => {
      const button = $("refresh-membership-status"); button.disabled = true; button.textContent = "Checking…";
      try { await refreshCurrentProfileFromServer(); if (communityVerified()) { toast("Campus membership is verified. Messages are now unlocked."); await renderPage("messages", false); } else { toast(`Firebase still reports membership status: ${currentProfile.membershipStatus || "pending"}. Ask staff to approve this exact profile UID.`); button.disabled = false; button.textContent = "Refresh approval status"; } }
      catch (error) { toast("Could not refresh membership: " + friendlyAuthError(error)); button.disabled = false; button.textContent = "Refresh approval status"; }
    };
    return;
  }
  try {
    conversationCache = await getMyConversations();
    if (currentProfile.role === "admin") {
      const campusSnap = await getDocsFromServer(query(collection(db,"conversations"),where("universityKey","==",currentProfile.universityKey),limit(150)));
      const merged = new Map(conversationCache.map(item=>[item.id,item]));
      campusSnap.docs.forEach(item=>merged.set(item.id,{id:item.id,...item.data()}));
      conversationCache = [...merged.values()].sort((a,b)=>(b.lastMessageAt?.seconds||0)-(a.lastMessageAt?.seconds||0));
    }
  } catch (error) {
    console.error("Could not load conversations", error);
    $("page-content").innerHTML = pageHeading("CAMPUS COMMUNITY","Messages","Private conversations within your verified campus.") +
      `<div class="panel">${empty("⚠","Messages could not be loaded",`${esc(friendlyAuthError(error))} Check that your profile is verified and the latest Firestore rules are published. If Firebase reports a missing index, create the index from its supplied link.`)}<button class="btn btn-primary btn-small" id="retry-messages">Retry</button></div>`;
    $("retry-messages").onclick = () => renderPage("messages", false);
    return;
  }
  const activeId = activeConversation?.id;
  activeConversation = activeId ? conversationCache.find(item => item.id === activeId) || activeConversation : null;
  $("page-content").innerHTML = pageHeading("CAMPUS COMMUNITY","Messages","Private one-to-one and group conversations within your current campus. Administrators can review campus conversations, archive or remove messages.", `<div class="chat-tools"><button class="btn btn-ghost btn-small" id="new-chat">＋ New chat</button><button class="btn btn-primary btn-small" id="new-group">＋ New group</button></div>`) +
    `<div class="chat-layout ${activeConversation?"chat-open":""}" id="chat-layout"><aside class="panel chat-list"><h3>${currentProfile.role==="admin"?"Campus conversations":"Conversations"}</h3>${currentProfile.role==="admin"?`<p class="text-muted">Administrator moderation view · ${conversationCache.length} recent campus conversations</p>`:""}<div class="field"><input id="conversation-filter" placeholder="Search your chats…" aria-label="Search conversations"></div><div id="conversation-list" class="chat-contact-list">${renderConversationList()}</div>
      <div class="nav-divider"></div><h3>Start a conversation</h3><div class="field"><input id="chat-new-search" placeholder="Search campus users…" autocomplete="off" aria-label="Find a campus user"></div><div id="chat-search-results" class="chat-search-results"><div class="chat-empty">Search by name, email, phone or registration ID. Students are not listed here until you start a chat.</div></div></aside>
      <section class="panel chat-window"><div class="chat-window-head" id="chat-head">${activeConversation?renderChatHeader(activeConversation):`<div><b>Select a conversation</b><div class="text-muted">Choose an existing chat or search for a student to begin.</div></div>`}</div>
      <div class="chat-messages" id="chat-messages">${activeConversation?`<div class="chat-placeholder">Loading conversation…</div>`:empty("✉","Your messages","Your conversation history will appear here.")}</div>
      ${activeConversation?`<div class="field" style="padding:0 10px"><input id="message-filter" placeholder="Search messages in this conversation…" aria-label="Search messages"></div>${activeConversation.participants?.includes(currentUser.uid)?`<form class="chat-compose" id="chat-compose"><input id="chat-text" placeholder="Write a message…" maxlength="4000" autocomplete="off" required><button class="btn btn-primary btn-small" type="submit">Send ↗</button></form>`:`<div class="chat-compose"><span class="text-muted">Read-only administrator moderation view. You can archive or remove messages.</span></div>`}`:""}</section></div>`;
  $("new-chat").onclick = () => { $("chat-new-search").focus(); toast("Search for a campus member to start a private conversation."); };
  $("new-group").onclick = openCreateGroup;
  $("conversation-filter").oninput = () => { const term = normaliseSearch($("conversation-filter").value); document.querySelectorAll("[data-conversation]").forEach(el => el.style.display = normaliseSearch(el.textContent).includes(term) ? "" : "none"); };
  $("chat-new-search").oninput = () => {
    window.clearTimeout(peopleSearchTimer);
    const term = $("chat-new-search").value;
    peopleSearchTimer = window.setTimeout(() => searchCampusPeople(term), 180);
  };
  document.querySelectorAll("[data-conversation]").forEach(el => el.onclick = () => openConversation(el.dataset.conversation));
  if (activeConversation) { await subscribeConversation(); if ($("chat-compose")) $("chat-compose").onsubmit = sendMessage; if ($("message-filter")) $("message-filter").oninput = filterMessages; wireChatHeader(); }
}
function renderConversationList() {
  if (!conversationCache.length) return `<div class="chat-empty">No conversations yet.<br>Search for a campus user below to start one.</div>`;
  return conversationCache.map(conversation => `<div class="chat-contact ${activeConversation?.id===conversation.id?"selected":""}" data-conversation="${esc(conversation.id)}"><span class="user-avatar">${esc(initials(conversationTitle(conversation)))}</span><div style="min-width:0;flex:1"><b>${esc(conversationTitle(conversation))}</b><small>${esc(conversation.lastMessage||conversationSubtitle(conversation))}</small></div><small>${esc(timeText(conversation.lastMessageAt))}</small></div>`).join("");
}
function renderChatHeader(conversation) {
  return `<button class="chat-back" id="chat-back" aria-label="Back to conversations">←</button><span class="user-avatar">${esc(initials(conversationTitle(conversation)))}</span><div class="chat-head-title"><b>${esc(conversationTitle(conversation))}</b><small>${esc(conversationSubtitle(conversation))} · ${esc(currentProfile.university)}</small></div>${currentProfile.role==="admin"&&!conversation.participants?.includes(currentUser.uid)?`<span class="status">Moderation view</span>`:conversation.type==="group"?`<button class="btn btn-ghost btn-small" id="group-manage">Group info</button>`:`<button class="btn btn-ghost btn-small" id="direct-profile">View profile</button>`}`;
}
async function searchCampusPeople(term) {
  const box = $("chat-search-results"); if (!box) return;
  const needle = normaliseSearch(term);
  if (needle.length < 2) { box.innerHTML = `<div class="chat-empty">Type at least 2 characters to search campus users.</div>`; return; }
  try {
    if (!peopleCache.length) peopleCache = await getCampusPeople();
    const matches = peopleCache.filter(person => normaliseSearch([person.name,person.email,person.phone,person.collegeId,person.degree,person.department,person.course].join(" ")).includes(needle)).slice(0,30);
    box.innerHTML = matches.length ? matches.map(person => `<div class="chat-search-result" data-start-person="${esc(person.uid)}"><span class="user-avatar">${esc(initials(person.name))}</span><span><b>${esc(person.name)}</b><small>${esc(person.email||"")} · ${esc(person.collegeId||"ID not added")} · ${esc(person.degree||person.department||"")}</small></span></div>`).join("") : `<div class="chat-empty">No matching person found in ${esc(currentProfile.university)}.</div>`;
    document.querySelectorAll("[data-start-person]").forEach(el => el.onclick = async () => { const person = peopleCache.find(item => item.uid === el.dataset.startPerson); if (person) await startDirectConversation(person); });
  } catch (error) { box.innerHTML = `<div class="chat-empty">Search failed: ${esc(friendlyAuthError(error))}</div>`; }
}
function directConversationId(a,b) { return [a,b].sort().join("_"); }
async function startDirectConversation(person) {
  if (!communityVerified()) return toast("Your campus membership must be verified before you can chat.");
  if (person.universityKey !== currentProfile.universityKey) return toast("You can only message students from your current university community.");
  const id = directConversationId(currentUser.uid,person.uid), ref = doc(db,"conversations",id);
  try {
    // Use the server for the existence check. A cached "missing" result can
    // otherwise make a previously-created chat look absent in another tab.
    const snap = await getDocFromServer(ref);
    if (!snap.exists()) {
      const participants = [currentUser.uid,person.uid].sort();
      await setDoc(ref,{type:"direct",participants,admins:[],groupName:"",university:currentProfile.university,universityKey:currentProfile.universityKey,
        memberNames:{[currentUser.uid]:currentProfile.name,[person.uid]:person.name},createdBy:currentUser.uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),lastMessage:"",lastMessageAt:serverTimestamp()});
    }
    const latest = await getDocFromServer(ref);
    if (!latest.exists()) throw new Error("The conversation was not created. Check that both accounts are verified on the same campus and that the latest Firestore rules are published.");
    activeConversation = {id,...latest.data()};
    await renderPage("messages");
  } catch (error) { toast("Could not start conversation: " + friendlyAuthError(error)); }
}
async function openConversation(id) {
  try {
    const snap = await getDocFromServer(doc(db,"conversations",id));
    if (!snap.exists()) return toast("This conversation is no longer available.");
    const conversation = {id,...snap.data()};
    if ((currentProfile.role !== "admin" && !conversation.participants?.includes(currentUser.uid)) || conversation.universityKey !== currentProfile.universityKey) return toast("You no longer have access to this conversation.");
    activeConversation = conversation; await renderPage("messages");
  } catch (error) { toast("Could not open conversation: " + friendlyAuthError(error)); }
}
async function subscribeConversation() {
  if (unsubscribeMessages) unsubscribeMessages();
  if (!activeConversation) return;
  const q = query(collection(db,"conversations",activeConversation.id,"messages"),orderBy("createdAt","asc"),limit(150));
  unsubscribeMessages = onSnapshot(q, snapshot => {
    const box = $("chat-messages"); if (!box) return;
    if (snapshot.empty) box.innerHTML = `<div class="chat-empty">This is the beginning of your conversation. Say hello!</div>`;
    else {
      box.innerHTML = snapshot.docs.map(item => renderMessage(item.id,item.data())).join("");
      box.scrollTop = box.scrollHeight;
      snapshot.docs.forEach(item => {
        const message = item.data();
        if (currentProfile?.role !== "admin" && message.senderUid !== currentUser.uid && !(message.readBy||[]).includes(currentUser.uid)) {
          updateDoc(doc(db,"conversations",activeConversation.id,"messages",item.id),{readBy:arrayUnion(currentUser.uid)}).catch(error => console.debug("Read receipt skipped",error.code));
        }
      });
      wireMessageActions();
      if ($("message-filter")) filterMessages();
    }
  }, error => {
    console.error("Message listener failed",error);
    if ($("chat-messages")) $("chat-messages").innerHTML = empty("⚠","Messages unavailable",friendlyAuthError(error));
  });
}
function renderMessage(id,message) {
  const mine = message.senderUid === currentUser.uid;
  const senderName = activeConversation?.memberNames?.[message.senderUid] || (mine ? "You" : "Campus member");
  const deleted = Boolean(message.deleted);
  return `<article class="message-bubble bubble ${mine?"mine":""}" data-message="${esc(id)}" data-search="${esc(normaliseSearch(message.text||""))}">
    ${activeConversation?.type==="group"?`<small class="message-sender">${esc(senderName)}</small>`:""}
    <div class="message-text">${deleted?"This message was deleted":(message.archived&&currentProfile?.role!=="admin"?"This message was archived by campus staff.":esc(message.text||""))}</div>${message.archived?`<small class="message-archived">Archived by campus staff</small>`:""}
    <small class="message-time">${esc(timeText(message.createdAt))}${message.edited?" · edited":""}${mine && (message.readBy||[]).some(uid=>uid!==currentUser.uid)?" · seen":""}</small>
    ${mine&&!deleted?`<div class="chat-item-actions"><button data-edit-message="${esc(id)}">Edit</button>${currentProfile?.role!=="admin"?`<button data-delete-message="${esc(id)}">Delete</button>`:""}</div>`:""}${currentProfile?.role==="admin"&&!deleted?`<div class="chat-item-actions moderation-actions"><button data-archive-message="${esc(id)}">${message.archived?"Restore":"Archive"}</button><button data-delete-message="${esc(id)}">Remove</button></div>`:""}
  </article>`;
}
function wireMessageActions() {
  document.querySelectorAll("[data-edit-message]").forEach(button => button.onclick = () => editMessage(button.dataset.editMessage));
  document.querySelectorAll("[data-delete-message]").forEach(button => button.onclick = () => deleteMessage(button.dataset.deleteMessage));
  document.querySelectorAll("[data-archive-message]").forEach(button => button.onclick = () => archiveMessage(button.dataset.archiveMessage));
}
function filterMessages() {
  const term = normaliseSearch($("message-filter")?.value || "");
  document.querySelectorAll("[data-message]").forEach(message => message.style.display = message.dataset.search.includes(term) ? "" : "none");
}
async function sendMessage(event) {
  event.preventDefault();
  const input = $("chat-text"), textValue = input.value.trim();
  if (!textValue || !activeConversation) return;
  const conversation = activeConversation;
  input.disabled = true;
  try {
    // The message write is the primary operation. Do not report a failed send
    // merely because the optional conversation preview update is denied.
    await addDoc(collection(db,"conversations",conversation.id,"messages"),{senderUid:currentUser.uid,text:textValue,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),edited:false,deleted:false,readBy:[currentUser.uid]});
    input.value = "";
    try {
      await updateDoc(doc(db,"conversations",conversation.id),{lastMessage:textValue,lastMessageAt:serverTimestamp(),updatedAt:serverTimestamp()});
    } catch (previewError) {
      console.warn("Message was saved, but the conversation preview could not be updated", previewError);
      toast("Message sent. The conversation preview could not refresh; check the latest Firestore rules.");
    }
    if (conversation.type === "direct") {
      const recipient = conversation.participants.find(uid => uid !== currentUser.uid);
      await addNotification(recipient,{title:`New message from ${currentProfile.name}`,body:textValue.slice(0,180),type:"message",fromUid:currentUser.uid,conversationId:conversation.id});
    }
  } catch (error) { toast("Message could not be sent: " + friendlyAuthError(error)); }
  finally { if ($("chat-text")) { $("chat-text").disabled = false; $("chat-text").focus(); } }
}
async function editMessage(messageId) {
  const snap = await getDoc(doc(db,"conversations",activeConversation.id,"messages",messageId));
  if (!snap.exists() || snap.data().senderUid !== currentUser.uid || snap.data().deleted) return toast("This message cannot be edited.");
  const message = snap.data();
  openModal(`<span class="eyebrow">MESSAGE OPTIONS</span><h2>Edit message</h2><form id="edit-message-form"><div class="field"><label>Message</label><textarea name="text" rows="4" maxlength="4000" required>${esc(message.text)}</textarea></div><button class="btn btn-primary btn-block">Save changes</button></form>`);
  $("edit-message-form").onsubmit = async event => {
    event.preventDefault(); const textValue = new FormData(event.currentTarget).get("text").trim();
    if (!textValue) return toast("A message cannot be empty.");
    try { await updateDoc(doc(db,"conversations",activeConversation.id,"messages",messageId),{text:textValue,edited:true,updatedAt:serverTimestamp()}); closeModal(); toast("Message edited."); }
    catch (error) { toast("Could not edit message: " + friendlyAuthError(error)); }
  };
}
async function deleteMessage(messageId) {
  if (!window.confirm("Remove this message for everyone in this conversation?")) return;
  try {
    const ref = doc(db,"conversations",activeConversation.id,"messages",messageId);
    if (currentProfile?.role === "admin") await deleteDoc(ref);
    else await updateDoc(ref,{text:"",deleted:true,updatedAt:serverTimestamp()});
    toast("Message removed.");
  } catch (error) { toast("Could not delete message: " + friendlyAuthError(error)); }
}
async function archiveMessage(messageId) {
  if (currentProfile?.role !== "admin" || !activeConversation) return toast("Administrator access required.");
  try {
    const ref = doc(db,"conversations",activeConversation.id,"messages",messageId);
    const snap = await getDoc(ref); if (!snap.exists()) return toast("Message no longer exists.");
    const archived = snap.data().archived === true;
    await updateDoc(ref,{archived:!archived,archivedAt:!archived?serverTimestamp():null,archivedBy:!archived?currentUser.uid:null});
    toast(archived?"Message restored.":"Message archived.");
  } catch (error) { toast("Could not update archive: " + friendlyAuthError(error)); }
}
function wireChatHeader() {
  if ($("chat-back")) $("chat-back").onclick = () => $("chat-layout").classList.remove("chat-open");
  if ($("group-manage")) $("group-manage").onclick = openGroupManagement;
  if ($("direct-profile")) $("direct-profile").onclick = () => showStudentProfile(activeConversation.participants.find(uid=>uid!==currentUser.uid));
}

async function openCreateGroup() {
  if (!peopleCache.length) peopleCache = await getCampusPeople();
  openModal(`<span class="eyebrow">CAMPUS GROUPS</span><h2>Create a group</h2><p>Select up to 7 other students from your current campus. Group chats are currently limited to 8 members by the client-side security rules.</p>
    <div class="field"><label>Group name *</label><input id="group-name" maxlength="60" placeholder="e.g. CSE 2026 project team" required></div>
    <div class="field"><label>Find members</label><input id="group-member-search" placeholder="Search name, email or registration ID"></div><div id="group-member-results" class="notification-list" style="max-height:300px"></div>
    <div class="text-muted" id="group-selected-count">0 of 7 selected</div><button class="btn btn-primary btn-block" id="create-group-confirm">Create group ↗</button>`);
  const draw = term => {
    const needle = normaliseSearch(term);
    const members = peopleCache.filter(person=>normaliseSearch([person.name,person.email,person.phone,person.collegeId,person.university,person.universityShortName].join(" ")).includes(needle)).slice(0,60);
    $("group-member-results").innerHTML = members.map(person=>`<label class="group-member-row"><input type="checkbox" value="${esc(person.uid)}" data-group-check><span class="user-avatar">${esc(initials(person.name))}</span><span class="member-info"><b>${esc(person.name)}</b><small class="text-muted">${esc(person.collegeId||"")} · ${esc(person.degree||person.department||"")}</small></span></label>`).join("") || empty("◎","No people found","Try another search.");
    document.querySelectorAll("[data-group-check]").forEach(box=>box.onchange=updateCount);
  };
  const updateCount = () => { const checked=document.querySelectorAll("[data-group-check]:checked").length; $("group-selected-count").textContent=`${checked} of 7 selected`; document.querySelectorAll("[data-group-check]:not(:checked)").forEach(box=>box.disabled=checked>=7); };
  $("group-member-search").oninput = () => draw($("group-member-search").value);
  draw("");
  $("create-group-confirm").onclick = async () => {
    const name = $("group-name").value.trim(), selected=[...document.querySelectorAll("[data-group-check]:checked")].map(box=>box.value);
    if (!name) return toast("Enter a group name.");
    if (!selected.length) return toast("Select at least one other member.");
    if (selected.length>7) return toast("A group can have up to 8 members including you.");
    const people = selected.map(uid=>peopleCache.find(person=>person.uid===uid)).filter(Boolean);
    if (people.length!==selected.length || people.some(person=>person.universityKey!==currentProfile.universityKey)) return toast("Only members of your current campus can be added.");
    const participants=[currentUser.uid,...selected].sort();
    const memberNames={[currentUser.uid]:currentProfile.name}; people.forEach(person=>memberNames[person.uid]=person.name);
    const groupId=`grp_${crypto.randomUUID().replace(/-/g,"")}`;
    try {
      await setDoc(doc(db,"conversations",groupId),{type:"group",groupName:name,participants,admins:[currentUser.uid],memberNames,university:currentProfile.university,universityKey:currentProfile.universityKey,createdBy:currentUser.uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),lastMessage:"Group created",lastMessageAt:serverTimestamp()});
      closeModal(); toast("Group created."); await openConversation(groupId);
    } catch (error) { toast("Could not create group: "+friendlyAuthError(error)); }
  };
}
async function openGroupManagement() {
  const conversation = activeConversation;
  if (!conversation || conversation.type !== "group") return;
  const admin = (conversation.admins||[]).includes(currentUser.uid);
  const universityAdmin = currentProfile.role === "admin";
  const canDelete = admin || universityAdmin;
  const memberRows = conversation.participants.map(uid=>`<div class="group-member-row"><span class="user-avatar">${esc(initials(conversation.memberNames?.[uid]||"Member"))}</span><span class="member-info"><b>${esc(conversation.memberNames?.[uid]||"Campus member")}</b><small class="text-muted">${(conversation.admins||[]).includes(uid)?"Group admin":"Member"}${uid===currentUser.uid?" · You":""}</small></span>${admin&&uid!==currentUser.uid?`<button class="btn btn-ghost btn-small" data-toggle-admin="${esc(uid)}">${(conversation.admins||[]).includes(uid)?"Remove admin":"Make admin"}</button><button class="btn btn-ghost btn-small" data-remove-member="${esc(uid)}">Remove</button>`:""}</div>`).join("");
  openModal(`<span class="eyebrow">GROUP SETTINGS</span><h2>${esc(conversation.groupName||"Campus group")}</h2><p>${conversation.participants.length} members · ${admin?"You are a group admin":universityAdmin?"University administrator view":"Member access"}</p><div class="content-card">${memberRows}</div>${canDelete?`<div class="chat-tools" style="margin-top:14px">${admin?'<button class="btn btn-ghost" id="rename-group">Edit group name</button><button class="btn btn-ghost" id="add-group-member">Add members</button>':""}<button class="btn btn-ghost" id="delete-group">Delete group</button></div>`:""}`);
  document.querySelectorAll("[data-toggle-admin]").forEach(button=>button.onclick=()=>toggleGroupAdmin(button.dataset.toggleAdmin));
  document.querySelectorAll("[data-remove-member]").forEach(button=>button.onclick=()=>removeGroupMember(button.dataset.removeMember));
  if (admin) {
    $("rename-group").onclick=renameGroup;
    $("add-group-member").onclick=openAddGroupMembers;
  }
  if (canDelete) $("delete-group").onclick=deleteGroup;
}
async function toggleGroupAdmin(uid) {
  const admins = new Set(activeConversation.admins||[]);
  if (admins.has(uid)) admins.delete(uid); else admins.add(uid);
  try { await updateDoc(doc(db,"conversations",activeConversation.id),{admins:[...admins],updatedAt:serverTimestamp()}); activeConversation.admins=[...admins]; await openGroupManagement(); toast("Group admin settings updated."); }
  catch (error) { toast("Could not update admin: "+friendlyAuthError(error)); }
}
async function removeGroupMember(uid) {
  if (!window.confirm("Remove this member from the group?")) return;
  const participants=activeConversation.participants.filter(id=>id!==uid), admins=(activeConversation.admins||[]).filter(id=>id!==uid);
  try { await updateDoc(doc(db,"conversations",activeConversation.id),{participants,admins,updatedAt:serverTimestamp()}); activeConversation.participants=participants; activeConversation.admins=admins; await openGroupManagement(); toast("Member removed."); }
  catch (error) { toast("Could not remove member: "+friendlyAuthError(error)); }
}
async function renameGroup() {
  openModal(`<span class="eyebrow">GROUP SETTINGS</span><h2>Rename group</h2><form id="rename-group-form"><div class="field"><label>Group name</label><input name="name" value="${esc(activeConversation.groupName)}" maxlength="60" required></div><button class="btn btn-primary btn-block">Save group name</button></form>`);
  $("rename-group-form").onsubmit=async event=>{event.preventDefault();const name=new FormData(event.currentTarget).get("name").trim();try{await updateDoc(doc(db,"conversations",activeConversation.id),{groupName:name,updatedAt:serverTimestamp()});activeConversation.groupName=name;closeModal();await renderPage("messages");toast("Group name updated.");}catch(error){toast("Could not rename group: "+friendlyAuthError(error));}};
}
async function openAddGroupMembers() {
  if (!peopleCache.length) peopleCache=await getCampusPeople();
  const remaining=8-activeConversation.participants.length;
  if (remaining<=0) return toast("This group has reached its 8-member limit.");
  openModal(`<span class="eyebrow">GROUP SETTINGS</span><h2>Add members</h2><p>${remaining} additional member slots available.</p><div class="field"><input id="add-member-search" placeholder="Search campus members"></div><div id="add-member-results" class="notification-list" style="max-height:300px"></div><button class="btn btn-primary btn-block" id="confirm-add-members">Add selected members</button>`);
  const draw=term=>{const needle=normaliseSearch(term);const available=peopleCache.filter(person=>!activeConversation.participants.includes(person.uid)&&normaliseSearch([person.name,person.email,person.collegeId,person.phone].join(" ")).includes(needle)).slice(0,80);$("add-member-results").innerHTML=available.map(person=>`<label class="group-member-row"><input type="checkbox" data-add-member value="${esc(person.uid)}"><span class="user-avatar">${esc(initials(person.name))}</span><span class="member-info"><b>${esc(person.name)}</b><small class="text-muted">${esc(person.collegeId||"")}</small></span></label>`).join("")||empty("◎","No more members","No matching eligible members.");document.querySelectorAll("[data-add-member]").forEach(box=>box.onchange=()=>{const count=document.querySelectorAll("[data-add-member]:checked").length;document.querySelectorAll("[data-add-member]:not(:checked)").forEach(x=>x.disabled=count>=remaining);});};
  $("add-member-search").oninput=()=>draw($("add-member-search").value);draw("");
  $("confirm-add-members").onclick=async()=>{const selected=[...document.querySelectorAll("[data-add-member]:checked")].map(box=>box.value);if(!selected.length)return toast("Select at least one member.");if(selected.length>remaining)return toast("Too many members selected.");const additions=selected.map(uid=>peopleCache.find(person=>person.uid===uid)).filter(Boolean);const memberNames={...(activeConversation.memberNames||{})};additions.forEach(person=>memberNames[person.uid]=person.name);const participants=[...activeConversation.participants,...selected].sort();try{await updateDoc(doc(db,"conversations",activeConversation.id),{participants,memberNames,updatedAt:serverTimestamp()});activeConversation.participants=participants;activeConversation.memberNames=memberNames;closeModal();await renderPage("messages");toast("Members added.");}catch(error){toast("Could not add members: "+friendlyAuthError(error));}};
}
async function deleteGroup() {
  if (!window.confirm("Delete this group for all members? This cannot be undone.")) return;
  try { const messageSnap=await getDocs(collection(db,"conversations",activeConversation.id,"messages")); await Promise.all(messageSnap.docs.map(item=>deleteDoc(doc(db,"conversations",activeConversation.id,"messages",item.id)))); await deleteDoc(doc(db,"conversations",activeConversation.id)); if(unsubscribeMessages)unsubscribeMessages(); activeConversation=null; toast("Group and its messages deleted."); await renderPage("messages"); }
  catch (error) { toast("Could not delete group: "+friendlyAuthError(error)); }
}

async function renderNotices() {
  if (!communityVerified()) { $("page-content").innerHTML = pageHeading("CAMPUS BULLETIN","Notice board","Official announcements and casual campus posts.") + `<div class="panel">${empty("◷","Campus verification pending","Notices and community posts become available after your campus membership is approved.")}</div>`; return; }
  const [noticeSnap,communitySnap]=await Promise.all([
    getDocs(query(collection(db,"notices"),where("universityKey","==",currentProfile.universityKey),limit(80))),
    getDocs(query(collection(db,"communityPosts"),where("universityKey","==",currentProfile.universityKey),limit(80)))
  ]);
  const notices=noticeSnap.docs.map(d=>({id:d.id,...d.data(),board:"official"})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  const community=communitySnap.docs.map(d=>({id:d.id,...d.data(),board:"casual"})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  const canPost=["admin","faculty","warden"].includes(currentProfile.role);
  const casualRows=community.map(post=>`<div class="notice-row"><div class="notice-date">${esc(dateText(post.createdAt))}</div><div style="flex:1"><b>${esc(post.title)}</b><p>${esc(post.body)}</p><span class="page-kicker">${esc(post.authorName||"Campus member")} · CASUAL</span></div>${post.authorUid===currentUser.uid||currentProfile.role==="admin"?`<button class="subtle-link" data-delete-community="${esc(post.id)}">Remove</button>`:""}</div>`).join("");
  const officialRows=notices.map(notice=>`<div class="notice-row"><div class="notice-date">${esc(dateText(notice.createdAt))}</div><div style="flex:1"><b>${esc(notice.title)}</b><p>${esc(notice.body)}</p><span class="page-kicker">${esc(notice.category||"ANNOUNCEMENT")} · OFFICIAL</span></div>${notice.authorUid===currentUser.uid||currentProfile.role==="admin"?`<button class="subtle-link" data-delete-notice="${esc(notice.id)}">Remove</button>`:""}</div>`).join("");
  $("page-content").innerHTML=pageHeading("CAMPUS BULLETIN","Notice board","Official university updates alongside a casual student community board.",`<button class="btn btn-ghost btn-small" id="casual-post">＋ Casual post</button>${canPost?'<button class="btn btn-primary btn-small" id="post-notice">＋ Official notice</button>':""}`)+
    `<div class="panel" style="margin-bottom:14px"><div class="panel-title"><h3>Official notice board</h3><span class="page-kicker">WARDEN · FACULTY · UNIVERSITY OFFICE</span></div>${officialRows||empty("◷","No official announcements","Academic, hostel, event and emergency notices appear here.")}</div><div class="panel"><div class="panel-title"><h3>Casual campus board</h3><span class="page-kicker">COMMUNITY UPDATES</span></div>${casualRows||empty("✳","No casual posts yet","Students can share non-sensitive campus updates, lost-and-found notes and club announcements.")}</div>`;
  if(canPost)$("post-notice").onclick=()=>{openModal(`<span class="eyebrow">OFFICIAL BULLETIN</span><h2>Publish a notice</h2><form id="notice-form"><div class="field"><label>Title</label><input name="title" required maxlength="120"></div><div class="field"><label>Category</label><select name="category"><option>Announcement</option><option>Academic</option><option>Hostel</option><option>Event</option><option>Emergency</option></select></div><div class="field"><label>Message</label><textarea name="body" required maxlength="5000"></textarea></div><button class="btn btn-primary btn-block">Publish notice</button></form>`);$("notice-form").onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));try{await addDoc(collection(db,"notices"),{...data,university:currentProfile.university,universityKey:currentProfile.universityKey,authorUid:currentUser.uid,createdAt:serverTimestamp()});closeModal();toast("Official notice published.");await renderPage("notices",false);}catch(err){toast("Could not publish: "+friendlyAuthError(err));}};};
  $("casual-post").onclick=()=>{openModal(`<span class="eyebrow">COMMUNITY BOARD</span><h2>Share a casual campus post</h2><p>Do not post private student information, sensitive records, accusations or emergency instructions.</p><form id="casual-form"><div class="field"><label>Post title *</label><input name="title" required maxlength="100"></div><div class="field"><label>Message *</label><textarea name="body" required maxlength="1800" rows="4"></textarea></div><button class="btn btn-primary btn-block">Post to campus board</button></form>`);$("casual-form").onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget));try{await addDoc(collection(db,"communityPosts"),{...d,universityKey:currentProfile.universityKey,authorUid:currentUser.uid,authorName:currentProfile.name,createdAt:serverTimestamp()});closeModal();toast("Campus post published.");await renderPage("notices",false);}catch(err){toast("Could not post: "+friendlyAuthError(err));}};};
  document.querySelectorAll("[data-delete-community]").forEach(b=>b.onclick=async()=>{try{await deleteDoc(doc(db,"communityPosts",b.dataset.deleteCommunity));toast("Post removed.");await renderPage("notices",false);}catch(err){toast("Could not remove post: "+friendlyAuthError(err));}});
  document.querySelectorAll("[data-delete-notice]").forEach(b=>b.onclick=async()=>{try{await deleteDoc(doc(db,"notices",b.dataset.deleteNotice));toast("Notice removed.");await renderPage("notices",false);}catch(err){toast("Could not remove notice: "+friendlyAuthError(err));}});
}
async function renderAcademics() {
  if (!communityVerified()) { $("page-content").innerHTML=pageHeading("ACADEMIC LIFE","Academic planner","Assignments, attendance, timetable and exam dates.")+`<div class="panel">${empty("▦","Verification required","Your campus account must be verified before academic records are available.")}</div>`; return; }
  const [itemSnap, calendarSnap, attendanceSnap] = await Promise.all([
    getDocs(query(collection(db,"academicItems"),where("universityKey","==",currentProfile.universityKey),limit(100))),
    getDocs(query(collection(db,"campusCalendar"),where("universityKey","==",currentProfile.universityKey),limit(100))),
    isStaff() ? getDocs(query(collection(db,"attendanceRecords"),where("universityKey","==",currentProfile.universityKey),limit(250))) : getDocs(query(collection(db,"attendanceRecords"),where("studentUid","==",currentUser.uid),limit(100)))
  ]);
  const items=itemSnap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>!x.targetDepartment||x.targetDepartment===currentProfile.department).filter(x=>!x.targetCourse||x.targetCourse===currentProfile.course).filter(x=>!x.targetYear||Number(x.targetYear)===Number(currentProfile.year)).sort((a,b)=>String(a.dueDate||"").localeCompare(String(b.dueDate||"")));
  const calendar=calendarSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(a.date||"").localeCompare(String(b.date||"")));
  const attendance=attendanceSnap.docs.map(d=>({id:d.id,...d.data()}));
  const myAttendance=isStaff()?attendance:attendance;
  const present=myAttendance.filter(x=>x.status==="present"||x.status==="late").length;
  const attendancePct=myAttendance.length?Math.round(present/myAttendance.length*100):0;
  const facultyCanPublish=currentProfile.role==="faculty";
  const adminCanCalendar=currentProfile.role==="admin";
  const action=(facultyCanPublish?'<button class="btn btn-primary btn-small" id="add-assignment">＋ Publish assignment</button>':"")+(adminCanCalendar?'<button class="btn btn-ghost btn-small" id="add-calendar">＋ Add holiday / timetable</button>':"")+(facultyCanPublish?'<button class="btn btn-ghost btn-small" id="mark-attendance">✓ Mark attendance</button>':"");
  const assignmentRows=items.filter(x=>x.type==="assignment").map(x=>`<div class="application-row"><div class="row-icon">▤</div><div class="row-main"><b>${esc(x.title)}</b><small>${esc(x.subject||"Course")}${x.dueDate?` · Due ${esc(x.dueDate)}`:""} · ${esc(x.authorName||"Faculty")}</small><small>${esc(x.description||"")}</small></div><span class="status">Assignment</span></div>`).join("");
  const calendarRows=calendar.map(x=>`<div class="application-row"><div class="row-icon">${x.type==="holiday"?"☼":"▦"}</div><div class="row-main"><b>${esc(x.title)}</b><small>${esc(x.date||"")}${x.startTime?` · ${esc(x.startTime)}`:""}${x.location?` · ${esc(x.location)}`:""}</small><small>${esc(x.description||"")}</small></div><span class="status ${x.type==="holiday"?"approved":""}">${esc(x.type||"Calendar")}</span></div>`).join("");
  const attendanceRows=isStaff()?`<p class="text-muted">${attendance.length} attendance records in the selected campus data set.</p>`:`<div class="stat-card" style="margin-bottom:12px"><div class="stat-label">Recorded attendance</div><div class="stat-value">${attendancePct}%</div><div class="stat-foot">${present} present / late out of ${attendance.length} marked sessions</div></div>`;
  $("page-content").innerHTML=pageHeading("ACADEMIC LIFE","Academic planner","Your connected academic workspace. Faculty publish coursework and attendance; university administrators maintain the shared calendar.",action)+
    `<div class="grid stats-grid"><div class="stat-card"><div class="stat-label">Assignments</div><div class="stat-value">${items.filter(x=>x.type==="assignment").length}</div><div class="stat-foot">Matching your programme</div></div><div class="stat-card"><div class="stat-label">Calendar entries</div><div class="stat-value">${calendar.length}</div><div class="stat-foot">Timetable, exam and holiday dates</div></div><div class="stat-card"><div class="stat-label">Attendance</div><div class="stat-value">${isStaff()?attendance.length:attendancePct+"%"}</div><div class="stat-foot">${isStaff()?"Records in campus view":"Your recorded attendance"}</div></div><div class="stat-card"><div class="stat-label">Programme</div><div class="stat-value">${esc(currentProfile.year||"—")}</div><div class="stat-foot">${esc(currentProfile.course||currentProfile.department||"Campus")}</div></div></div>
    <div class="grid dashboard-grid"><section class="panel"><div class="panel-title"><h3>Assignments & coursework</h3><span class="page-kicker">FACULTY PUBLISHED</span></div>${assignmentRows||empty("▤","No assignments yet","Faculty assignments for your programme will appear here.")}</section><section class="panel"><div class="panel-title"><h3>${isStaff()?"Attendance desk":"My attendance"}</h3></div>${attendanceRows}</section></div>
    <section class="panel" style="margin-top:14px"><div class="panel-title"><h3>University timetable & calendar</h3><span class="page-kicker">OFFICE MANAGED</span></div>${calendarRows||empty("▦","No calendar entries","University holidays, exam dates and timetable entries will appear here when the office publishes them.")}</section>`;
  if(facultyCanPublish)$("add-assignment").onclick=()=>{openModal(`<span class="eyebrow">FACULTY ACADEMIC DESK</span><h2>Publish assignment</h2><form id="assignment-form" class="form-grid"><div class="field full"><label>Assignment title *</label><input name="title" required maxlength="140"></div><div class="field"><label>Subject *</label><input name="subject" required></div><div class="field"><label>Due date *</label><input name="dueDate" type="date" required></div><div class="field"><label>Target department</label><input name="targetDepartment" placeholder="Leave blank for all"></div><div class="field"><label>Target course</label><input name="targetCourse" placeholder="Leave blank for all"></div><div class="field"><label>Target year</label><select name="targetYear"><option value="">All years</option>${[1,2,3,4,5,6].map(n=>`<option value="${n}">Year ${n}</option>`).join("")}</select></div><div class="field full"><label>Instructions *</label><textarea name="description" required maxlength="5000" rows="4"></textarea></div><button class="btn btn-primary btn-block field full">Publish to students</button></form>`);$("assignment-form").onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget));try{await addDoc(collection(db,"academicItems"),{...d,type:"assignment",targetYear:d.targetYear?Number(d.targetYear):null,universityKey:currentProfile.universityKey,authorUid:currentUser.uid,authorName:currentProfile.name,createdAt:serverTimestamp()});closeModal();toast("Assignment published.");await renderPage("academics",false);}catch(err){toast("Could not publish: "+friendlyAuthError(err));}};};
  if(adminCanCalendar)$("add-calendar").onclick=()=>{openModal(`<span class="eyebrow">UNIVERSITY OFFICE</span><h2>Add calendar entry</h2><form id="calendar-form"><div class="field"><label>Title *</label><input name="title" required></div><div class="field"><label>Entry type</label><select name="type"><option value="holiday">University holiday</option><option value="timetable">Timetable</option><option value="exam">Examination</option><option value="deadline">Academic deadline</option></select></div><div class="field"><label>Date *</label><input name="date" type="date" required></div><div class="form-grid"><div class="field"><label>Start time</label><input name="startTime" type="time"></div><div class="field"><label>End time</label><input name="endTime" type="time"></div></div><div class="field"><label>Location / room</label><input name="location"></div><div class="field"><label>Details</label><textarea name="description" rows="3"></textarea></div><button class="btn btn-primary btn-block">Publish calendar entry</button></form>`);$("calendar-form").onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget));try{await addDoc(collection(db,"campusCalendar"),{...d,universityKey:currentProfile.universityKey,createdBy:currentUser.uid,createdAt:serverTimestamp()});closeModal();toast("Calendar entry published.");await renderPage("academics",false);}catch(err){toast("Could not save calendar: "+friendlyAuthError(err));}};};
  if(facultyCanPublish)$("mark-attendance").onclick=async()=>{try{const rosterSnap=await getDocs(query(collection(db,"profiles"),where("universityKey","==",currentProfile.universityKey),where("membershipStatus","==","verified"),limit(150)));const roster=rosterSnap.docs.map(d=>d.data()).filter(p=>p.uid!==currentUser.uid&&p.profileComplete===true&&(!p.department||normaliseSearch(p.department)===normaliseSearch(currentProfile.degree||currentProfile.department||"")));if(!roster.length)return toast("No verified students found for your department.");openModal(`<span class="eyebrow">FACULTY ATTENDANCE</span><h2>Record attendance</h2><form id="attendance-form"><div class="field"><label>Student *</label><select name="studentUid" required>${roster.map(p=>`<option value="${esc(p.uid)}">${esc(p.name)} · ${esc(p.collegeId||"ID unavailable")}</option>`).join("")}</select></div><div class="field"><label>Subject / class *</label><input name="subject" required></div><div class="form-grid"><div class="field"><label>Date *</label><input name="date" type="date" required value="${new Date().toISOString().slice(0,10)}"></div><div class="field"><label>Status</label><select name="status"><option value="present">Present</option><option value="absent">Absent</option><option value="late">Late</option><option value="excused">Excused</option></select></div></div><button class="btn btn-primary btn-block">Save attendance</button></form>`);$("attendance-form").onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget));const student=roster.find(p=>p.uid===d.studentUid);try{const recordId=`${d.studentUid}_${d.date}_${normaliseSearch(d.subject).replace(/\s+/g,"-").slice(0,48)}`;await setDoc(doc(db,"attendanceRecords",recordId),{...d,studentName:student?.name||"Student",studentUid:d.studentUid,universityKey:currentProfile.universityKey,markedBy:currentUser.uid,markedByName:currentProfile.name,createdAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});closeModal();toast("Attendance saved or updated for that student, date and subject.");await renderPage("academics",false);}catch(err){toast("Attendance could not be saved: "+friendlyAuthError(err));}};}catch(err){toast("Could not load roster: "+friendlyAuthError(err));}};
}

async function renderEvents() {
  if(!communityVerified()){ $("page-content").innerHTML=pageHeading("CAMPUS COMMUNITY","Events & clubs","Discover campus life.")+`<div class="panel">${empty("✳","Verification required","Verify your campus profile to discover clubs and events.")}</div>`;return; }
  const [clubSnap,eventSnap,membershipSnap]=await Promise.all([getDocs(query(collection(db,"clubs"),where("universityKey","==",currentProfile.universityKey),limit(100))),getDocs(query(collection(db,"events"),where("universityKey","==",currentProfile.universityKey),limit(100))),isStaff()?getDocs(query(collection(db,"clubMemberships"),where("universityKey","==",currentProfile.universityKey),limit(150))):Promise.resolve({docs:[]})]);
  const clubs=clubSnap.docs.map(d=>({id:d.id,...d.data()})),events=eventSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(a.date||"").localeCompare(String(b.date||""))),clubRequests=membershipSnap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.status==="pending");
  const canManage=["admin","faculty","warden"].includes(currentProfile.role);
  $("page-content").innerHTML=pageHeading("CAMPUS COMMUNITY","Events & clubs","Discover student societies, register for campus events and follow official club updates.",canManage?'<button class="btn btn-primary btn-small" id="create-club">＋ Create club</button> <button class="btn btn-ghost btn-small" id="create-event">＋ Publish event</button>':"")+`<div class="panel" style="margin-bottom:14px"><div class="panel-title"><h3>Clubs & societies</h3><span class="page-kicker">JOIN YOUR COMMUNITY</span></div>${clubs.map(c=>`<div class="application-row"><div class="row-icon">✳</div><div class="row-main"><b>${esc(c.name)}</b><small>${esc(c.category||"Student club")} · Coordinator: ${esc(c.coordinatorName||"Campus team")}</small><small>${esc(c.description||"")}</small></div><button class="btn btn-ghost btn-small" data-join-club="${esc(c.id)}" ${c.openToJoin===false?"disabled":""}>Join club</button>${currentProfile.role==="admin"?`<button class="btn btn-ghost btn-small" data-edit-club="${esc(c.id)}">Edit club</button><button class="btn btn-ghost btn-small" data-delete-club="${esc(c.id)}">Delete club</button>`:""}</div>`).join("")||empty("✳","No clubs published","The university office or authorised club coordinator can add societies here.")}</div>${isStaff()?`<div class="panel" style="margin-bottom:14px"><div class="panel-title"><h3>Club membership approvals</h3><span class="page-kicker">COORDINATOR DESK</span></div>${clubRequests.map(r=>`<div class="application-row"><div class="row-main"><b>${esc(r.studentName||"Student")}</b><small>Request to join club ${esc(r.clubId)}</small></div><button class="btn btn-primary btn-small" data-approve-club="${esc(r.id)}">Approve</button><button class="btn btn-ghost btn-small" data-reject-club="${esc(r.id)}">Reject</button></div>`).join("")||`<p class="text-muted">No pending club requests.</p>`}</div>`:""}<div class="panel"><div class="panel-title"><h3>Upcoming events</h3><span class="page-kicker">CAMPUS CALENDAR</span></div>${events.map(e=>`<div class="application-row"><div class="row-icon">◷</div><div class="row-main"><b>${esc(e.title)}</b><small>${esc(e.date||"Date TBA")}${e.time?` · ${esc(e.time)}`:""} · ${esc(e.venue||"Venue TBA")}</small><small>${esc(e.description||"")}</small></div><button class="btn btn-ghost btn-small" data-rsvp="${esc(e.id)}">RSVP</button>${currentProfile.role==="admin"?`<button class="btn btn-ghost btn-small" data-delete-event="${esc(e.id)}">Delete event</button>`:""}</div>`).join("")||empty("◷","No events announced","Events published by university teams and clubs will appear here.")}</div>`;
  document.querySelectorAll("[data-edit-club]").forEach(button=>button.onclick=()=>{
    if(currentProfile.role!=="admin")return toast("Administrator access required.");
    const club=clubs.find(item=>item.id===button.dataset.editClub);if(!club)return;
    openModal(`<span class="eyebrow">CAMPUS GOVERNANCE</span><h2>Edit club settings</h2><form id="edit-club-form"><div class="field"><label>Club name *</label><input name="name" required maxlength="100" value="${esc(club.name)}"></div><div class="field"><label>Category</label><select name="category">${["Technical","Cultural","Sports","Entrepreneurship","Social impact","Academic","Other"].map(v=>`<option ${club.category===v?"selected":""}>${v}</option>`).join("")}</select></div><div class="field"><label>Description</label><textarea name="description" rows="3">${esc(club.description||"")}</textarea></div><div class="field"><label>Membership access</label><select name="openToJoin"><option value="true" ${club.openToJoin!==false?"selected":""}>Accept new join requests</option><option value="false" ${club.openToJoin===false?"selected":""}>Pause new requests</option></select></div><button class="btn btn-primary btn-block">Save club settings</button></form>`);
    $("edit-club-form").onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget));try{await updateDoc(doc(db,"clubs",club.id),{name:d.name.trim(),category:d.category,description:d.description,openToJoin:d.openToJoin==="true",updatedAt:serverTimestamp()});closeModal();toast("Club settings updated.");await renderPage("events",false);}catch(err){toast("Could not update club: "+friendlyAuthError(err));}};
  });
  document.querySelectorAll("[data-delete-event]").forEach(button=>button.onclick=async()=>{if(currentProfile.role!=="admin")return;if(!confirm("Delete this campus event?"))return;try{const eventId=button.dataset.deleteEvent;const rsvps=await getDocs(query(collection(db,"eventRsvps"),where("eventId","==",eventId),where("universityKey","==",currentProfile.universityKey),limit(400)));await Promise.all(rsvps.docs.map(d=>deleteDoc(d.ref)));await deleteDoc(doc(db,"events",eventId));toast("Event and its RSVP records deleted.");await renderPage("events",false);}catch(err){toast("Could not delete event: "+friendlyAuthError(err));}});
  document.querySelectorAll("[data-delete-club]").forEach(button=>button.onclick=async()=>{
    const clubId=button.dataset.deleteClub;
    if(currentProfile.role!=="admin")return toast("Administrator access required.");
    if(!confirm("Delete this club, its chat channel, membership requests and channel messages? This cannot be undone."))return;
    try{
      const [members,channels,eventsForClub]=await Promise.all([
        getDocs(query(collection(db,"clubMemberships"),where("clubId","==",clubId),where("universityKey","==",currentProfile.universityKey),limit(400))),
        getDocs(query(collection(db,"channels"),where("clubId","==",clubId),where("universityKey","==",currentProfile.universityKey),limit(20))),
        getDocs(query(collection(db,"events"),where("clubId","==",clubId),where("universityKey","==",currentProfile.universityKey),limit(100)))
      ]);
      for(const ch of channels.docs){
        const [cm,msg]=await Promise.all([
          getDocs(query(collection(db,"channelMemberships"),where("channelId","==",ch.id),where("campusKey","==",currentProfile.universityKey),limit(400))),
          getDocs(query(collection(db,"channels",ch.id,"messages"),limit(400)))
        ]);
        await Promise.all([...cm.docs,...msg.docs].map(d=>deleteDoc(d.ref)));
        await deleteDoc(ch.ref);
      }
      await Promise.all([...members.docs,...eventsForClub.docs].map(d=>deleteDoc(d.ref)));
      await deleteDoc(doc(db,"clubs",clubId));
      toast("Club and its linked records deleted.");await renderPage("events",false);
    }catch(error){toast("Could not delete club: "+friendlyAuthError(error));}
  });
  if(canManage){$("create-club").onclick=()=>{openModal(`<span class="eyebrow">CLUB MANAGEMENT</span><h2>Create a club</h2><form id="club-form"><div class="field"><label>Club / society name *</label><input name="name" required></div><div class="field"><label>Category</label><select name="category"><option>Technical</option><option>Cultural</option><option>Sports</option><option>Entrepreneurship</option><option>Social impact</option><option>Academic</option><option>Other</option></select></div><div class="field"><label>Description</label><textarea name="description" rows="3"></textarea></div><div class="field"><label>Membership</label><select name="openToJoin"><option value="true">Open to student requests</option><option value="false">Invite / approval only</option></select></div><button class="btn btn-primary btn-block">Create club</button></form>`);$("club-form").onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget));try{const club=await addDoc(collection(db,"clubs"),{...d,openToJoin:d.openToJoin==="true",universityKey:currentProfile.universityKey,createdBy:currentUser.uid,coordinatorName:currentProfile.name,createdAt:serverTimestamp()});const channel=await addDoc(collection(db,"channels"),{title:d.name,kind:"club",clubId:club.id,description:d.description||"",universityKey:currentProfile.universityKey,createdByUid:currentUser.uid,createdByName:currentProfile.name,createdAt:serverTimestamp()});await setDoc(doc(db,"channelMemberships",`${channel.id}_${currentUser.uid}`),{channelId:channel.id,userUid:currentUser.uid,campusKey:currentProfile.universityKey,status:"active",createdAt:serverTimestamp()});closeModal();toast("Club and its chat space created.");await renderPage("events",false);}catch(err){toast("Could not create club: "+friendlyAuthError(err));}};};
    $("create-event").onclick=()=>{openModal(`<span class="eyebrow">CAMPUS EVENTS</span><h2>Publish an event</h2><form id="event-form"><div class="field"><label>Event title *</label><input name="title" required></div><div class="form-grid"><div class="field"><label>Date *</label><input type="date" name="date" required></div><div class="field"><label>Time</label><input type="time" name="time"></div></div><div class="field"><label>Venue</label><input name="venue"></div><div class="field"><label>Category</label><select name="category"><option>Academic</option><option>Club</option><option>Sports</option><option>Cultural</option><option>Career</option><option>University</option></select></div><div class="field"><label>Description</label><textarea name="description" rows="3"></textarea></div><button class="btn btn-primary btn-block">Publish event</button></form>`);$("event-form").onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget));try{await addDoc(collection(db,"events"),{...d,universityKey:currentProfile.universityKey,createdBy:currentUser.uid,createdAt:serverTimestamp()});closeModal();toast("Event published.");await renderPage("events",false);}catch(err){toast("Could not publish event: "+friendlyAuthError(err));}};};
  }
  document.querySelectorAll("[data-join-club]").forEach(b=>b.onclick=async()=>{try{const clubId=b.dataset.joinClub;const existing=await getDocs(query(collection(db,"clubMemberships"),where("clubId","==",clubId),where("studentUid","==",currentUser.uid),limit(1)));if(!existing.empty)return toast("You already requested or joined this club.");await addDoc(collection(db,"clubMemberships"),{clubId,studentUid:currentUser.uid,studentName:currentProfile.name,universityKey:currentProfile.universityKey,status:"pending",createdAt:serverTimestamp()});const channelSnap=await getDocs(query(collection(db,"channels"),where("clubId","==",clubId),where("universityKey","==",currentProfile.universityKey),limit(1)));if(!channelSnap.empty){const c=channelSnap.docs[0];await setDoc(doc(db,"channelMemberships",`${c.id}_${currentUser.uid}`),{channelId:c.id,userUid:currentUser.uid,campusKey:currentProfile.universityKey,status:"pending",createdAt:serverTimestamp()});}toast("Club request sent for coordinator approval.");}catch(err){toast("Could not join club: "+friendlyAuthError(err));}});
  document.querySelectorAll("[data-rsvp]").forEach(b=>b.onclick=async()=>{try{await addDoc(collection(db,"eventRsvps"),{eventId:b.dataset.rsvp,studentUid:currentUser.uid,studentName:currentProfile.name,universityKey:currentProfile.universityKey,createdAt:serverTimestamp()});b.textContent="Registered";b.disabled=true;toast("Your RSVP has been recorded.");}catch(err){toast("RSVP failed: "+friendlyAuthError(err));}});
  document.querySelectorAll("[data-approve-club]").forEach(b=>b.onclick=async()=>{const req=clubRequests.find(x=>x.id===b.dataset.approveClub);try{await updateDoc(doc(db,"clubMemberships",req.id),{status:"active",reviewedBy:currentUser.uid,reviewedAt:serverTimestamp()});const channels=await getDocs(query(collection(db,"channels"),where("clubId","==",req.clubId),where("universityKey","==",currentProfile.universityKey),limit(1)));if(!channels.empty){const memberRef=doc(db,"channelMemberships",`${channels.docs[0].id}_${req.studentUid}`);await setDoc(memberRef,{channelId:channels.docs[0].id,userUid:req.studentUid,campusKey:currentProfile.universityKey,status:"active",createdAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});}await addNotification(req.studentUid,{title:"Club membership approved",body:"Your club request was approved. The club channel is now available in Class & subject groups.",type:"club",fromUid:currentUser.uid});toast("Club membership approved and club chat unlocked.");await renderPage("events",false);}catch(err){toast("Could not approve membership: "+friendlyAuthError(err));}});
  document.querySelectorAll("[data-reject-club]").forEach(b=>b.onclick=async()=>{const req=clubRequests.find(x=>x.id===b.dataset.rejectClub);try{await updateDoc(doc(db,"clubMemberships",req.id),{status:"rejected",reviewedBy:currentUser.uid,reviewedAt:serverTimestamp()});const channels=await getDocs(query(collection(db,"channels"),where("clubId","==",req.clubId),where("universityKey","==",currentProfile.universityKey),limit(1)));if(!channels.empty){const member=await getDoc(doc(db,"channelMemberships",`${channels.docs[0].id}_${req.studentUid}`));if(member.exists())await updateDoc(member.ref,{status:"rejected",updatedAt:serverTimestamp()});}toast("Club request rejected.");await renderPage("events",false);}catch(err){toast("Could not reject membership: "+friendlyAuthError(err));}});
}

async function renderFacultyConsole(){
  if(!["faculty","admin"].includes(currentProfile.role)){ $("page-content").innerHTML=pageHeading("FACULTY DESK","Faculty workspace","This workspace is reserved for authorised faculty.")+`<div class="panel">${empty("▤","Access restricted","Your account does not have faculty permissions.")}</div>`;return; }
  const [students,assignments,attendance]=await Promise.all([getDocs(query(collection(db,"profiles"),where("universityKey","==",currentProfile.universityKey),where("membershipStatus","==","verified"),limit(150))),getDocs(query(collection(db,"academicItems"),where("universityKey","==",currentProfile.universityKey),limit(100))),getDocs(query(collection(db,"attendanceRecords"),where("universityKey","==",currentProfile.universityKey),limit(250)))]);
  $("page-content").innerHTML=pageHeading("FACULTY MANAGEMENT SYSTEM","Faculty workspace","Manage classes, subjects, assignments, attendance, student communication and office hours.",'<button class="btn btn-primary btn-small" id="faculty-new-assignment">＋ New assignment</button>')+`<div class="grid stats-grid"><div class="stat-card"><div class="stat-label">Verified profiles loaded</div><div class="stat-value">${students.size}</div><div class="stat-foot">Current roster view · max 150</div></div><div class="stat-card"><div class="stat-label">Published academic items</div><div class="stat-value">${assignments.size}</div><div class="stat-foot">Current view · max 100</div></div><div class="stat-card"><div class="stat-label">Attendance records loaded</div><div class="stat-value">${attendance.size}</div><div class="stat-foot">Current view · max 250</div></div><div class="stat-card"><div class="stat-label">Communication tools</div><div class="stat-value">Available</div><div class="stat-foot">Class and subject channels</div></div></div><div class="grid dashboard-grid"><section class="panel"><h3>Teaching controls</h3><div class="quick-grid"><button class="quick-action" data-faculty-go="academics"><span>▤</span><b>Assignments & attendance</b><small>Publish tasks and record attendance</small></button><button class="quick-action" data-faculty-go="channels"><span>▣</span><b>Class & subject groups</b><small>Auto-enrol a verified class roster</small></button><button class="quick-action" data-faculty-go="notices"><span>◷</span><b>Faculty notices</b><small>Share official academic updates</small></button><button class="quick-action" data-faculty-go="events"><span>✳</span><b>Clubs & events</b><small>Coordinate student activities</small></button></div></section><section class="panel"><h3>Useful workflows</h3><p class="text-muted">Attendance audit trail, assignment deadlines, course-scoped channels, office-hour announcements, class notices, mentoring follow-ups and verification of student campus identities.</p><p class="text-muted">Faculty can approve student campus membership and chat access. They cannot change university-wide holidays or assign staff roles.</p></section></div>`;
  $("faculty-new-assignment").onclick=()=>renderPage("academics");document.querySelectorAll("[data-faculty-go]").forEach(b=>b.onclick=()=>renderPage(b.dataset.facultyGo));
}

async function renderWardenConsole(){
  if(currentProfile.role!=="warden"&&currentProfile.role!=="admin"){ $("page-content").innerHTML=pageHeading("WARDEN DESK","Warden workspace","Hostel and residential operations.")+`<div class="panel">${empty("⌂","Access restricted","Your account does not have Warden permissions.")}</div>`;return; }
  const [apps,profiles,allocations]=await Promise.all([getPendingApplications(),getDocs(query(collection(db,"profiles"),where("universityKey","==",currentProfile.universityKey),where("membershipStatus","==","verified"),limit(150))),getDocs(query(collection(db,"hostelAllocations"),where("universityKey","==",currentProfile.universityKey),limit(150)))]);
  const hostelApps=apps.filter(a=>/hostel|room|visitor|maintenance|mess|leave/i.test(`${a.type||""} ${a.title||""}`));
  $("page-content").innerHTML=pageHeading("RESIDENTIAL OPERATIONS","Warden workspace","Manage hostel residents, leave requests, room allocations, maintenance, visitors and hostel announcements.",'<button class="btn btn-primary btn-small" id="warden-allocation">＋ Record room allocation</button>')+`<div class="grid stats-grid"><div class="stat-card"><div class="stat-label">Hostel requests</div><div class="stat-value">${hostelApps.length}</div><div class="stat-foot">Pending in the applications queue</div></div><div class="stat-card"><div class="stat-label">Verified profiles loaded</div><div class="stat-value">${profiles.size}</div><div class="stat-foot">Current roster view · max 150</div></div><div class="stat-card"><div class="stat-label">Room allocations loaded</div><div class="stat-value">${allocations.size}</div><div class="stat-foot">Current view · max 150</div></div><div class="stat-card"><div class="stat-label">Resident communications</div><div class="stat-value">Available</div><div class="stat-foot">Notices and hostel channels</div></div></div><div class="grid dashboard-grid"><section class="panel"><div class="panel-title"><h3>Hostel applications</h3><button class="subtle-link" data-warden-go="applications">Open queue →</button></div>${appRows(hostelApps.slice(0,8))||empty("⌂","No hostel requests","New leave, visitor and maintenance requests appear here.")}</section><section class="panel"><h3>Warden actions</h3><div class="quick-grid"><button class="quick-action" data-warden-go="hostel"><span>⌂</span><b>Hostel service desk</b><small>Resident service requests</small></button><button class="quick-action" data-warden-go="notices"><span>◷</span><b>Hostel notice</b><small>Publish resident updates</small></button><button class="quick-action" data-warden-go="channels"><span>▣</span><b>Hostel groups</b><small>Create hostel communication channels</small></button><button class="quick-action" data-warden-go="applications"><span>▤</span><b>Review applications</b><small>Leave and facilities approvals</small></button></div></section></div>`;
  $("warden-allocation").onclick=async()=>{const snap=await getDocs(query(collection(db,"profiles"),where("universityKey","==",currentProfile.universityKey),where("membershipStatus","==","verified"),limit(150)));const students=snap.docs.map(d=>d.data());openModal(`<span class="eyebrow">HOSTEL MANAGEMENT</span><h2>Record room allocation</h2><form id="allocation-form"><div class="field"><label>Student</label><select name="studentUid" required>${students.map(x=>`<option value="${esc(x.uid)}">${esc(x.name)} · ${esc(x.collegeId||"ID")}</option>`).join("")}</select></div><div class="form-grid"><div class="field"><label>Hostel / block *</label><input name="hostel" required></div><div class="field"><label>Room *</label><input name="room" required></div></div><div class="field"><label>Notes</label><textarea name="notes" rows="2"></textarea></div><button class="btn btn-primary btn-block">Save allocation</button></form>`);$("allocation-form").onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget));const student=students.find(x=>x.uid===d.studentUid);try{await addDoc(collection(db,"hostelAllocations"),{...d,studentName:student?.name||"Student",universityKey:currentProfile.universityKey,createdBy:currentUser.uid,createdAt:serverTimestamp()});closeModal();toast("Room allocation saved.");await renderPage("warden",false);}catch(err){toast("Could not save allocation: "+friendlyAuthError(err));}};};
  document.querySelectorAll("[data-warden-go]").forEach(b=>b.onclick=()=>renderPage(b.dataset.wardenGo));
}

async function renderUniversityAdmin(){
  if(currentProfile.role!=="admin"){ $("page-content").innerHTML=pageHeading("UNIVERSITY OFFICE","Administration","University operations and governance.")+`<div class="panel">${empty("◈","Administrator access required","This area is available only to an account with the admin role.")}</div>`;return; }
  const [profileDocs,channelsSnap,apps]=await Promise.all([getAllCampusProfilesForStaff(),getDocs(query(collection(db,"channels"),where("universityKey","==",currentProfile.universityKey),limit(150))),getPendingApplications()]);
  const people=profileDocs.map(d=>({...d.data(),id:d.id,uid:d.id}));
  const pending=people.filter(person=>person.uid!==currentUser.uid && !["admin","warden","faculty","verifier"].includes(person.role) && (person.membershipStatus==="pending" || !person.membershipStatus));
  const bannedSnap=await getDocs(query(collection(db,"userModeration"),where("universityKey","==",currentProfile.universityKey),limit(150)));
  const banned=bannedSnap.docs.map(x=>({id:x.id,...x.data()})).filter(x=>x.status==="banned"&&(x.banType==="permanent"||!x.expiresAt||x.expiresAt.toDate?.()>new Date()));
  $("page-content").innerHTML=pageHeading("UNIVERSITY GOVERNANCE","Administration","Central office controls for identity verification, academic calendar, communities, policies and platform safety.",'<button class="btn btn-primary btn-small" id="admin-calendar">＋ Publish holiday / timetable</button>')+`<div class="grid stats-grid"><div class="stat-card"><div class="stat-label">Campus profiles</div><div class="stat-value">${people.length}</div><div class="stat-foot">Current campus registry view</div></div><div class="stat-card"><div class="stat-label">Pending verification</div><div class="stat-value">${pending.length}</div><div class="stat-foot">Student access approvals</div></div><div class="stat-card"><div class="stat-label">Chat groups loaded</div><div class="stat-value">${channelsSnap.size}</div><div class="stat-foot">Current view · max 150</div></div><div class="stat-card"><div class="stat-label">Restricted accounts loaded</div><div class="stat-value">${banned.length}</div><div class="stat-foot">Current view · max 150</div></div></div><div class="panel" style="margin-top:14px"><div class="panel-title"><h3>Student identity & chat access approvals</h3><span class="page-kicker">WARDEN · FACULTY · ADMIN CAN REVIEW</span></div>${pending.map(p=>`<div class="application-row"><div class="row-icon">◎</div><div class="row-main"><b>${esc(p.name||"Student")}</b><small>${esc(p.email||"")} · ${esc(p.department||"Department pending")} · ${esc(p.collegeId||"ID pending")} · Profile ${profileCompletionPercent(p)}% complete · ${p.emailVerified===true?"Email verified":"Email not verified"}</small></div><button class="btn btn-primary btn-small" data-verify-user="${esc(p.uid)}" ${p.profileComplete===true&&p.emailVerified===true?"":"disabled title='Student must verify email and complete profile first'"}>${p.profileComplete===true&&p.emailVerified===true?"Approve chat":"Await requirements"}</button><button class="btn btn-ghost btn-small" data-reject-user="${esc(p.uid)}">Reject</button></div>`).join("")||empty("✓","No pending profiles","New unverified student profiles will appear here, including students who still need to complete onboarding.")}</div><div class="grid dashboard-grid"><section class="panel"><div class="panel-title"><h3>Campus operations</h3></div><div class="quick-grid"><button class="quick-action" data-admin-go="academics"><span>▦</span><b>Timetable & holidays</b><small>Publish the university calendar</small></button><button class="quick-action" data-admin-go="events"><span>✳</span><b>Clubs & events</b><small>Manage campus communities</small></button><button class="quick-action" data-admin-go="notices"><span>◷</span><b>Official notice board</b><small>Publish university notices</small></button><button class="quick-action" data-admin-go="channels"><span>▣</span><b>Group governance</b><small>Inspect and remove channels</small></button></div></section><section class="panel"><div class="panel-title"><h3>Account moderation</h3></div>${people.filter(p=>p.role!=="admin"&&p.uid!==currentUser.uid).slice(0,12).map(p=>`<div class="application-row"><div class="row-main"><b>${esc(p.name||"Campus member")}</b><small>${esc(p.email||"")} · ${esc(p.membershipStatus||"pending")}</small></div><button class="btn btn-ghost btn-small" data-ban-user="${esc(p.uid)}">Restrict</button></div>`).join("")||`<p class="text-muted">No other profiles found.</p>`}</section></div><section class="panel" style="margin-top:14px"><div class="panel-title"><h3>Restricted accounts</h3></div>${banned.map(x=>`<div class="application-row"><div class="row-main"><b>${esc(x.userName||x.id)}</b><small>${esc(x.banType||"temporary")} · ${esc(x.reason||"No reason supplied")}</small></div><button class="btn btn-ghost btn-small" data-unban-user="${esc(x.id)}">Restore access</button></div>`).join("")||`<p class="text-muted">No accounts currently restricted.</p>`}</section>`;
  document.querySelectorAll("[data-verify-user]").forEach(b=>b.onclick=async()=>{try{const result=await approveCampusMembership(b.dataset.verifyUser);toast(result.alreadyVerified?"This student is already verified.":`Student approved. ${result.enrolled} matching class/subject channel(s) synchronised.`);await renderPage("university",false);}catch(err){toast("Approval failed: "+friendlyAuthError(err));}});
  document.querySelectorAll("[data-reject-user]").forEach(b=>b.onclick=async()=>{try{await updateDoc(doc(db,"profiles",b.dataset.rejectUser),{membershipStatus:"rejected",membershipReviewedBy:currentUser.uid,membershipReviewedAt:serverTimestamp(),updatedAt:serverTimestamp()});toast("Student profile rejected.");await renderPage("university",false);}catch(err){toast("Rejection failed: "+friendlyAuthError(err));}});
  document.querySelectorAll("[data-ban-user]").forEach(b=>b.onclick=async()=>{const uid=b.dataset.banUser;const person=people.find(p=>p.uid===uid);openModal(`<span class="eyebrow">ACCOUNT MODERATION</span><h2>Restrict campus account</h2><p>This blocks access to the NeonVerse workspace. It does not delete the Firebase Authentication account.</p><form id="ban-form"><div class="field"><label>Restriction type</label><select name="banType"><option value="temporary">Temporary</option><option value="permanent">Permanent</option></select></div><div class="field"><label>Duration (hours, temporary only)</label><input name="hours" type="number" min="1" max="8760" value="24"></div><div class="field"><label>Reason</label><textarea name="reason" rows="3" required></textarea></div><button class="btn btn-primary btn-block">Apply restriction</button></form>`);$("ban-form").onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget));const expiry=d.banType==="temporary"?new Date(Date.now()+Number(d.hours)*3600000):null;try{await setDoc(doc(db,"userModeration",uid),{userUid:uid,userName:person?.name||"Campus member",universityKey:currentProfile.universityKey,status:"banned",banType:d.banType,expiresAt:expiry,reason:d.reason,updatedBy:currentUser.uid,updatedAt:serverTimestamp()});closeModal();toast("Account restriction applied.");await renderPage("university",false);}catch(err){toast("Could not apply restriction: "+friendlyAuthError(err));}};});
  document.querySelectorAll("[data-unban-user]").forEach(b=>b.onclick=async()=>{try{await setDoc(doc(db,"userModeration",b.dataset.unbanUser),{status:"active",updatedBy:currentUser.uid,updatedAt:serverTimestamp()},{merge:true});toast("Account restored.");await renderPage("university",false);}catch(err){toast("Could not restore account: "+friendlyAuthError(err));}});
  document.querySelectorAll("[data-admin-go]").forEach(b=>b.onclick=()=>renderPage(b.dataset.adminGo));
  $("admin-calendar").onclick=()=>renderPage("academics");
}

async function renderChannels(openId=null){
  await refreshCurrentProfileFromServer();
  if(!communityVerified()){ $("page-content").innerHTML=pageHeading("CAMPUS COMMUNITIES","Class & subject groups","Your enrolled academic and campus channels.")+`<div class="panel">${empty("▣","Verification required","A staff member must verify your campus profile before chat channels are available.")}</div>`;return; }
  let channelDocs=[], featuredChannels=[];
  if(isStaff()){
    const snap=await getDocs(query(collection(db,"channels"),where("universityKey","==",currentProfile.universityKey),limit(150)));channelDocs=snap.docs.map(d=>({id:d.id,...d.data()}));
  } else {
    const [membershipSnap, campusChannels] = await Promise.all([
      getDocs(query(collection(db,"channelMemberships"),where("userUid","==",currentUser.uid),limit(150))),
      getDocs(query(collection(db,"channels"),where("universityKey","==",currentProfile.universityKey),limit(150)))
    ]);
    const activeIds=new Set(membershipSnap.docs.filter(d=>d.data().status==="active"&&d.data().campusKey===currentProfile.universityKey).map(d=>d.data().channelId));
    const byId=new Map(campusChannels.docs.map(d=>[d.id,{id:d.id,...d.data()}]));
    channelDocs=[...activeIds].map(id=>byId.get(id)).filter(Boolean);
    featuredChannels=[...byId.values()].filter(c=>!activeIds.has(c.id)&&c.enrollmentMode==="featured"&&["class","subject"].includes(c.kind))
      .filter(c=>!c.department||normaliseSearch(c.department)===normaliseSearch(currentProfile.degree||currentProfile.department||""))
      .filter(c=>!c.course||normaliseSearch(c.course)===normaliseSearch(currentProfile.course||""))
      .filter(c=>!c.year||Number(c.year)===Number(currentProfile.year));
  }
  channelDocs.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  const canCreate=["faculty","warden","admin"].includes(currentProfile.role);
  const selected=channelDocs.find(c=>c.id===openId)||null;
  let messages=[];if(selected){const m=await getDocs(query(collection(db,"channels",selected.id,"messages"),orderBy("createdAt","asc"),limit(100)));messages=m.docs.map(d=>({id:d.id,...d.data()}));}
  $("page-content").innerHTML=pageHeading("CAMPUS COMMUNITIES","Class & subject groups","Faculty can auto-enrol verified students or publish featured course groups that eligible students can join. Warden and university teams manage hostel and campus groups.",canCreate?'<button class="btn btn-primary btn-small" id="create-channel">＋ Create group</button>':"")+`${!isStaff()&&featuredChannels.length?`<section class="panel" style="margin-bottom:14px"><div class="panel-title"><h3>Featured groups to join</h3><span class="page-kicker">MATCHED TO YOUR PROGRAMME</span></div>${featuredChannels.map(c=>`<div class="application-row"><div class="row-icon">${c.kind==="subject"?"S":"C"}</div><div class="row-main"><b>${esc(c.title)}</b><small>${esc(c.kind)} · ${esc(c.department||"")} · ${esc(c.course||"")}${c.year?` · Year ${esc(c.year)}`:""}</small><small>${esc(c.description||"")}</small></div><button class="btn btn-primary btn-small" data-join-channel="${esc(c.id)}">Join chat</button></div>`).join("")}</section>`:""}<div class="chat-layout"><aside class="chat-list"><h3>My channels</h3>${channelDocs.map(c=>`<div class="chat-contact ${selected?.id===c.id?"selected":""}" data-open-channel="${esc(c.id)}"><span class="user-avatar">${c.kind==="subject"?"S":c.kind==="class"?"C":c.kind==="hostel"?"H":"✳"}</span><div><b>${esc(c.title)}</b><small>${esc(c.kind||"campus")} · ${esc(c.department||c.course||c.hostel||"Campus")}</small></div></div>`).join("")||empty("▣","No groups yet","Your assigned class/subject channels and approved club spaces will appear here.")}</aside><section class="chat-window">${selected?`<div class="chat-window-head"><div class="user-avatar">${esc(initials(selected.title))}</div><div><b>${esc(selected.title)}</b><small>${esc(selected.kind||"Campus channel")} · ${esc(selected.description||"Members added by authorised staff")}</small></div>${currentProfile.role==="admin"?`<button class="btn btn-ghost btn-small" id="delete-channel">Delete group</button>`:""}</div><div class="chat-messages" id="channel-messages">${messages.map(m=>`<div class="bubble ${m.senderUid===currentUser.uid?"mine":""}">${m.archived?`<em>Archived by campus staff</em><br>`:""}${m.archived&&currentProfile.role!=="admin"?"This message is not available.":esc(m.text)}<small>${esc(m.senderName||"Campus member")} · ${esc(dateText(m.createdAt))}</small>${currentProfile.role==="admin"?`<div class="chat-item-actions"><button data-channel-archive="${esc(m.id)}">${m.archived?"Restore":"Archive"}</button><button data-channel-delete="${esc(m.id)}">Remove</button></div>`:""}</div>`).join("")||`<div class="chat-placeholder">Start the conversation in this channel.</div>`}</div><form class="chat-compose" id="channel-compose"><input name="text" maxlength="4000" required placeholder="Message ${esc(selected.title)}…"><button class="btn btn-primary btn-small">Send</button></form>`:`<div class="chat-placeholder">Select a channel to open the conversation. Your course groups appear here automatically after faculty enrols your verified profile.</div>`}</section></div>`;
  document.querySelectorAll("[data-open-channel]").forEach(b=>b.onclick=()=>renderChannels(b.dataset.openChannel));
  document.querySelectorAll("[data-channel-archive]").forEach(b=>b.onclick=async()=>{if(currentProfile.role!=="admin"||!selected)return;try{const ref=doc(db,"channels",selected.id,"messages",b.dataset.channelArchive),snap=await getDoc(ref);if(!snap.exists())return;const archived=snap.data().archived===true;await updateDoc(ref,{archived:!archived,archivedAt:!archived?serverTimestamp():null,archivedBy:!archived?currentUser.uid:null});toast(archived?"Channel message restored.":"Channel message archived.");await renderChannels(selected.id);}catch(err){toast("Could not archive channel message: "+friendlyAuthError(err));}});
  document.querySelectorAll("[data-channel-delete]").forEach(b=>b.onclick=async()=>{if(currentProfile.role!=="admin"||!selected)return;if(!confirm("Remove this channel message?"))return;try{await deleteDoc(doc(db,"channels",selected.id,"messages",b.dataset.channelDelete));toast("Channel message removed.");await renderChannels(selected.id);}catch(err){toast("Could not remove channel message: "+friendlyAuthError(err));}});
  document.querySelectorAll("[data-join-channel]").forEach(b=>b.onclick=async()=>{try{await setDoc(doc(db,"channelMemberships",`${b.dataset.joinChannel}_${currentUser.uid}`),{channelId:b.dataset.joinChannel,userUid:currentUser.uid,campusKey:currentProfile.universityKey,status:"active",createdAt:serverTimestamp()});toast("You joined the featured group.");await renderChannels(b.dataset.joinChannel);}catch(err){toast("Could not join group: "+friendlyAuthError(err));}});
  if(selected){const box=$("channel-messages");if(box)box.scrollTop=box.scrollHeight;$("channel-compose").onsubmit=async e=>{e.preventDefault();const textValue=new FormData(e.currentTarget).get("text").trim();if(!textValue)return;try{await addDoc(collection(db,"channels",selected.id,"messages"),{senderUid:currentUser.uid,senderName:currentProfile.name,text:textValue,createdAt:serverTimestamp()});await renderChannels(selected.id);}catch(err){toast("Message could not be sent: "+friendlyAuthError(err));}};if(currentProfile.role==="admin")$("delete-channel").onclick=async()=>{if(!confirm("Delete this channel? Its messages and membership records will also be removed."))return;try{const memberSnap=await getDocs(query(collection(db,"channelMemberships"),where("channelId","==",selected.id),where("campusKey","==",currentProfile.universityKey),limit(500)));await Promise.all(memberSnap.docs.map(d=>deleteDoc(d.ref)));const msgSnap=await getDocs(query(collection(db,"channels",selected.id,"messages"),limit(500)));await Promise.all(msgSnap.docs.map(d=>deleteDoc(d.ref)));await deleteDoc(doc(db,"channels",selected.id));toast("Group deleted.");await renderChannels();}catch(err){toast("Could not delete group: "+friendlyAuthError(err));}};}
  if(canCreate)$("create-channel").onclick=()=>{const allowed=currentProfile.role==="faculty"?["class","subject"]:currentProfile.role==="warden"?["hostel"]:["class","subject","hostel","campus"];
    openModal(`<span class="eyebrow">STAFF GROUP BUILDER</span><h2>Create a campus group</h2><p>Choose automatic enrolment for immediate and future matching students, or publish a featured class/subject group that students can join themselves.</p><form id="channel-form"><div class="field"><label>Group name *</label><input name="title" required maxlength="100"></div><div class="field"><label>Group type</label><select name="kind">${allowed.map(x=>`<option value="${x}">${x[0].toUpperCase()+x.slice(1)} group</option>`).join("")}</select></div><div class="form-grid"><div class="field"><label>Department</label><input name="department" value="${esc(currentProfile.department||"")}"></div><div class="field"><label>Course / programme</label><input name="course" value="${esc(currentProfile.course||"")}"></div><div class="field"><label>Year</label><select name="year"><option value="">All years</option>${[1,2,3,4,5,6].map(n=>`<option value="${n}" ${Number(currentProfile.year)===n?"selected":""}>Year ${n}</option>`).join("")}</select></div><div class="field"><label>Hostel / block (hostel group)</label><input name="hostel" value="${esc(currentProfile.hostel||"")}"></div></div><div class="field"><label>Subject (optional)</label><input name="subject"></div><div class="field"><label>Student access</label><select name="enrollmentMode"><option value="auto">Auto-enrol matching students</option><option value="featured">Show as featured group to join</option></select></div><div class="field"><label>Description</label><textarea name="description" rows="2"></textarea></div><button class="btn btn-primary btn-block">Create and enrol students</button></form>`);
    $("channel-form").onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget));try{if(["class","subject"].includes(d.kind)&&(!d.department||!d.course))throw new Error("Enter both department and course for an academic group.");if(d.kind==="hostel"&&!d.hostel)throw new Error("Enter the hostel or block for a hostel group.");if(d.enrollmentMode==="featured"&&!(["class","subject"].includes(d.kind)))throw new Error("Featured join mode is available for class and subject groups only.");if(d.kind!=="hostel")d.hostel="";if(!["class","subject"].includes(d.kind)){d.department="";d.course="";d.year="";}d.departmentKey=normaliseSearch(d.department);d.courseKey=normaliseSearch(d.course);d.hostelKey=normaliseSearch(d.hostel);const rosterSnap=await getDocs(query(collection(db,"profiles"),where("universityKey","==",currentProfile.universityKey),where("membershipStatus","==","verified"),limit(250)));let roster=rosterSnap.docs.map(x=>x.data()).filter(x=>x.uid&&x.profileComplete===true);if(["class","subject"].includes(d.kind)){roster=roster.filter(x=>normaliseSearch(x.department||"")===normaliseSearch(d.department)&&normaliseSearch(x.course||"")===normaliseSearch(d.course));if(d.year)roster=roster.filter(x=>Number(x.year)===Number(d.year));}if(d.kind==="hostel")roster=roster.filter(x=>normaliseSearch(x.hostel||"")===normaliseSearch(d.hostel));if(!roster.some(x=>x.uid===currentUser.uid))roster.push({...currentProfile,uid:currentUser.uid});if(roster.length>250)throw new Error("This group exceeds the 250-member pilot limit. Split it by section or tutorial group.");const channel=await addDoc(collection(db,"channels"),{...d,year:d.year?Number(d.year):null,universityKey:currentProfile.universityKey,createdByUid:currentUser.uid,createdByName:currentProfile.name,createdAt:serverTimestamp()});const memberList=d.enrollmentMode==="featured"?roster.filter(x=>x.uid===currentUser.uid):roster;await Promise.all(memberList.map(x=>setDoc(doc(db,"channelMemberships",`${channel.id}_${x.uid}`),{channelId:channel.id,userUid:x.uid,campusKey:currentProfile.universityKey,status:"active",createdAt:serverTimestamp()})));closeModal();toast(d.enrollmentMode==="featured"?"Featured group published. Eligible students can join from their chat page.":`Group created. ${roster.length} verified members added.`);await renderChannels(channel.id);}catch(err){toast("Could not create group: "+friendlyAuthError(err));}};
  };
}

async function renderHostel() {
  const allocationQuery = ["warden","admin"].includes(currentProfile.role)
    ? query(collection(db,"hostelAllocations"),where("universityKey","==",currentProfile.universityKey),limit(100))
    : query(collection(db,"hostelAllocations"),where("studentUid","==",currentUser.uid),limit(30));
  const allocationSnap = await getDocs(allocationQuery);
  const allocations = allocationSnap.docs.map(d=>({id:d.id,...d.data()}));
  const items=[["⌂","Room request","Request a room or room change"],["⚒","Maintenance","Report a repair or facility issue"],["♧","Visitor pass","Request visitor permission"],["☻","Mess feedback","Share dining feedback"],["◷","Hostel leave","Submit a leave application"]];
  $("page-content").innerHTML=pageHeading("RESIDENTIAL SERVICES","Hostel services","Submit hostel-related requests to your campus review team.")+`<div class="panel" style="margin-bottom:14px"><div class="panel-title"><h3>${["warden","admin"].includes(currentProfile.role)?"Hostel allocation register":"My room allocation"}</h3><span class="page-kicker">WARDEN MANAGED</span></div>${allocations.map(a=>`<div class="application-row"><div class="row-icon">⌂</div><div class="row-main"><b>${esc(a.studentName||"Resident")}</b><small>${esc(a.hostel||"Hostel not set")} · Room ${esc(a.room||"—")}</small><small>${esc(a.notes||"")}</small></div></div>`).join("")||empty("⌂","No allocation records","Room allocations entered by the Warden will appear here.")}</div><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:12px">${items.map((item,index)=>`<button class="quick-action" data-hostel="${index}"><span>${item[0]}</span><b>${esc(item[1])}</b><small>${esc(item[2])}</small></button>`).join("")}</div><p class="text-muted" style="font-size:12px;margin-top:15px">Emergency services are not contacted by this website. Use your institution's official emergency number for urgent situations.</p>`;
  document.querySelectorAll("[data-hostel]").forEach(button=>button.onclick=()=>{const index=Number(button.dataset.hostel);if(index===4)return openApplicationForm();const [icon,title] = items[index];openModal(`<span class="eyebrow">HOSTEL SERVICES</span><h2>${esc(title)}</h2><p>Your request will be added to the same campus application queue.</p><form id="hostel-form"><div class="field"><label>Details</label><textarea name="details" required maxlength="4000" rows="4" placeholder="Describe what you need…"></textarea></div><button class="btn btn-primary btn-block">Submit request</button></form>`);$("hostel-form").onsubmit=async event=>{event.preventDefault();const details=new FormData(event.currentTarget).get("details");try{await addDoc(collection(db,"applications"),{type:title,title,details,studentUid:currentUser.uid,studentName:currentProfile.name,university:currentProfile.university,universityKey:currentProfile.universityKey,status:"pending",createdAt:serverTimestamp(),updatedAt:serverTimestamp(),history:[{status:"pending",by:currentUser.uid,at:new Date().toISOString(),comment:"Request submitted"}]});closeModal();toast("Hostel request submitted.");await renderPage("applications");}catch(error){toast("Request failed: "+friendlyAuthError(error));}};});
}
function renderProfile() {
  const p=currentProfile;
  $("page-content").innerHTML=pageHeading("YOUR CAMPUS IDENTITY","My profile","Manage your contact and academic details; request staff approval to move campuses.")+`<div class="panel" style="margin-bottom:14px"><b>Campus membership: ${esc(p.membershipStatus||"pending")}</b><p class="text-muted">${p.membershipStatus==="verified"?"Your campus membership has been verified.":"You can use profile and application features. Directory and messaging unlock after a Warden, Faculty member or University Administrator approves your enrolment."}</p></div><div class="profile-layout"><section class="panel profile-card"><div class="profile-avatar">${esc(initials(p.name))}</div><h3>${esc(p.name)}</h3><p>${esc(p.degree||p.department||"University member")} · ${esc(p.university)}</p><div style="margin:15px 0;text-align:left"><div class="meta-line"><span>Profile completion</span><b>${profileCompletionPercent(p)}%</b></div><div style="height:7px;border-radius:99px;background:var(--panel2);overflow:hidden"><div style="height:100%;width:${profileCompletionPercent(p)}%;background:linear-gradient(90deg,var(--cyan),var(--violet));border-radius:99px"></div></div></div><span class="status ${p.membershipStatus==="verified"?"approved":"pending"}">${esc(p.membershipStatus==="verified"?"Campus verified":"Awaiting verification")}</span><div class="profile-meta"><div class="meta-line"><span>Registration ID</span><b>${esc(p.collegeId||"—")}</b></div><div class="meta-line"><span>Role</span><b>${esc(roleLabel(currentProfile.role))}</b></div><div class="meta-line"><span>Email</span><b>${esc(p.email||currentUser.email)}</b></div><div class="meta-line"><span>Phone</span><b>${esc(p.phone||"Not added")}</b></div></div></section>
    <section class="panel"><div class="panel-title"><h3>Edit profile</h3></div><form id="profile-edit" class="form-grid"><div class="field"><label>Full name</label><input name="name" value="${esc(p.name)}" required></div><div class="field"><label>College short name</label><input name="universityShortName" value="${esc(p.universityShortName||"")}" placeholder="e.g. LPU" required></div><div class="field"><label>Registration ID</label><input name="collegeId" value="${esc(p.collegeId)}" required></div><div class="field"><label>Phone</label><input name="phone" type="tel" value="${esc(p.phone)}"></div><div class="field"><label>Degree / programme</label><input name="degree" value="${esc(p.degree||p.department)}" required></div><div class="field"><label>Course</label><input name="course" value="${esc(p.course)}" required></div><div class="field"><label>Year</label><select name="year" required>${[1,2,3,4,5,6].map(n=>`<option value="${n}" ${String(p.year)===String(n)?"selected":""}>Year ${n}</option>`).join("")}</select></div><div class="field"><label>Hostel</label><input name="hostel" value="${esc(p.hostel)}"></div><div class="field"><label>Room</label><input name="room" value="${esc(p.room)}"></div><div class="field full"><label>Bio</label><textarea name="bio" rows="3">${esc(p.bio)}</textarea></div><div class="field full"><button class="btn btn-primary">Save changes ↗</button></div></form><div class="nav-divider"></div><h3>Change campus community</h3><p class="text-muted">To prevent someone silently changing their university and accessing another campus, a destination-campus administrator must approve the transfer.</p><button class="btn btn-ghost" id="request-campus-change">Request campus change</button></section></div>`;
  $("profile-edit").onsubmit=async event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));data.degree=String(data.degree||"").trim();data.department=data.degree;data.degreeKey=normaliseSearch(data.degree);data.courseKey=normaliseSearch(data.course);data.hostelKey=normaliseSearch(data.hostel);try{await updateDoc(doc(db,"profiles",currentUser.uid),{...data,year:Number(data.year),updatedAt:serverTimestamp()});currentProfile={...currentProfile,...data,year:Number(data.year)};$("top-name").textContent=data.name;$("top-avatar").textContent=initials(data.name);toast("Profile updated.");await renderPage("profile",false);}catch(error){toast("Update failed: "+friendlyAuthError(error));}};
  $("request-campus-change").onclick=openCampusChangeRequest;
}
function openCampusChangeRequest() {
  openModal(`<span class="eyebrow">CAMPUS MEMBERSHIP</span><h2>Request another campus</h2><p>Enter the official university name. Its short form will match only when the alias is configured in NeonVerse. A staff member at the destination campus must verify and approve your request.</p><form id="campus-change-form"><div class="field"><label>Requested university / campus *</label><input name="university" required placeholder="Official campus name"></div><div class="field"><label>Registration ID at that campus *</label><input name="collegeId" required></div><div class="field"><label>Reason (optional)</label><textarea name="reason" rows="3"></textarea></div><button class="btn btn-primary btn-block">Submit campus change request</button></form>`);
  $("campus-change-form").onsubmit=async event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));const university=data.university.trim(),key=campusKeyFor(university);if(!key||key===currentProfile.universityKey)return toast("Enter a different campus name.");try{await addDoc(collection(db,"campusChangeRequests"),{studentUid:currentUser.uid,studentName:currentProfile.name,collegeId:data.collegeId,currentUniversity:currentProfile.university,currentUniversityKey:currentProfile.universityKey,requestedUniversity:university,requestedUniversityKey:key,reason:data.reason||"",status:"pending",createdAt:serverTimestamp()});closeModal();toast("Campus change request sent for destination-campus review.");}catch(error){toast("Could not submit request: "+friendlyAuthError(error));}};
}
function renderSettings() {
  const savedScale = localStorage.getItem("neonverse-text-scale") || "1.08";
  $("page-content").innerHTML=pageHeading("PREFERENCES","Settings","Personalise your NeonVerse experience.")+`<div class="grid dashboard-grid"><section class="panel"><div class="panel-title"><h3>Appearance & accessibility</h3></div><p class="text-muted">Choose a comfortable theme and readable text size. These preferences are saved on this device.</p><div class="field"><label>Colour theme</label><button class="btn btn-ghost" id="settings-theme">Toggle light / dark mode</button></div><div class="field"><label for="text-scale">Interface text size</label><select id="text-scale" class="select-small"><option value="0.95" ${savedScale==="0.95"?"selected":""}>Compact</option><option value="1" ${savedScale==="1"?"selected":""}>Default</option><option value="1.08" ${savedScale==="1.08"?"selected":""}>Comfortable (recommended)</option><option value="1.16" ${savedScale==="1.16"?"selected":""}>Large</option></select></div><div class="nav-divider"></div><div class="panel-title"><h3>Guided tour</h3></div><p class="text-muted">Take a quick tour of your workspace.</p><button class="btn btn-ghost" id="start-tour">Start website tour</button></section><section class="panel"><div class="panel-title"><h3>Account</h3></div><p class="text-muted">Signed in as ${esc(currentUser.email)}.</p><p class="text-muted">Role: ${esc(roleLabel(currentProfile.role))} · Campus: ${esc(currentProfile.university||"Not set")}</p><button class="btn btn-ghost" id="settings-signout">Sign out</button><div class="nav-divider"></div><div class="panel-title"><h3>Feature availability</h3></div><p class="text-muted">Available: role-based student, Warden, Faculty and University Admin workspaces; campus identity review; directory and messaging; class, subject, hostel and club channels; assignments; attendance entries; university calendar; hostel allocations and requests; official and casual notice boards; clubs, events, applications and account restrictions. Not included: file uploads, voice/video calling, push notifications, official LPU ERP/UMS sync, payment processing or emergency dispatch.</p><p class="text-muted">Campus figures are shown from records currently loaded from Firestore. NeonVerse does not invent official university totals or claim a live LPU ERP connection.</p></section></div>`;
  $("settings-theme").onclick=themeToggle;$("text-scale").onchange=event=>{applyTextScale(event.target.value);toast("Text size preference saved.");};$("start-tour").onclick=()=>{tourIndex=0;showTour();};$("settings-signout").onclick=doSignout;
}

async function addNotification(recipientUid, data) {
  if (!recipientUid || recipientUid===currentUser.uid) return;
  try { await addDoc(collection(db,"notifications",recipientUid,"items"),{...data,universityKey:currentProfile.universityKey,read:false,createdAt:serverTimestamp()}); }
  catch (error) { console.debug("Notification could not be created",error.code||error.message); }
}
function listenForNotifications() {
  if (unsubscribeNotifications) unsubscribeNotifications();
  const q=query(collection(db,"notifications",currentUser.uid,"items"),where("read","==",false),limit(40));
  unsubscribeNotifications=onSnapshot(q,snapshot=>{
    const button=$("notification-button"); if(!button)return;
    const badge=button.querySelector("i");
    button.classList.toggle("has-notifications",!snapshot.empty);
    if(badge) badge.textContent=snapshot.size>9?"9+":String(snapshot.size||"");
    button.setAttribute("aria-label",snapshot.empty?"Notifications":"Notifications, "+snapshot.size+" unread items");
  },error=>console.debug("Notification listener",error.code));
}
async function openNotifications() {
  try {
    const q=query(collection(db,"notifications",currentUser.uid,"items"),orderBy("createdAt","desc"),limit(50));
    const snap=await getDocs(q);const notices=snap.docs.map(item=>({id:item.id,...item.data()}));
    const unread=notices.filter(item=>!item.read);
    openModal(`<span class="eyebrow">CAMPUS UPDATES</span><div class="notification-heading"><div><h2>Notifications</h2><p>${unread.length} unread · Messages, application decisions and account updates.</p></div>${unread.length?'<button class="btn btn-ghost btn-small" id="mark-all-notifications-read">Mark all read</button>':""}</div><div class="notification-list">${notices.length?notices.map(item=>`<article class="notification-item ${item.read?"":"unread"}" data-notification="${esc(item.id)}"><b>${esc(item.title||"Campus notification")}</b><p>${esc(item.body||"")}</p><small>${esc(dateText(item.createdAt))}</small><div class="notification-actions">${!item.read?`<button class="subtle-link" data-read-notification="${esc(item.id)}">Mark as read</button>`:""}<button class="subtle-link" data-delete-notification="${esc(item.id)}">Delete</button></div></article>`).join(""):empty("♧","You're all caught up","New messages and campus updates will appear here.")}</div>`);
    document.querySelectorAll("[data-read-notification]").forEach(button=>button.onclick=async()=>{try{await updateDoc(doc(db,"notifications",currentUser.uid,"items",button.dataset.readNotification),{read:true,readAt:serverTimestamp()});button.closest(".notification-item").classList.remove("unread");button.remove();}catch(error){toast("Could not mark notification: "+friendlyAuthError(error));}});
    document.querySelectorAll("[data-delete-notification]").forEach(button=>button.onclick=async()=>{try{await deleteDoc(doc(db,"notifications",currentUser.uid,"items",button.dataset.deleteNotification));button.closest(".notification-item").remove();}catch(error){toast("Could not delete notification: "+friendlyAuthError(error));}});
    if($("mark-all-notifications-read")) $("mark-all-notifications-read").onclick=async()=>{try{await Promise.all(unread.map(item=>updateDoc(doc(db,"notifications",currentUser.uid,"items",item.id),{read:true,readAt:serverTimestamp()})));document.querySelectorAll(".notification-item.unread").forEach(item=>item.classList.remove("unread"));document.querySelectorAll("[data-read-notification]").forEach(button=>button.remove());$("mark-all-notifications-read").remove();toast("All notifications marked as read.");}catch(error){toast("Could not update notifications: "+friendlyAuthError(error));}};
  } catch (error) { toast("Could not load notifications: "+friendlyAuthError(error)); }
}

const tour = [
  ["Your overview","overview","Your dashboard shows campus status, application counts and role-specific shortcuts."],
  ["Applications","applications","Review requests, check statuses and follow application history."],
  ["Messages & groups","messages","Open direct messages and campus conversations."],
  ["Student directory","directory","Find verified members of your campus."],
  ["Notice board","notices","Read official campus announcements and notices."],
  ["Academics","academics","Explore assignments, attendance and academic calendar tools."],
  ["Hostel services","hostel","Manage hostel requests and services available to your role."],
  ["Events & clubs","events","Discover clubs, create societies (staff) and manage campus events."],
  ["AI Work","ai-work","Give Agent37 multi-step campus tasks and review its execution history."],
  ["Profile & settings","settings","Manage your profile, preferences and restart this guided tour."]
];
async function showTour() {
  const item=tour[tourIndex]; $("tour-step").textContent=`${String(tourIndex+1).padStart(2,"0")} / ${String(tour.length).padStart(2,"0")}`;
  $("tour-title").textContent=item[0]; $("tour-copy").textContent=item[2]; $("tour-overlay").classList.remove("hidden");
  $("tour-next").textContent=tourIndex===tour.length-1?"Finish ✓":"Next →";
  if(currentPage!==item[1]) await renderPage(item[1]);
  const target=document.querySelector("#page-content");
  if(target) { target.scrollIntoView({behavior:"smooth",block:"start"}); target.classList.add("tour-page-focus"); setTimeout(()=>target.classList.remove("tour-page-focus"),1200); }
}
function maybeTour() { if(!localStorage.getItem("neonverse-tour-done")){tourIndex=0;showTour();} }
async function globalSearch() {
  if(!isProfileComplete(currentProfile))return openProfileCompletion(true);
  openModal(`<span class="eyebrow">QUICK NAVIGATION</span><h2>Search NeonVerse</h2><p>Find a workspace section or a person in your campus.</p><input class="search-input" id="global-search-input" placeholder="Search pages, people, departments, email, ID or campus short name…"><div class="search-results" id="global-search-results"></div>`);
  const input=$("global-search-input"),pages=["Overview","Applications","Messages","Student directory","Notice board","Academics","Hostel services","Events & clubs","Class & subject groups","My profile","Settings",...(currentProfile.role==="faculty"?["Faculty workspace"]:[]),...(currentProfile.role==="warden"?["Warden workspace"]:[]),...(currentProfile.role==="admin"?["University administration"]:[])];
  const draw=async()=>{const term=normaliseSearch(input.value);let html=pages.filter(page=>normaliseSearch(page).includes(term)).map(page=>`<div class="search-result" data-search-page="${esc(page)}"><b>${esc(page)}</b><small>Open workspace section</small></div>`).join("");if(term.length>=2 && communityVerified()){try{if(!peopleCache.length)peopleCache=await getCampusPeople();html+=peopleCache.filter(person=>normaliseSearch([person.name,person.email,person.phone,person.collegeId,person.university,person.universityShortName].join(" ")).includes(term)).slice(0,12).map(person=>`<div class="search-result" data-search-person="${esc(person.uid)}"><b>${esc(person.name)}</b><small>${esc(person.department||"")} · ${esc(person.collegeId||"")}</small></div>`).join("");}catch(error){console.debug(error);}}$("global-search-results").innerHTML=html||empty("⌕","No matching results","Try another search term.");document.querySelectorAll("[data-search-page]").forEach(el=>el.onclick=()=>{const pageMap={"Student directory":"directory","Notice board":"notices","Hostel services":"hostel","Events & clubs":"events","Class & subject groups":"channels","Faculty workspace":"faculty","Warden workspace":"warden","University administration":"university","My profile":"profile"};closeModal();renderPage(pageMap[el.dataset.searchPage]||el.dataset.searchPage.toLowerCase());});document.querySelectorAll("[data-search-person]").forEach(el=>el.onclick=()=>{closeModal();showStudentProfile(el.dataset.searchPerson);});};
  input.oninput=draw;await draw();input.focus();
}
// Agent37 chat widget. Secrets stay in the Vercel serverless function; the
// browser sends only a Firebase ID token, the user's message and display context.
// AI Work state is declared once near renderAiWorkPlan above.

let agent37Busy = false;
let agent37ConversationId = null;
let agent37History = [];
const agent37HistoryLimit = 30;
function setAgent37Visible(visible) {
  const root = $("agent37-widget");
  if (!root) return;
  root.classList.toggle("hidden", !visible || !currentUser);
  if (!visible) {
    const panel = $("agent37-panel");
    if (panel) panel.classList.add("hidden");
    const launcher = $("agent37-launcher");
    if (launcher) launcher.setAttribute("aria-expanded", "false");
  }
}
function agent37ConversationStorageKey() { return `neonverse-agent37-conversation-${currentUser?.uid || "guest"}`; }
function agent37HistoryStorageKey() { return `neonverse-agent37-history-${currentUser?.uid || "guest"}-${agent37ConversationId || "new"}`; }
function getAgent37ConversationId() {
  if (!currentUser) return null;
  const key = agent37ConversationStorageKey();
  let id = localStorage.getItem(key);
  if (!id || !/^[A-Za-z0-9_-]{12,80}$/.test(id)) {
    id = (globalThis.crypto?.randomUUID?.() || `nv_${currentUser.uid}_${Date.now()}_${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "_");
    localStorage.setItem(key, id);
  }
  return id;
}
function saveAgent37History() {
  if (!currentUser) return;
  try { localStorage.setItem(agent37HistoryStorageKey(), JSON.stringify(agent37History.slice(-agent37HistoryLimit))); }
  catch (error) { console.warn("Agent37 chat history could not be saved locally", error); }
}
function addAgent37Message(role, text, persist = true) {
  const entry = {role, text:String(text || ""), at:Date.now()};
  agent37History.push(entry);
  if (agent37History.length > agent37HistoryLimit) agent37History = agent37History.slice(-agent37HistoryLimit);
  const list = $("agent37-messages");
  if (list) {
    const row = document.createElement("div");
    row.className = `agent37-message ${role === "user" ? "user" : role === "error" ? "error" : "assistant"}`;
    const bubble = document.createElement("div");
    bubble.className = "agent37-bubble";
    bubble.textContent = entry.text;
    row.appendChild(bubble);
    list.appendChild(row);
    list.scrollTop = list.scrollHeight;
  }
  if (persist) saveAgent37History();
}
function renderAgent37History() {
  const list = $("agent37-messages");
  if (!list) return;
  list.replaceChildren();
  agent37History.forEach(item => {
    const row = document.createElement("div");
    row.className = `agent37-message ${item.role === "user" ? "user" : item.role === "error" ? "error" : "assistant"}`;
    const bubble = document.createElement("div");
    bubble.className = "agent37-bubble";
    bubble.textContent = item.text;
    row.appendChild(bubble);
    list.appendChild(row);
  });
  list.scrollTop = list.scrollHeight;
}
function initialiseAgent37Conversation() {
  if (!currentUser) return;
  agent37ConversationId = getAgent37ConversationId();
  try {
    const stored = JSON.parse(localStorage.getItem(agent37HistoryStorageKey()) || "[]");
    agent37History = Array.isArray(stored) ? stored.filter(item => item && ["user","assistant","error"].includes(item.role) && typeof item.text === "string").slice(-agent37HistoryLimit) : [];
  } catch { agent37History = []; }
  if (!agent37History.length) {
    const role = roleLabel(currentProfile?.role || "student");
    agent37History = [{role:"assistant", text:`Hi ${currentProfile?.name || "there"}! I'm NeonVerse AI, powered by Agent37. I can guide you through the website as a ${role.toLowerCase()}—for example, applications, clubs, messages, hostel services and admin tools. I cannot view your private records or perform actions. What would you like help with?`, at:Date.now()}];
    saveAgent37History();
  }
  renderAgent37History();
}
function setAgent37Typing(show) {
  const list = $("agent37-messages");
  if (!list) return;
  const existing = $("agent37-typing-row");
  if (existing) existing.remove();
  if (show) {
    const row = document.createElement("div");
    row.id = "agent37-typing-row";
    row.className = "agent37-message assistant";
    const bubble = document.createElement("div");
    bubble.className = "agent37-bubble";
    const dots = document.createElement("span");
    dots.className = "agent37-typing";
    dots.setAttribute("aria-label", "Agent37 is thinking");
    for (let i=0;i<3;i++) dots.appendChild(document.createElement("i"));
    bubble.appendChild(dots); row.appendChild(bubble); list.appendChild(row); list.scrollTop = list.scrollHeight;
  }
}
async function sendAgent37Message(event) {
  event?.preventDefault?.();
  const input = $("agent37-input");
  const send = $("agent37-send");
  const message = String(input?.value || "").trim();
  const senderUid = currentUser?.uid;
  if (!message || agent37Busy || !currentUser) return;
  if (message.length > 2500) { toast("Please keep your message under 2,500 characters."); return; }
  input.value = "";
  addAgent37Message("user", message);
  agent37Busy = true;
  if (send) send.disabled = true;
  setAgent37Typing(true);
  try {
    const idToken = await currentUser.getIdToken();
    const response = await fetch("/api/agent37-chat", {
      method:"POST",
      headers:{"Content-Type":"application/json", "Authorization":`Bearer ${idToken}`},
      body:JSON.stringify({
        message,
        conversationId:agent37ConversationId,
        role:currentProfile?.role || "student",
        campus:currentProfile?.university || currentProfile?.universityShortName || ""
      })
    });
    const result = await response.json().catch(() => ({}));
    if (currentUser?.uid !== senderUid) return;
    if (!response.ok) {
      const friendly = result.error || (response.status === 503 ? "Agent37 is not configured yet. Follow the setup guide in the project ZIP." : "The AI assistant could not respond. Please try again.");
      throw new Error(friendly);
    }
    if (!result.reply || typeof result.reply !== "string") throw new Error("Agent37 returned an empty reply. Please try again.");
    setAgent37Typing(false);
    addAgent37Message("assistant", result.reply);
  } catch (error) {
    if (currentUser?.uid !== senderUid) return;
    setAgent37Typing(false);
    const messageText = error?.name === "AbortError" ? "The request timed out. Check that your Agent37 instance is running, then try again." : (error?.message || "The AI assistant is temporarily unavailable.");
    addAgent37Message("error", messageText);
  } finally {
    agent37Busy = false;
    if (send) send.disabled = false;
    input?.focus();
  }
}
function startNewAgent37Chat() {
  if (!currentUser || agent37Busy) return;
  if (!confirm("Start a new AI conversation? Your previous conversation will remain in this browser's local history.")) return;
  agent37ConversationId = (globalThis.crypto?.randomUUID?.() || `nv_${currentUser.uid}_${Date.now()}_${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "_");
  localStorage.setItem(agent37ConversationStorageKey(), agent37ConversationId);
  agent37History = [];
  initialiseAgent37Conversation();
}
function initialiseAgent37Widget() {
  if ($("agent37-widget")?.dataset.ready === "1") return;
  const root = $("agent37-widget");
  if (!root) return;
  root.dataset.ready = "1";
  $("agent37-launcher").addEventListener("click", () => {
    const panel = $("agent37-panel");
    const opening = panel.classList.contains("hidden");
    panel.classList.toggle("hidden", !opening);
    $("agent37-launcher").setAttribute("aria-expanded", String(opening));
    if (opening) { initialiseAgent37Conversation(); $("agent37-input").focus(); }
  });
  $("agent37-close").addEventListener("click", () => {
    $("agent37-panel").classList.add("hidden");
    $("agent37-launcher").setAttribute("aria-expanded", "false");
  });
  $("agent37-form").addEventListener("submit", sendAgent37Message);
  $("agent37-new-chat").addEventListener("click", startNewAgent37Chat);
  $("agent37-quick-prompts").addEventListener("click", event => {
    const button = event.target.closest("[data-agent37-prompt]");
    if (!button || agent37Busy) return;
    $("agent37-input").value = button.dataset.agent37Prompt || "";
    $("agent37-form").requestSubmit();
  });
}

async function doSignout() {
  if(unsubscribeMessages)unsubscribeMessages();if(unsubscribeNotifications)unsubscribeNotifications();
  stopSessionWatchers();
  await signOut(auth);currentUser=null;currentProfile=null;activeConversation=null;conversationCache=[];peopleCache=[];pageHistory=[];showLanding();toast("You have signed out.");
}

// Navigation, modal and app controls.
initialiseAgent37Widget();
document.addEventListener("click",event=>{
  const theme=event.target.closest(".theme-toggle");if(theme)themeToggle();
  if(event.target.closest("#ai-work-top-button")){if(!isProfileComplete(currentProfile)){openProfileCompletion(true);return;}renderPage("ai-work");}
  const nav=event.target.closest(".side-link[data-page]");if(nav){if(!isProfileComplete(currentProfile)){openProfileCompletion(true);return;}renderPage(nav.dataset.page);}
});
$("open-auth").onclick=$("hero-enter").onclick=$("closing-enter").onclick=showAuth;
$("back-home").onclick=showLanding;
document.querySelectorAll("[data-auth-mode]").forEach(button=>button.onclick=()=>setAuthMode(button.dataset.authMode));
$("auth-form").onsubmit=handleEmailAuth;$("google-signin").onclick=googleLogin;
$("warden-mode").onclick=()=>{roleMode=!roleMode;$("warden-box").classList.toggle("hidden",!roleMode);$("warden-mode").textContent=roleMode?"Student access":"Staff access";$("auth-sub").textContent=roleMode?"Sign in with your university-authorised Warden, Faculty or Admin account.":"Continue with your university account.";};
$("signout").onclick=doSignout;$("notification-button").onclick=openNotifications;$("global-search").onclick=globalSearch;$("app-menu").onclick=()=>{$("sidebar").classList.toggle("open");$("sidebar-scrim").classList.toggle("show");};$("sidebar-scrim").onclick=closeSidebar;
$("user-chip").onclick=()=>renderPage("profile");$("nav-back").onclick=goBack;
$("modal-close").onclick=()=>closeModal();$("modal-backdrop").onclick=event=>{if(event.target===$("modal-backdrop"))closeModal();};
$("tour-next").onclick=async()=>{if(tourIndex<tour.length-1){tourIndex++;await showTour();}else{$("tour-overlay").classList.add("hidden");localStorage.setItem("neonverse-tour-done","1");toast("You're ready to explore NeonVerse.");}};
$("tour-skip").onclick=()=>{$("tour-overlay").classList.add("hidden");localStorage.setItem("neonverse-tour-done","1");};
document.addEventListener("keydown",event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="k"){event.preventDefault();if(currentUser)globalSearch();}if(event.key==="Escape"){if(!lockedModal)closeModal();$("tour-overlay").classList.add("hidden");closeSidebar();}});
loadTheme();
if(firebaseReady){onAuthStateChanged(auth,async user=>{
  // Firebase emits an auth-state event immediately after account creation and
  // password sign-in. Do not let an unverified password account bypass the
  // email-verification gate while the form handler sends/resends its link.
  if (user && !user.emailVerified) { showAuth(); return; }
  if(user&&!currentUser){await finishLogin(user);}else if(!user&&currentUser){stopSessionWatchers();currentUser=null;currentProfile=null;showLanding();}
});}
