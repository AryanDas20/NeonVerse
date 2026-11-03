import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, onAuthStateChanged, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, getDocs,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, arrayUnion
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
let currentPage = "overview", pageHistory = [], tourIndex = 0, lockedModal = false;
let conversationCache = [], peopleCache = [], peopleSearchTimer = null;
const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const initials = value => String(value || "N").trim().split(/\s+/).slice(0, 2).map(v => v[0] || "").join("").toUpperCase();
const roleLabel = role => ({student:"Student",warden:"Warden",admin:"Administrator",faculty:"Faculty",verifier:"College verifier"}[role] || "Student");
const isStaff = () => ["warden", "admin", "faculty", "verifier"].includes(currentProfile?.role);
const canVerifyStudents = () => ["admin", "verifier"].includes(currentProfile?.role);
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
function showLanding() { $("auth-screen").classList.add("hidden"); $("app-shell").classList.add("hidden"); $("landing").classList.remove("hidden"); }
function showAuth() { $("landing").classList.add("hidden"); $("app-shell").classList.add("hidden"); $("auth-screen").classList.remove("hidden"); }
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
    "permission-denied":"Firestore denied this action. Confirm the latest firestore.rules are published and that your campus profile is complete.",
    "failed-precondition":"Firestore needs an index for this query. Open the index creation link in the Firebase error and wait until it is Enabled."
  };
  return messages[error?.code] || error?.message || "Something went wrong. Please try again.";
}
async function getRole(uid) {
  const roleSnap = await getDoc(doc(db, "roles", uid));
  return roleSnap.exists() ? roleSnap.data().role : "student";
}
async function ensureProfile(user, extra = {}) {
  const ref = doc(db, "profiles", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const university = String(extra.university || "").trim();
    const profile = {
      uid:user.uid, name:extra.name || user.displayName || user.email?.split("@")[0] || "Student",
      email:user.email || "", phone:"", collegeId:"", university,
      universityKey:campusKeyFor(university), membershipStatus:"pending", department:"", course:"", year:"",
      hostel:"", room:"", bio:"", role:"student", profileComplete:false,
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
async function finishLogin(user, extra = {}) {
  currentUser = user;
  try {
    const [role, profile] = await Promise.all([getRole(user.uid), ensureProfile(user, extra)]);
    currentProfile = {...profile, role};
    $("auth-screen").classList.add("hidden"); $("landing").classList.add("hidden"); $("app-shell").classList.remove("hidden");
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
    profile.universityKey && profile.collegeId?.trim() && profile.department?.trim() &&
    profile.course?.trim() && String(profile.year || "").trim());
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
      if (!name || !university) throw new Error("Enter your full name and university.");
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, {displayName:name});
      await ensureProfile(credential.user, {name, university});
      await finishLogin(credential.user, {name, university});
    } else {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      if (roleMode) {
        const role = await getRole(credential.user.uid);
        if (!["warden", "admin"].includes(role)) { await signOut(auth); throw new Error("This account is not authorised for warden access. Contact your university administrator."); }
      }
      await finishLogin(credential.user);
    }
  } catch (error) { setAuthError(friendlyAuthError(error)); }
  finally { button.disabled = false; setAuthMode(authMode); }
}
async function googleLogin() {
  if (!requireFirebase()) return;
  clearAuthError();
  try {
    const provider = new GoogleAuthProvider(); provider.setCustomParameters({prompt:"select_account"});
    const result = await signInWithPopup(auth, provider);
    if (roleMode) {
      const role = await getRole(result.user.uid);
      if (!["warden", "admin"].includes(role)) { await signOut(auth); throw new Error("This Google account is not authorised for warden access."); }
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
      <div class="field"><label>University / campus *</label><input name="university" required value="${esc(p.university)}" placeholder="e.g. Lovely Professional University"></div>
      <div class="field"><label>Registration / college ID *</label><input name="collegeId" required value="${esc(p.collegeId)}" autocomplete="off"></div>
      <div class="field"><label>Phone number</label><input name="phone" type="tel" value="${esc(p.phone)}" autocomplete="tel"></div>
      <div class="field"><label>Department *</label><input name="department" required value="${esc(p.department)}"></div>
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
    const required = [form.name, campus, form.collegeId, form.department, form.course, form.year];
    if (required.some(value => !String(value || "").trim())) { toast("Complete every field marked with *."); return; }
    const existingKey = currentProfile.universityKey || "";
    const newKey = campusKeyFor(campus);
    if (isProfileComplete(currentProfile) && existingKey !== newKey) {
      toast("Use Request campus change in your profile to move to another university community."); return;
    }
    try {
      await updateDoc(doc(db, "profiles", currentUser.uid), {
        ...form, year:Number(form.year), university:campus, universityKey:newKey,
        email:currentUser.email || currentProfile.email || "", profileComplete:true, updatedAt:serverTimestamp()
      });
      currentProfile = {...currentProfile, ...form, year:Number(form.year), university:campus, universityKey:newKey, profileComplete:true};
      closeModal(true); await loadWorkspace(); maybeTour(); toast("Your campus profile is complete.");
    } catch (error) { toast("Could not save profile: " + friendlyAuthError(error)); }
  };
}

function themeToggle() {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next; localStorage.setItem("neonverse-theme", next);
}
function loadTheme() {
  const saved = localStorage.getItem("neonverse-theme");
  document.documentElement.dataset.theme = saved || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
}
function pageHeading(kicker, title, description, action = "") {
  return `<div class="page-heading"><div><div class="page-kicker">${esc(kicker)}</div><h1>${title}</h1><p>${esc(description)}</p></div>${action}</div>`;
}
function empty(icon, title, description) {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><b>${esc(title)}</b><p>${esc(description)}</p></div>`;
}
async function loadWorkspace() {
  if (!currentUser || !db) return;
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
  const labels = {overview:"Overview",applications:"Applications",messages:"Messages",directory:"Student directory",notices:"Notice board",academics:"Academics",hostel:"Hostel services",events:"Events & clubs",profile:"My profile",settings:"Settings"};
  $("page-crumb").textContent = labels[page] || "Overview";
  closeSidebar();
  $("page-content").innerHTML = `<div class="loading-state"><div class="loader"></div>Loading ${esc((labels[page] || "workspace").toLowerCase())}…</div>`;
  try {
    const renderers = {overview:renderOverview,applications:renderApplications,messages:renderMessages,directory:renderDirectory,notices:renderNotices,academics:renderAcademics,hostel:renderHostel,events:renderEvents,profile:renderProfile,settings:renderSettings};
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
    ["Campus identity", "Complete", "Required profile details saved", "◉"],
    ["Community", "Connected", currentProfile.university, "✳"]
  ];
  $("page-content").innerHTML = pageHeading("CAMPUS CONTROL CENTRE", `Welcome, ${esc((currentProfile.name || "there").split(" ")[0])}.`, "Your university workspace at a glance.", `<button class="btn btn-primary btn-small" id="new-app">＋ New application</button>`) +
    `<div class="grid stats-grid">${cards.map((card,i)=>`<div class="stat-card" style="--glow:${["#55e6f2","#a78bfa","#67e6b1","#ffb76a"][i]}"><span class="stat-icon">${card[3]}</span><div class="stat-label">${esc(card[0])}</div><div class="stat-value">${esc(card[1])}</div><div class="stat-foot">${esc(card[2])}</div></div>`).join("")}</div>
    <div class="grid dashboard-grid"><section class="panel"><div class="panel-title"><h3>${staff?"Applications needing review":"Recent applications"}</h3><button class="subtle-link" data-go="applications">View all →</button></div>${appRows(applications.slice(0,6))}</section>
    <section class="panel"><div class="panel-title"><h3>Quick actions</h3><span class="page-kicker">YOUR SHORTCUTS</span></div><div class="quick-grid"><button class="quick-action" data-action="new-app"><span>▤</span><b>Apply for leave</b><small>Start a new request</small></button><button class="quick-action" data-go="messages"><span>✉</span><b>Open messages</b><small>Continue conversations</small></button><button class="quick-action" data-go="directory"><span>◎</span><b>Find students</b><small>Search your campus</small></button><button class="quick-action" data-go="hostel"><span>⌂</span><b>Hostel services</b><small>Send a service request</small></button></div></section></div>`;
  $("new-app").onclick = openApplicationForm;
  document.querySelectorAll("[data-go]").forEach(button => button.onclick = () => renderPage(button.dataset.go));
  document.querySelectorAll('[data-action="new-app"]').forEach(button => button.onclick = openApplicationForm);
}
function openApplicationForm() {
  openModal(`<span class="eyebrow">STUDENT SERVICES</span><h2>New application</h2><p>Submit a request to your campus review team.</p>
    <form id="application-form"><div class="field"><label>Application type *</label><select name="type" required><option>Hostel leave</option><option>Medical leave</option><option>Emergency leave</option><option>Event permission</option><option>Hostel room request</option><option>Maintenance request</option><option>Visitor pass</option><option>Other</option></select></div>
    <div class="field"><label>Subject *</label><input name="title" required maxlength="100" placeholder="e.g. Weekend hostel leave"></div><div class="form-grid"><div class="field"><label>From date</label><input name="fromDate" type="date"></div><div class="field"><label>To date</label><input name="toDate" type="date"></div></div>
    <div class="field"><label>Reason / details *</label><textarea name="details" rows="4" required maxlength="4000"></textarea></div><div class="field"><label>Supporting document reference (optional)</label><input name="documentNote" placeholder="Document name or reference; no upload"></div><button class="btn btn-primary btn-block" type="submit">Submit application ↗</button></form>`);
  $("application-form").onsubmit = submitApplication;
}
async function submitApplication(event) {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget));
  try {
    await addDoc(collection(db,"applications"), {...data, studentUid:currentUser.uid, studentName:currentProfile.name,
      university:currentProfile.university, universityKey:currentProfile.universityKey, status:"pending",
      createdAt:serverTimestamp(), updatedAt:serverTimestamp(), history:[{status:"pending",by:currentUser.uid,at:new Date().toISOString(),comment:"Application submitted"}]});
    closeModal(); toast("Application submitted successfully."); await renderPage("applications");
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
    <div class="content-card"><p><b>Reason</b><br>${esc(application.details)}</p><p><b>Dates</b><br>${esc(application.fromDate||"Not specified")} — ${esc(application.toDate||"Not specified")}</p><p><b>Supporting reference</b><br>${esc(application.documentNote||"None supplied")}</p><p><b>Reviewer comment</b><br>${esc(application.reviewComment||"No comment yet")}</p></div>
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
  if (!canVerifyStudents()) return toast("Only a campus administrator or verifier can approve campus transfers.");
  const requestSnap = await getDoc(doc(db,"campusChangeRequests",id));
  if (!requestSnap.exists()) return toast("Campus request not found.");
  const request = requestSnap.data();
  openModal(`<span class="eyebrow">CAMPUS MEMBERSHIP</span><h2>Review campus change</h2><div class="content-card"><p><b>Student</b><br>${esc(request.studentName)}</p><p><b>Current campus</b><br>${esc(request.currentUniversity)}</p><p><b>Requested campus</b><br>${esc(request.requestedUniversity)}</p><p><b>Registration ID</b><br>${esc(request.collegeId||"Not supplied")}</p></div><p>Approve only after checking the student's enrolment using your institution's own records.</p><div class="chat-tools"><button class="btn btn-primary" id="approve-campus">Approve transfer</button><button class="btn btn-ghost" id="reject-campus">Reject</button></div>`);
  $("approve-campus").onclick = () => processCampusChange(id,request,"approved");
  $("reject-campus").onclick = () => processCampusChange(id,request,"rejected");
}
async function processCampusChange(id, request, status) {
  if (!canVerifyStudents()) return toast("Only a campus administrator or verifier can approve campus transfers.");
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
  return snap.docs.map(item => ({uid:item.id,...item.data()})).filter(person => person.uid !== currentUser.uid && person.profileComplete !== false && person.membershipStatus === "verified");
}
function personCard(person) {
  const searchable = normaliseSearch([person.name,person.collegeId,person.email,person.phone,person.department,person.course,person.year].join(" "));
  return `<article class="content-card person-card" data-search="${esc(searchable)}"><div style="display:flex;align-items:center;gap:11px"><div class="user-avatar">${esc(initials(person.name))}</div><div><b style="font-size:13px">${esc(person.name)}</b><div class="text-muted" style="font-size:11px;margin-top:4px">${esc(person.department||"Campus member")}</div></div></div><p class="text-muted" style="font-size:11px">${esc(person.course||"")} ${person.year?`· Year ${esc(person.year)}`:""}</p><div class="meta-line"><span>Registration ID</span><b>${esc(person.collegeId||"Not shared")}</b></div><button class="btn btn-ghost btn-small" data-profile="${esc(person.uid)}">View profile ↗</button></article>`;
}
async function renderDirectory() {
  if (!communityVerified()) { $("page-content").innerHTML = pageHeading("CAMPUS COMMUNITY","Student directory","Find people from your verified campus community.") + `<div class="panel">${empty("◎","Membership verification pending","Your profile is complete, but a campus administrator or college verifier must confirm your student membership before you can browse the directory or start chats.")}</div>`; return; }
  peopleCache = await getCampusPeople();
  let pendingHtml = "";
  if (canVerifyStudents()) {
    const pendingQuery = query(collection(db,"profiles"), where("universityKey","==",currentProfile.universityKey), where("membershipStatus","==","pending"), limit(50));
    const pendingSnap = await getDocs(pendingQuery);
    const pending = pendingSnap.docs.map(item=>({uid:item.id,...item.data()})).filter(person=>person.uid!==currentUser.uid);
    pendingHtml = `<div class="panel" style="margin-bottom:14px"><div class="panel-title"><h3>Pending student verification</h3><span class="page-kicker">VERIFIER DESK</span></div>${pending.length?pending.map(person=>`<div class="application-row"><div class="row-main"><b>${esc(person.name)}</b><small>${esc(person.collegeId||"No registration ID")} · ${esc(person.department||"")} · ${esc(person.course||"")}</small></div><button class="btn btn-primary btn-small" data-verify-student="${esc(person.uid)}">Verify</button></div>`).join(""):empty("✓","No pending students","New student registrations awaiting verification will appear here.")}</div>`;
  }
  $("page-content").innerHTML = pendingHtml + pageHeading("CAMPUS COMMUNITY","Student directory","Search classmates by name, email, phone, registration ID or department.") +
    `<div class="panel"><div class="toolbar"><input id="directory-search" class="search-input" placeholder="Search by name, email, phone, registration ID…"></div><div id="people-list" class="grid" style="grid-template-columns:repeat(auto-fill,minmax(min(100%,230px),1fr));gap:12px">${peopleCache.map(personCard).join("")||empty("◎","No other profiles yet","Your campus directory will grow as students complete their profiles.")}</div></div>`;
  $("directory-search").oninput = () => { const term = normaliseSearch($("directory-search").value); document.querySelectorAll(".person-card").forEach(card => card.style.display = card.dataset.search.includes(term) ? "" : "none"); };
  document.querySelectorAll("[data-profile]").forEach(button => button.onclick = () => showStudentProfile(button.dataset.profile));
  document.querySelectorAll("[data-verify-student]").forEach(button => button.onclick = () => verifyCampusStudent(button.dataset.verifyStudent));
}
async function verifyCampusStudent(uid) {
  if (!canVerifyStudents()) return toast("Only a campus administrator or verifier can approve student membership.");
  if (!window.confirm("Confirm this student’s enrolment using your university records?")) return;
  try { await updateDoc(doc(db,"profiles",uid),{membershipStatus:"verified",membershipReviewedBy:currentUser.uid,membershipReviewedAt:serverTimestamp(),updatedAt:serverTimestamp()}); toast("Student campus membership verified."); await renderPage("directory",false); }
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
  await migrateLegacyConversations();
  // This compound query is campus-scoped; Firestore may ask you to create its composite index once.
  const q = query(collection(db,"conversations"), where("participants","array-contains",currentUser.uid), where("universityKey","==",currentProfile.universityKey), limit(100));
  const snap = await getDocs(q);
  return snap.docs.map(item => ({id:item.id,...item.data()})).sort((a,b)=>(b.lastMessageAt?.seconds||0)-(a.lastMessageAt?.seconds||0));
}
async function renderMessages() {
  if (!communityVerified()) { $("page-content").innerHTML = pageHeading("CAMPUS COMMUNITY","Messages","Secure conversations for verified members of your campus.") + `<div class="panel">${empty("✉","Membership verification pending","You can complete your profile and submit university details now. A campus administrator or college verifier must approve your membership before you can search for students or chat.")}</div>`; return; }
  conversationCache = await getMyConversations();
  const activeId = activeConversation?.id;
  activeConversation = activeId ? conversationCache.find(item => item.id === activeId) || activeConversation : null;
  $("page-content").innerHTML = pageHeading("CAMPUS COMMUNITY","Messages","Private one-to-one and group conversations within your current campus.", `<div class="chat-tools"><button class="btn btn-ghost btn-small" id="new-chat">＋ New chat</button><button class="btn btn-primary btn-small" id="new-group">＋ New group</button></div>`) +
    `<div class="chat-layout ${activeConversation?"chat-open":""}" id="chat-layout"><aside class="panel chat-list"><h3>Conversations</h3><div class="field"><input id="conversation-filter" placeholder="Search your chats…" aria-label="Search conversations"></div><div id="conversation-list" class="chat-contact-list">${renderConversationList()}</div>
      <div class="nav-divider"></div><h3>Start a conversation</h3><div class="field"><input id="chat-new-search" placeholder="Search campus users…" autocomplete="off" aria-label="Find a campus user"></div><div id="chat-search-results" class="chat-search-results"><div class="chat-empty">Search by name, email, phone or registration ID. Students are not listed here until you start a chat.</div></div></aside>
      <section class="panel chat-window"><div class="chat-window-head" id="chat-head">${activeConversation?renderChatHeader(activeConversation):`<div><b>Select a conversation</b><div class="text-muted">Choose an existing chat or search for a student to begin.</div></div>`}</div>
      <div class="chat-messages" id="chat-messages">${activeConversation?`<div class="chat-placeholder">Loading conversation…</div>`:empty("✉","Your messages","Your conversation history will appear here.")}</div>
      ${activeConversation?`<div class="field" style="padding:0 10px"><input id="message-filter" placeholder="Search messages in this conversation…" aria-label="Search messages"></div><form class="chat-compose" id="chat-compose"><input id="chat-text" placeholder="Write a message…" maxlength="4000" autocomplete="off" required><button class="btn btn-primary btn-small" type="submit">Send ↗</button></form>`:""}</section></div>`;
  $("new-chat").onclick = () => { $("chat-new-search").focus(); toast("Search for a campus member to start a private conversation."); };
  $("new-group").onclick = openCreateGroup;
  $("conversation-filter").oninput = () => { const term = normaliseSearch($("conversation-filter").value); document.querySelectorAll("[data-conversation]").forEach(el => el.style.display = normaliseSearch(el.textContent).includes(term) ? "" : "none"); };
  $("chat-new-search").oninput = () => {
    window.clearTimeout(peopleSearchTimer);
    const term = $("chat-new-search").value;
    peopleSearchTimer = window.setTimeout(() => searchCampusPeople(term), 180);
  };
  document.querySelectorAll("[data-conversation]").forEach(el => el.onclick = () => openConversation(el.dataset.conversation));
  if (activeConversation) { await subscribeConversation(); $("chat-compose").onsubmit = sendMessage; $("message-filter").oninput = filterMessages; wireChatHeader(); }
}
function renderConversationList() {
  if (!conversationCache.length) return `<div class="chat-empty">No conversations yet.<br>Search for a campus user below to start one.</div>`;
  return conversationCache.map(conversation => `<div class="chat-contact ${activeConversation?.id===conversation.id?"selected":""}" data-conversation="${esc(conversation.id)}"><span class="user-avatar">${esc(initials(conversationTitle(conversation)))}</span><div style="min-width:0;flex:1"><b>${esc(conversationTitle(conversation))}</b><small>${esc(conversation.lastMessage||conversationSubtitle(conversation))}</small></div><small>${esc(timeText(conversation.lastMessageAt))}</small></div>`).join("");
}
function renderChatHeader(conversation) {
  return `<button class="chat-back" id="chat-back" aria-label="Back to conversations">←</button><span class="user-avatar">${esc(initials(conversationTitle(conversation)))}</span><div class="chat-head-title"><b>${esc(conversationTitle(conversation))}</b><small>${esc(conversationSubtitle(conversation))} · ${esc(currentProfile.university)}</small></div>${conversation.type==="group"?`<button class="btn btn-ghost btn-small" id="group-manage">Group info</button>`:`<button class="btn btn-ghost btn-small" id="direct-profile">View profile</button>`}`;
}
async function searchCampusPeople(term) {
  const box = $("chat-search-results"); if (!box) return;
  const needle = normaliseSearch(term);
  if (needle.length < 2) { box.innerHTML = `<div class="chat-empty">Type at least 2 characters to search campus users.</div>`; return; }
  try {
    if (!peopleCache.length) peopleCache = await getCampusPeople();
    const matches = peopleCache.filter(person => normaliseSearch([person.name,person.email,person.phone,person.collegeId,person.department,person.course].join(" ")).includes(needle)).slice(0,30);
    box.innerHTML = matches.length ? matches.map(person => `<div class="chat-search-result" data-start-person="${esc(person.uid)}"><span class="user-avatar">${esc(initials(person.name))}</span><span><b>${esc(person.name)}</b><small>${esc(person.email||"")} · ${esc(person.collegeId||"ID not added")} · ${esc(person.department||"")}</small></span></div>`).join("") : `<div class="chat-empty">No matching person found in ${esc(currentProfile.university)}.</div>`;
    document.querySelectorAll("[data-start-person]").forEach(el => el.onclick = async () => { const person = peopleCache.find(item => item.uid === el.dataset.startPerson); if (person) await startDirectConversation(person); });
  } catch (error) { box.innerHTML = `<div class="chat-empty">Search failed: ${esc(friendlyAuthError(error))}</div>`; }
}
function directConversationId(a,b) { return [a,b].sort().join("_"); }
async function startDirectConversation(person) {
  if (!communityVerified()) return toast("Your campus membership must be verified before you can chat.");
  if (person.universityKey !== currentProfile.universityKey) return toast("You can only message students from your current university community.");
  const id = directConversationId(currentUser.uid,person.uid), ref = doc(db,"conversations",id);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const participants = [currentUser.uid,person.uid].sort();
      await setDoc(ref,{type:"direct",participants,admins:[],groupName:"",university:currentProfile.university,universityKey:currentProfile.universityKey,
        memberNames:{[currentUser.uid]:currentProfile.name,[person.uid]:person.name},createdBy:currentUser.uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),lastMessage:"",lastMessageAt:serverTimestamp()});
    }
    activeConversation = {id,...(await getDoc(ref)).data()};
    await renderPage("messages");
  } catch (error) { toast("Could not start conversation: " + friendlyAuthError(error)); }
}
async function openConversation(id) {
  try {
    const snap = await getDoc(doc(db,"conversations",id));
    if (!snap.exists()) return toast("This conversation is no longer available.");
    const conversation = {id,...snap.data()};
    if (!conversation.participants?.includes(currentUser.uid) || conversation.universityKey !== currentProfile.universityKey) return toast("You no longer have access to this conversation.");
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
        if (message.senderUid !== currentUser.uid && !(message.readBy||[]).includes(currentUser.uid)) {
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
    <div class="message-text">${deleted?"This message was deleted":esc(message.text||"")}</div>
    <small class="message-time">${esc(timeText(message.createdAt))}${message.edited?" · edited":""}${mine && (message.readBy||[]).some(uid=>uid!==currentUser.uid)?" · seen":""}</small>
    ${mine&&!deleted?`<div class="chat-item-actions"><button data-edit-message="${esc(id)}">Edit</button><button data-delete-message="${esc(id)}">Delete</button></div>`:""}
  </article>`;
}
function wireMessageActions() {
  document.querySelectorAll("[data-edit-message]").forEach(button => button.onclick = () => editMessage(button.dataset.editMessage));
  document.querySelectorAll("[data-delete-message]").forEach(button => button.onclick = () => deleteMessage(button.dataset.deleteMessage));
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
    await addDoc(collection(db,"conversations",conversation.id,"messages"),{senderUid:currentUser.uid,text:textValue,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),edited:false,deleted:false,readBy:[currentUser.uid]});
    await updateDoc(doc(db,"conversations",conversation.id),{lastMessage:textValue,lastMessageAt:serverTimestamp(),updatedAt:serverTimestamp()});
    input.value = "";
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
  if (!window.confirm("Delete this message for everyone in this conversation?")) return;
  try {
    await updateDoc(doc(db,"conversations",activeConversation.id,"messages",messageId),{text:"",deleted:true,updatedAt:serverTimestamp()});
    toast("Message deleted for everyone.");
  } catch (error) { toast("Could not delete message: " + friendlyAuthError(error)); }
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
    const members = peopleCache.filter(person=>normaliseSearch([person.name,person.email,person.phone,person.collegeId].join(" ")).includes(needle)).slice(0,60);
    $("group-member-results").innerHTML = members.map(person=>`<label class="group-member-row"><input type="checkbox" value="${esc(person.uid)}" data-group-check><span class="user-avatar">${esc(initials(person.name))}</span><span class="member-info"><b>${esc(person.name)}</b><small class="text-muted">${esc(person.collegeId||"")} · ${esc(person.department||"")}</small></span></label>`).join("") || empty("◎","No people found","Try another search.");
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
  const memberRows = conversation.participants.map(uid=>`<div class="group-member-row"><span class="user-avatar">${esc(initials(conversation.memberNames?.[uid]||"Member"))}</span><span class="member-info"><b>${esc(conversation.memberNames?.[uid]||"Campus member")}</b><small class="text-muted">${(conversation.admins||[]).includes(uid)?"Group admin":"Member"}${uid===currentUser.uid?" · You":""}</small></span>${admin&&uid!==currentUser.uid?`<button class="btn btn-ghost btn-small" data-toggle-admin="${esc(uid)}">${(conversation.admins||[]).includes(uid)?"Remove admin":"Make admin"}</button><button class="btn btn-ghost btn-small" data-remove-member="${esc(uid)}">Remove</button>`:""}</div>`).join("");
  openModal(`<span class="eyebrow">GROUP SETTINGS</span><h2>${esc(conversation.groupName||"Campus group")}</h2><p>${conversation.participants.length} members · ${admin?"You are an admin":"Member access"}</p><div class="content-card">${memberRows}</div>${admin?`<div class="chat-tools" style="margin-top:14px"><button class="btn btn-ghost" id="rename-group">Edit group name</button><button class="btn btn-ghost" id="add-group-member">Add members</button><button class="btn btn-ghost" id="delete-group">Delete group</button></div>`:""}`);
  document.querySelectorAll("[data-toggle-admin]").forEach(button=>button.onclick=()=>toggleGroupAdmin(button.dataset.toggleAdmin));
  document.querySelectorAll("[data-remove-member]").forEach(button=>button.onclick=()=>removeGroupMember(button.dataset.removeMember));
  if (admin) {
    $("rename-group").onclick=renameGroup;
    $("add-group-member").onclick=openAddGroupMembers;
    $("delete-group").onclick=deleteGroup;
  }
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
  if (!communityVerified()) {
    $("page-content").innerHTML = pageHeading("CAMPUS BULLETIN","Notice board","Announcements and campus updates.") + `<div class="panel">${empty("◷","Campus verification pending","Campus notices become available after a university administrator or verifier confirms your membership.")}</div>`;
    return;
  }
  const [currentSnap,legacySnap]=await Promise.all([
    getDocs(query(collection(db,"notices"),where("universityKey","==",currentProfile.universityKey),limit(60))),
    getDocs(query(collection(db,"notices"),where("university","==",currentProfile.university),limit(60)))
  ]);
  const merged=new Map();[...currentSnap.docs,...legacySnap.docs].forEach(item=>merged.set(item.id,{id:item.id,...item.data()}));
  const notices=[...merged.values()].sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  const canPost=["admin","faculty","warden"].includes(currentProfile.role);
  $("page-content").innerHTML=pageHeading("CAMPUS BULLETIN","Notice board","Announcements and campus updates.",canPost?'<button class="btn btn-primary btn-small" id="post-notice">＋ Publish notice</button>':"")+`<div class="panel">${notices.map(notice=>`<div class="notice-row"><div class="notice-date">${esc(dateText(notice.createdAt))}</div><div><b>${esc(notice.title)}</b><p>${esc(notice.body)}</p><span class="page-kicker">${esc(notice.category||"ANNOUNCEMENT")}</span></div></div>`).join("")||empty("◷","No announcements yet","University notices will appear here when published.")}</div>`;
  if(canPost)$("post-notice").onclick=()=>{openModal(`<span class="eyebrow">CAMPUS BULLETIN</span><h2>Publish a notice</h2><form id="notice-form"><div class="field"><label>Title</label><input name="title" required maxlength="120"></div><div class="field"><label>Category</label><select name="category"><option>Announcement</option><option>Academic</option><option>Hostel</option><option>Event</option><option>Emergency</option></select></div><div class="field"><label>Message</label><textarea name="body" required maxlength="5000"></textarea></div><button class="btn btn-primary btn-block">Publish notice</button></form>`);$("notice-form").onsubmit=async event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));try{await addDoc(collection(db,"notices"),{...data,university:currentProfile.university,universityKey:currentProfile.universityKey,authorUid:currentUser.uid,createdAt:serverTimestamp()});closeModal();toast("Notice published.");await renderPage("notices");}catch(error){toast("Could not publish notice: "+friendlyAuthError(error));}};};
}
function renderAcademics() {
  $("page-content").innerHTML=pageHeading("ACADEMIC LIFE","Academic planner","A structured home for schedules, attendance, assignments and exam dates.")+`<div class="grid stats-grid"><div class="stat-card"><div class="stat-label">Timetable</div><div class="stat-value">Not connected</div><div class="stat-foot">Requires a university schedule</div></div><div class="stat-card"><div class="stat-label">Attendance</div><div class="stat-value">Not connected</div><div class="stat-foot">Requires an approved attendance source</div></div><div class="stat-card"><div class="stat-label">Assignments</div><div class="stat-value">Not configured</div><div class="stat-foot">Faculty publishing is not enabled yet</div></div><div class="stat-card"><div class="stat-label">Exams</div><div class="stat-value">Not configured</div><div class="stat-foot">Academic calendar is not connected</div></div></div><div class="panel" style="margin-top:16px">${empty("▦","Academic data is not connected yet","This section is currently an information view. Timetable, attendance, assignments and examination management need their own campus data and role workflows before they can be used reliably.")}</div>`;
}
function renderEvents() {
  $("page-content").innerHTML=pageHeading("CAMPUS COMMUNITY","Events & clubs","Find activities and student communities.")+`<div class="panel">${empty("✳","Events module is not enabled yet","The current release does not yet include event publishing, RSVP lists or club administration. These are clearly marked as future work rather than inactive buttons.")}</div>`;
}
function renderHostel() {
  const items=[["⌂","Room request","Request a room or room change"],["⚒","Maintenance","Report a repair or facility issue"],["♧","Visitor pass","Request visitor permission"],["☻","Mess feedback","Share dining feedback"],["◷","Hostel leave","Submit a leave application"]];
  $("page-content").innerHTML=pageHeading("RESIDENTIAL SERVICES","Hostel services","Submit hostel-related requests to your campus review team.")+`<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:12px">${items.map((item,index)=>`<button class="quick-action" data-hostel="${index}"><span>${item[0]}</span><b>${esc(item[1])}</b><small>${esc(item[2])}</small></button>`).join("")}</div><p class="text-muted" style="font-size:12px;margin-top:15px">Emergency services are not contacted by this website. Use your institution's official emergency number for urgent situations.</p>`;
  document.querySelectorAll("[data-hostel]").forEach(button=>button.onclick=()=>{const index=Number(button.dataset.hostel);if(index===4)return openApplicationForm();const [icon,title] = items[index];openModal(`<span class="eyebrow">HOSTEL SERVICES</span><h2>${esc(title)}</h2><p>Your request will be added to the same campus application queue.</p><form id="hostel-form"><div class="field"><label>Details</label><textarea name="details" required maxlength="4000" rows="4" placeholder="Describe what you need…"></textarea></div><button class="btn btn-primary btn-block">Submit request</button></form>`);$("hostel-form").onsubmit=async event=>{event.preventDefault();const details=new FormData(event.currentTarget).get("details");try{await addDoc(collection(db,"applications"),{type:title,title,details,studentUid:currentUser.uid,studentName:currentProfile.name,university:currentProfile.university,universityKey:currentProfile.universityKey,status:"pending",createdAt:serverTimestamp(),updatedAt:serverTimestamp(),history:[{status:"pending",by:currentUser.uid,at:new Date().toISOString(),comment:"Request submitted"}]});closeModal();toast("Hostel request submitted.");await renderPage("applications");}catch(error){toast("Request failed: "+friendlyAuthError(error));}};});
}
function renderProfile() {
  const p=currentProfile;
  $("page-content").innerHTML=pageHeading("YOUR CAMPUS IDENTITY","My profile","Manage your contact and academic details; request staff approval to move campuses.")+`<div class="panel" style="margin-bottom:14px"><b>Campus membership: ${esc(p.membershipStatus||"pending")}</b><p class="text-muted">${p.membershipStatus==="verified"?"Your campus membership has been verified.":"You can use profile and application features. Directory and messaging unlock after a campus verifier approves your enrolment."}</p></div><div class="profile-layout"><section class="panel profile-card"><div class="profile-avatar">${esc(initials(p.name))}</div><h3>${esc(p.name)}</h3><p>${esc(p.department||"University member")} · ${esc(p.university)}</p><span class="status approved">Profile complete</span><div class="profile-meta"><div class="meta-line"><span>Registration ID</span><b>${esc(p.collegeId||"—")}</b></div><div class="meta-line"><span>Role</span><b>${esc(roleLabel(p.role))}</b></div><div class="meta-line"><span>Email</span><b>${esc(p.email||currentUser.email)}</b></div><div class="meta-line"><span>Phone</span><b>${esc(p.phone||"Not added")}</b></div></div></section>
    <section class="panel"><div class="panel-title"><h3>Edit profile</h3></div><form id="profile-edit" class="form-grid"><div class="field"><label>Full name</label><input name="name" value="${esc(p.name)}" required></div><div class="field"><label>Registration ID</label><input name="collegeId" value="${esc(p.collegeId)}" required></div><div class="field"><label>Phone</label><input name="phone" type="tel" value="${esc(p.phone)}"></div><div class="field"><label>Department</label><input name="department" value="${esc(p.department)}" required></div><div class="field"><label>Course</label><input name="course" value="${esc(p.course)}" required></div><div class="field"><label>Year</label><select name="year" required>${[1,2,3,4,5,6].map(n=>`<option value="${n}" ${String(p.year)===String(n)?"selected":""}>Year ${n}</option>`).join("")}</select></div><div class="field"><label>Hostel</label><input name="hostel" value="${esc(p.hostel)}"></div><div class="field"><label>Room</label><input name="room" value="${esc(p.room)}"></div><div class="field full"><label>Bio</label><textarea name="bio" rows="3">${esc(p.bio)}</textarea></div><div class="field full"><button class="btn btn-primary">Save changes ↗</button></div></form><div class="nav-divider"></div><h3>Change campus community</h3><p class="text-muted">To prevent someone silently changing their university and accessing another campus, a destination-campus administrator must approve the transfer.</p><button class="btn btn-ghost" id="request-campus-change">Request campus change</button></section></div>`;
  $("profile-edit").onsubmit=async event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));try{await updateDoc(doc(db,"profiles",currentUser.uid),{...data,year:Number(data.year),updatedAt:serverTimestamp()});currentProfile={...currentProfile,...data,year:Number(data.year)};$("top-name").textContent=data.name;$("top-avatar").textContent=initials(data.name);toast("Profile updated.");await renderPage("profile",false);}catch(error){toast("Update failed: "+friendlyAuthError(error));}};
  $("request-campus-change").onclick=openCampusChangeRequest;
}
function openCampusChangeRequest() {
  openModal(`<span class="eyebrow">CAMPUS MEMBERSHIP</span><h2>Request another campus</h2><p>Enter the official university name. Its short form will match only when the alias is configured in NeonVerse. A staff member at the destination campus must verify and approve your request.</p><form id="campus-change-form"><div class="field"><label>Requested university / campus *</label><input name="university" required placeholder="Official campus name"></div><div class="field"><label>Registration ID at that campus *</label><input name="collegeId" required></div><div class="field"><label>Reason (optional)</label><textarea name="reason" rows="3"></textarea></div><button class="btn btn-primary btn-block">Submit campus change request</button></form>`);
  $("campus-change-form").onsubmit=async event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));const university=data.university.trim(),key=campusKeyFor(university);if(!key||key===currentProfile.universityKey)return toast("Enter a different campus name.");try{await addDoc(collection(db,"campusChangeRequests"),{studentUid:currentUser.uid,studentName:currentProfile.name,collegeId:data.collegeId,currentUniversity:currentProfile.university,currentUniversityKey:currentProfile.universityKey,requestedUniversity:university,requestedUniversityKey:key,reason:data.reason||"",status:"pending",createdAt:serverTimestamp()});closeModal();toast("Campus change request sent for destination-campus review.");}catch(error){toast("Could not submit request: "+friendlyAuthError(error));}};
}
function renderSettings() {
  $("page-content").innerHTML=pageHeading("PREFERENCES","Settings","Personalise your NeonVerse experience.")+`<div class="panel"><div class="panel-title"><h3>Appearance</h3></div><p class="text-muted">Choose the theme that feels right for you.</p><button class="btn btn-ghost" id="settings-theme">Toggle light / dark mode</button><div class="nav-divider"></div><div class="panel-title"><h3>Guided tour</h3></div><p class="text-muted">Take a quick tour of your workspace.</p><button class="btn btn-ghost" id="start-tour">Start website tour</button><div class="nav-divider"></div><div class="panel-title"><h3>Account</h3></div><p class="text-muted">Signed in as ${esc(currentUser.email)}.</p><button class="btn btn-ghost" id="settings-signout">Sign out</button><div class="nav-divider"></div><div class="panel-title"><h3>Feature availability</h3></div><p class="text-muted">Working now: authentication, required profile gate, campus-scoped directory, direct and group text chat, message editing/deletion, group controls, applications, staff review, notices and in-app notifications. Planned: file sharing, voice/video, push notifications, attendance sync, timetable and event administration.</p></div>`;
  $("settings-theme").onclick=themeToggle;$("start-tour").onclick=()=>{tourIndex=0;showTour();};$("settings-signout").onclick=doSignout;
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
  ["Your overview","Your dashboard brings recent applications, campus status and useful shortcuts together."],
  ["Applications","Submit requests and follow their status, reviewer decisions and comments."],
  ["Messages","Start direct or group conversations with people from your current campus community."],
  ["Campus services","Use notices, hostel requests, your profile and settings from one workspace."]
];
function showTour() { const item=tour[tourIndex];$("tour-step").textContent=`0${tourIndex+1} / 0${tour.length}`;$("tour-title").textContent=item[0];$("tour-copy").textContent=item[1];$("tour-overlay").classList.remove("hidden");$("tour-next").textContent=tourIndex===tour.length-1?"Finish ✓":"Next →"; }
function maybeTour() { if(!localStorage.getItem("neonverse-tour-done")){tourIndex=0;showTour();} }
async function globalSearch() {
  if(!isProfileComplete(currentProfile))return openProfileCompletion(true);
  openModal(`<span class="eyebrow">QUICK NAVIGATION</span><h2>Search NeonVerse</h2><p>Find a workspace section or a person in your campus.</p><input class="search-input" id="global-search-input" placeholder="Search pages and people…"><div class="search-results" id="global-search-results"></div>`);
  const input=$("global-search-input"),pages=["Overview","Applications","Messages","Student directory","Notice board","Academics","Hostel services","Events & clubs","My profile","Settings"];
  const draw=async()=>{const term=normaliseSearch(input.value);let html=pages.filter(page=>normaliseSearch(page).includes(term)).map(page=>`<div class="search-result" data-search-page="${esc(page)}"><b>${esc(page)}</b><small>Open workspace section</small></div>`).join("");if(term.length>=2 && communityVerified()){try{if(!peopleCache.length)peopleCache=await getCampusPeople();html+=peopleCache.filter(person=>normaliseSearch([person.name,person.email,person.phone,person.collegeId].join(" ")).includes(term)).slice(0,12).map(person=>`<div class="search-result" data-search-person="${esc(person.uid)}"><b>${esc(person.name)}</b><small>${esc(person.department||"")} · ${esc(person.collegeId||"")}</small></div>`).join("");}catch(error){console.debug(error);}}$("global-search-results").innerHTML=html||empty("⌕","No matching results","Try another search term.");document.querySelectorAll("[data-search-page]").forEach(el=>el.onclick=()=>{const pageMap={"Student directory":"directory","Notice board":"notices","Hostel services":"hostel","Events & clubs":"events","My profile":"profile"};closeModal();renderPage(pageMap[el.dataset.searchPage]||el.dataset.searchPage.toLowerCase());});document.querySelectorAll("[data-search-person]").forEach(el=>el.onclick=()=>{closeModal();showStudentProfile(el.dataset.searchPerson);});};
  input.oninput=draw;await draw();input.focus();
}
async function doSignout() {
  if(unsubscribeMessages)unsubscribeMessages();if(unsubscribeNotifications)unsubscribeNotifications();
  await signOut(auth);currentUser=null;currentProfile=null;activeConversation=null;conversationCache=[];peopleCache=[];pageHistory=[];showLanding();toast("You have signed out.");
}

// Navigation, modal and app controls.
document.addEventListener("click",event=>{
  const theme=event.target.closest(".theme-toggle");if(theme)themeToggle();
  const nav=event.target.closest(".side-link[data-page]");if(nav){if(!isProfileComplete(currentProfile)){openProfileCompletion(true);return;}renderPage(nav.dataset.page);}
});
$("open-auth").onclick=$("hero-enter").onclick=$("closing-enter").onclick=showAuth;
$("back-home").onclick=showLanding;
document.querySelectorAll("[data-auth-mode]").forEach(button=>button.onclick=()=>setAuthMode(button.dataset.authMode));
$("auth-form").onsubmit=handleEmailAuth;$("google-signin").onclick=googleLogin;
$("warden-mode").onclick=()=>{roleMode=!roleMode;$("warden-box").classList.toggle("hidden",!roleMode);$("warden-mode").textContent=roleMode?"Student access":"Warden access";$("auth-sub").textContent=roleMode?"Sign in with your university-authorised staff account.":"Continue with your university account.";};
$("signout").onclick=doSignout;$("notification-button").onclick=openNotifications;$("global-search").onclick=globalSearch;$("app-menu").onclick=()=>{$("sidebar").classList.toggle("open");$("sidebar-scrim").classList.toggle("show");};$("sidebar-scrim").onclick=closeSidebar;
$("user-chip").onclick=()=>renderPage("profile");$("nav-back").onclick=goBack;
$("modal-close").onclick=()=>closeModal();$("modal-backdrop").onclick=event=>{if(event.target===$("modal-backdrop"))closeModal();};
$("tour-next").onclick=()=>{if(tourIndex<tour.length-1){tourIndex++;showTour();}else{$("tour-overlay").classList.add("hidden");localStorage.setItem("neonverse-tour-done","1");toast("You're ready to explore NeonVerse.");}};
$("tour-skip").onclick=()=>{$("tour-overlay").classList.add("hidden");localStorage.setItem("neonverse-tour-done","1");};
document.addEventListener("keydown",event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="k"){event.preventDefault();if(currentUser)globalSearch();}if(event.key==="Escape"){if(!lockedModal)closeModal();$("tour-overlay").classList.add("hidden");closeSidebar();}});
loadTheme();
if(firebaseReady){onAuthStateChanged(auth,async user=>{if(user&&!currentUser){await finishLogin(user);}else if(!user&&currentUser){currentUser=null;currentProfile=null;showLanding();}});}
