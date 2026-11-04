# NeonVerse — University & Campus Management Edition

NeonVerse is a static, responsive HTML/CSS/JavaScript university workspace connected to Firebase Authentication and Cloud Firestore. It is designed for a controlled campus pilot and can be deployed to Vercel without React, a build tool, Firebase Storage, or Cloud Functions.

This edition expands the earlier student/Warden application into four role-aware experiences:

- **Student** — campus identity, directory, teacher connectivity, messages, class/subject channels, applications, notices, academics, attendance, clubs/events and hostel requests.
- **Warden** — hostel operations, resident requests, room allocations, hostel notices, hostel groups and student chat-access verification.
- **Faculty** — faculty directory presence, course/subject groups, assignment publishing, attendance entry/update, official notices, student verification and club/event coordination.
- **University Administrator** — campus approvals, office calendar (holidays, timetable and exam/deadline entries), campus notices, club/event governance, group oversight and temporary/permanent NeonVerse account restrictions.

> **Important:** This is not an official LPU ERP/UMS, SIS, LMS or attendance-system integration. “Teacher connectivity” currently means the campus directory, faculty profile presence and same-campus messaging. Live synchronisation with LPU systems requires written institutional approval, official API/SSO documentation and a trusted backend integration.

## 1. Features in this build

### Identity, onboarding and access control

- Email/password and Google sign-in. Email/password registration sends a Firebase verification link; unverified accounts cannot enter the workspace. Any valid email address can register—there is no university-domain-only restriction.
- Student signup collects full name, university full name and campus short name (for example, LPU). The required profile-completion step collects registration ID, department, course and year.
- Profile-completion percentage and a guided first-run website tour; the tour can be restarted from Settings.
- Role-based views for Student, Warden, Faculty and University Admin.
- Staff roles are provisioned by an authorised project owner using Firestore `roles/{uid}` records. No Warden/Faculty/Admin email addresses are hard-coded in the frontend.
- A student's membership starts as `pending`. Staff review lists every unverified student in the same campus, including brand-new and incomplete profiles at 0% completion. Approval remains disabled until the student has verified their email and completed required profile fields. Directory and chat access are gated until approval.
- Campus-scoped student and faculty directory; profile cards can start a direct conversation.
- Search normalisation is case-insensitive and campus identity matching ignores punctuation and spacing. LPU / Lovely Professional University / Phagwara variants resolve to one campus key. Campus short names are also indexed in directory and global people search; add institution-approved aliases in `CAMPUS_ALIASES` for additional universities.

### Chat and campus communication

- Direct messages and small private groups (up to 8 participants) with edit/delete controls, read indicators and notification inbox.
- Separate large-group channels for class, subject, hostel, campus and club spaces.
- Faculty can create class/subject groups and automatically enrol verified students matching the selected department, course and year. Warden can create hostel groups. Admin can create class, subject, hostel and campus groups.
- Club channels are created with a club. Students can request membership; staff can review club requests.
- Admin can delete channels. The new channels are separate from the older 8-person direct/group chat system.
- The channel auto-enrol feature currently has a **250-member pilot limit per channel** and reads at most 250 matching profiles. Divide larger cohorts by section/tutorial group.
- Message bodies are text-only in this edition. Attachments, voice/video calls, typing indicators and push notifications are not included.

### Academics — Faculty-managed

- Faculty can publish assignments with subject, instructions, due date and optional department/course/year targeting.
- Faculty can record or update per-student attendance for a subject/date, using Present, Absent, Late or Excused.
- Students see assignments matching their programme and their attendance records.
- Faculty workspace shows campus roster counts, coursework counts, attendance records and shortcuts to class communication.
- Faculty, not students, have write permission for assignments and attendance. University Admin can maintain the shared academic calendar but cannot mark attendance through this UI.

### University office — Admin-managed

- Admin can publish campus holidays, timetable entries, exam dates and academic deadlines.
- Admin workspace includes student verification, channel oversight and moderation records.
- Admin can create events and clubs, publish official notices, and delete campus channels.
- Temporary or permanent restrictions are enforced by the NeonVerse sign-in flow. This is an application-level restriction; it does **not** disable or delete the Firebase Authentication account. A production deployment should use a trusted Admin SDK/backend to disable accounts or issue claims where required.

### Warden — Hostel operations

- Warden workspace for hostel request queue, verified campus residents and room-allocation records.
- Warden can record student hostel/block and room allocations.
- Students can submit room requests, maintenance requests, visitor-pass requests, mess feedback and hostel leave applications.
- Warden can review applications through the shared Applications queue, publish hostel notices and create hostel channels.
- Emergency services are not contacted by this website. Use the institution's official emergency contact for urgent situations.

### Campus life and applications

- Two notice areas: **Official notice board** (Warden/Faculty/Admin) and **Casual campus board** (verified students can share non-sensitive campus posts).
- Staff can create clubs and events; students can request club membership and RSVP to events.
- Dashboard shortcuts include three common application categories: Hostel Leave, Maintenance Request and Academic Support. The Applications area also supports other request types, review comments and status changes.
- Existing application workflow supports submission, cancellation while pending, staff review, approval, rejection and escalation.
- Campus transfer requests require destination-campus staff approval.

### Visual refresh and usability

- Updated emerald/green and rose/pink theme with stronger text, input, button and chat-message contrast in dark and light modes.
- Chat message surfaces and controls have explicit foreground/background colors for readability.
- Directory and global search include full and short campus names and ignore letter case.

## 2. Files included

| File | Purpose |
|---|---|
| `index.html` | Landing page, authentication views and app shell |
| `style.css` | Responsive layouts, themes, modals, navigation and workspace styling |
| `script.js` | Firebase authentication, role routing, UI actions and Firestore data operations |
| `firebase-config.js` | Public Firebase Web App configuration placeholders |
| `firestore.rules` | Role- and campus-aware Firestore security rules |
| `firestore.indexes.json` | Composite indexes for the app's multi-field queries |
| `firebase.json` | Firebase CLI config for deploying Firestore rules and indexes |

## 3. Firebase setup

### Step A — Create or use your Firebase project

1. Open Firebase Console and select your project.
2. Open **Project settings → General → Your apps**.
3. Register a Web App if you have not already done so.
4. Copy the Web App configuration values into `firebase-config.js`.
5. Do not place a service-account private key in frontend files. The Firebase Web config is public; Firestore Rules control database access.

Example format (replace every placeholder with the values from your Firebase Console):

```js
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  appId: "YOUR_APP_ID"
};
```

### Step B — Enable Authentication

In **Firebase Console → Authentication → Sign-in method**, enable:

- Email/Password
- Google (optional)

Keep Firebase's **Email address verification** email template enabled. Under **Authentication → Settings → Authorized domains**, include `localhost` for local testing and your deployed Vercel hostname. The app does not restrict email domains; a user must be able to receive and click the verification link before they can sign in to the workspace.

### Step C — Create Firestore Database and publish rules

1. Open **Firestore Database** and create the database in the intended region.
2. Open **Firestore Database → Rules**.
3. Replace the rules with the complete `firestore.rules` file in this package.
4. Click **Publish**.
5. Never replace these rules with open/test rules such as `allow read, write: if true`.

The rules deny role-document writes from the client. They scope student/faculty/hostel channels and records to a campus key and distinguish the write privileges of each staff role.

### Step D — Deploy composite indexes

The package includes `firestore.indexes.json`. From a terminal where Firebase CLI is installed and configured for this project, run:

```bash
firebase login
firebase use YOUR_PROJECT_ID
firebase deploy --only firestore:rules,firestore:indexes
```

Alternatively, when Firestore shows a missing-index error, open the Firebase-provided link and create that exact index. Wait until its status is **Enabled**. Do not guess a different index definition.

### Step E — Configure and deploy on Vercel

1. Keep the project files together in the repository root: `index.html`, `style.css`, `script.js`, `firebase-config.js` and Firebase config files.
2. Commit and push the files to GitHub.
3. Import the repository into Vercel, or push to the already-connected Vercel repository.
4. Use no build command and no output directory for this plain static website (unless your Vercel project already has a working static configuration).
5. Add the deployed Vercel domain to Firebase Authentication's authorized domains.
6. Open the deployed site and test with a student account and each provisioned staff role.


## Agent37-powered NeonVerse AI assistant

This package adds a floating in-website AI help widget for signed-in users and a secure Vercel Function that calls the Agent37 Agent API. The browser never receives the Agent37 API key.

### Agent37 integration route

For NeonVerse website integration, use the documented **Agent37 Cloud API** route with the Hackyard promotional credit if it is available to your account. Claim it at `https://www.agent37.com/redeem/HACKYARD` before creating resources; the event instructions say no card is needed. Do not add a card, enable auto top-up, buy a plan, or manually top up. The Personal free agent is a separate product and its instance ID alone does not authenticate the external website API. Follow `agent37/SETUP-GUIDE.md` for Cloud API key, instance, budget and Vercel setup. The backend keeps the key server-side and calls the instance's `/v1/responses` endpoint with `X-Agent37-Key`.


### Vercel environment variables

Open Vercel → your NeonVerse project → Settings → Environment Variables and add:

- `FIREBASE_PROJECT_ID` — the same project ID used in `firebase-config.js`.
- `AGENT37_INSTANCE_URL` — for example `https://YOUR_INSTANCE_ID.agent37.app`; do not append `/v1/responses`.
- `AGENT37_API_KEY` — the secret key explicitly authorised for the Agent API. Store it in Vercel only, never in frontend files or GitHub.

Redeploy after saving environment variables. Opening `/api/agent37-chat` should return `{ "service": "NeonVerse Agent37 assistant", "configured": true }` when the three values exist. This status checks only that values are present; it does not validate the key or instance.

### What the assistant does

- Provides role-tailored guidance to Students, Wardens, Faculty and Administrators.
- Explains NeonVerse workflows such as account verification, applications, leave, hostel services, messages, clubs, events, academics and settings.
- Keeps a separate Agent37 session per signed-in Firebase UID and browser conversation ID.
- Stores the visible recent transcript in the user's local browser storage; it is not a cloud-synchronised transcript.
- Does not receive private profile documents, registration IDs, emails, Firestore data or university ERP data.
- The floating chat widget is a read-only guide. The separate staff-only AI Work page can prepare a narrowly restricted leave-approval plan, subject to server validation and staff confirmation.

### AI Work — staff task automation (new)

A separate **AI Work** navigation entry is shown only to Warden, Faculty and University Administrator accounts. Staff can describe a task in plain language. In this release, Agent37 can prepare a plan for pending leave approvals, and NeonVerse only allows the plan to include leave applications whose inclusive date span is **1–3 calendar days**. The staff member reviews the names/dates and clicks **Confirm & execute** before changes are written. Applications longer than 3 calendar days, invalid dates, non-leave applications, non-pending records and records outside the staff member's campus are excluded.

The workflow is intentionally controlled rather than giving an LLM unrestricted database or browser access:

1. The browser loads up to 100 pending applications using the signed-in staff member's existing Firestore permissions. Only compact metadata (application ID, title/type, student name, leave dates/times and status) is sent to Agent37. Application reasons, email addresses, phone numbers and document references are not sent.
2. `api/agent37-work.js` verifies the Firebase ID token and reads the caller's own `roles/{uid}` and `profiles/{uid}` documents through Firestore Rules. Only `warden`, `faculty` and `admin` roles with a verified campus profile can request a plan.
3. The backend asks Agent37 for structured JSON. It independently filters the plan so the only writable action is `approve_leave` for a pending leave record with a valid duration of 1, 2 or 3 calendar dates. The LLM cannot directly access Firestore.
4. A staff member confirms the displayed plan. The browser re-reads each document and checks its status, dates, type and campus before submitting the update. Firestore Rules also require that a staff-reviewed application is still `pending` at write time.
5. Successful approvals add the review UID, timestamp/comment and history entry, and send the existing in-app application notification to the student.

This initial release does **not** automatically reject requests, publish notices, edit profiles, change roles, create accounts or run arbitrary instructions against the university system. A staff confirmation is deliberately required for consequential leave decisions. It is not a substitute for university policy or a human review of supporting documents. The page currently scans up to 100 pending applications in the loaded campus queue; split large queues into batches and review the Applications page for anything beyond that limit.

#### Additional Vercel settings

The new route uses the same three server-only variables as the existing assistant: `FIREBASE_PROJECT_ID`, `AGENT37_INSTANCE_URL` and `AGENT37_API_KEY`. No new browser key or Firebase Admin service-account key is required. The Agent37 key is never added to `script.js`, `index.html`, or GitHub. `api/agent37-work.js` has the same configured Vercel function-duration ceiling as the existing Agent37 route; the actual maximum is subject to your Vercel plan and function settings.

**Agent37 setup:** Follow `agent37/SETUP-GUIDE.md`. This project uses the Cloud API integration route; claim the Hackyard promotional credit first if available, do not add a card or enable auto top-up, and keep the API key only in Vercel environment variables.

### Deployment notes

- The backend routes are `api/agent37-chat.js` (read-only help) and `api/agent37-work.js` (staff-only task planning); Vercel detects both as serverless functions.
- `vercel.json` allows up to 300 seconds for the route to accommodate a sleeping/starting agent. Vercel's available function duration depends on the project's compute configuration and plan.
- The route validates Firebase ID tokens using Google's published Firebase signing certificates, checks verified email, and sends only a bounded message plus role/campus labels to Agent37.
- It has a best-effort per-function-instance rate limit. For a larger public deployment, replace that with a shared rate-limit store.
- The Firestore Rules change in this release requires staff-reviewed application updates to target a record that is still `pending`, which helps prevent a stale AI Work plan from overwriting a decision already made by another staff member.

For the beginner setup walkthrough and troubleshooting, read [`agent37/SETUP-GUIDE.md`](agent37/SETUP-GUIDE.md). For the recommended agent behavior instructions, read [`agent37/AGENT-INSTRUCTIONS.md`](agent37/AGENT-INSTRUCTIONS.md).

## 4. How to add Warden, Faculty and Admin login accounts

There are **no pre-approved email IDs** inside the ZIP. The trusted role is attached to the Firebase Authentication UID, not to a frontend email comparison. This prevents someone from becoming staff simply by typing a staff email address into a public form.

Repeat these steps for each intended Warden, Faculty member and Administrator:

1. Ask the person to create an account in NeonVerse using their official university email, or create the account through Firebase Authentication if the university controls account onboarding.
2. In Firebase Console, open **Authentication → Users**.
3. Find the account and copy its **User UID** exactly.
4. Open **Firestore Database → Data → Start collection** (or open the existing collection) and create a collection named `roles`.
5. Create a document whose **Document ID is exactly the copied UID**.
6. Add one string field named `role` with exactly one of these values:

   | Staff type | `role` value |
   |---|---|
   | Warden | `warden` |
   | Faculty / teacher | `faculty` |
   | University administrator / office | `admin` |

7. Save the document. Ask that staff member to sign out and sign in again using **Staff access** (or their normal sign-in tab). The app reads the role record and shows the correct workspace.
8. Have the staff member complete their campus profile with the **same university name/campus key** used for student accounts. A pre-authorised staff profile is marked verified after it is complete.

**Example:** if a Firebase Auth user has UID `abc123...`, create `roles/abc123...` and set `role` to `warden`. Do not use the email address as the Firestore document ID. Do not put role fields into `profiles` manually as a substitute for the trusted `roles` record.

Keep the first `admin` role under the control of the project owner / institution IT team. Do not let students create or edit `roles` documents. A Warden or Faculty member cannot promote themselves to Admin through the website.

## 5. Student verification and chat approval

1. A student signs up and completes the required identity and academic profile fields.
2. Their profile is created with `membershipStatus: "pending"`.
3. The university verifies the registration details using its real records.
4. An authorised Warden, Faculty member or Admin opens **Student directory → Pending student verification** or the Admin approval screen and approves/rejects the student.
5. Only after approval does the student get directory and campus chat access.

Do not approve accounts based only on a self-entered university name or email suffix. The current app gives staff a manual review flow; it does not independently query the university student registry.

## 6. Important collection/data model

| Firestore collection | Main purpose |
|---|---|
| `roles/{uid}` | Trusted role assignment; owner-managed only |
| `profiles/{uid}` | Campus identity, student/faculty directory profile, membership status |
| `applications/{id}` | Hostel, maintenance, leave, academic support and other requests |
| `conversations/{id}/messages/{id}` | Direct and small private group chats |
| `channels/{id}` and `/messages/{id}` | Class, subject, hostel, campus and club group chats |
| `channelMemberships/{channelId_uid}` | Active/pending channel membership and auto-enrolment |
| `notices/{id}` | Official campus notices |
| `communityPosts/{id}` | Casual student community board |
| `academicItems/{id}` | Faculty assignments/coursework |
| `attendanceRecords/{id}` | Subject/date/student attendance entries |
| `campusCalendar/{id}` | Admin-published holidays, timetable, exam and deadline entries |
| `clubs/{id}`, `clubMemberships/{id}` | Campus clubs and membership requests |
| `events/{id}`, `eventRsvps/{id}` | Campus events and RSVP records |
| `hostelAllocations/{id}` | Warden-managed room allocation records |
| `userModeration/{uid}` | Admin-issued temporary/permanent workspace restrictions |
| `notifications/{uid}/items/{id}` | In-app notifications |
| `campusChangeRequests/{id}` | Destination-campus transfer review |

## 7. Role capability matrix

| Area | Student | Warden | Faculty | Admin |
|---|---:|---:|---:|---:|
| Complete own profile / tour | Yes | Yes | Yes | Yes |
| Approve student campus/chat access | No | Yes | Yes | Yes |
| Directory and direct messages | Verified only | Yes | Yes | Yes |
| Class / subject channel creation | No | No | Yes | Yes |
| Hostel channel creation | No | Yes | No | Yes |
| Campus group governance / deletion | No | Limited | Limited | Yes |
| Publish assignments | No | No | Yes | No |
| Mark/update attendance | No | No | Yes | No |
| Publish holidays / timetable / exams | No | No | No | Yes |
| Hostel allocation desk | Own allocation | Yes | No | Yes |
| Hostel requests | Submit | Review | Review as campus staff | Review |
| Official notice publishing | No | Yes | Yes | Yes |
| Casual campus posts | Verified users | Yes | Yes | Yes |
| Create clubs / events | No | Yes | Yes | Yes |
| Restrict / restore NeonVerse accounts | No | No | No | Yes |
| Assign trusted roles | No | No | No | No — owner-only in Firebase Console |

## 8. LPU teacher / university-system connectivity

This build supports teacher discovery and contact through verified campus profiles, role labels, direct chats and class/subject channels. It does **not** log in to or scrape an LPU portal, import the official faculty directory, sync the university timetable, read official attendance, or connect to an LMS/ERP automatically.

For official integration, LPU's authorised IT team would need to provide one or more approved interfaces such as SSO/OIDC/SAML, a documented REST API, a sanctioned SIS/LMS integration, or an authorised data export. Put privileged credentials and sync jobs on a trusted backend—not in `script.js` or `firebase-config.js`. Confirm data-protection, consent, retention and access rules before importing student records.

## 9. Chat approval and messaging repair (this package)

This package includes a targeted repair for reports where students continued seeing “Membership verification pending” after staff approval, or where direct messages failed to open/send. The changes include:

- Refresh the signed-in user's profile and staff role directly from Firestore's server before rendering the directory or Messages page.
- Listen for live changes to the signed-in user's `profiles/{uid}` and `roles/{uid}` documents. The first server snapshot is also compared with the sign-in state, so a newer approval is not ignored.
- The pending screen shows the exact Firebase Auth UID/profile document ID and campus key that staff need to approve.
- Staff approval checks the exact target profile, performs the approved status update, then reads the document back from the server to confirm `membershipStatus` is `verified`.
- Direct-conversation existence checks and the conversation list use server reads, reducing stale-cache behaviour.
- A message save is treated separately from the optional conversation-preview update, so a preview permission issue cannot falsely report that the message itself was not sent.
- Profile list rows use each Firestore document ID as the canonical UID when routing approval actions.

### Required deployment steps for the repair

1. Keep a backup of the currently deployed project.
2. Copy the new `script.js` and `firestore.rules` from this ZIP into the Vercel project. Keep your existing, working Firebase Web configuration in `firebase-config.js`; the copy in a downloadable source package may contain placeholders. Do not paste Firebase service-account/private credentials into the browser project.
3. Publish the complete `firestore.rules` from this ZIP in Firebase Console → Firestore Database → Rules, then click **Publish**. Do not combine it with old rules by pasting fragments.
4. Deploy the included composite indexes. From the project folder run:

   ```bash
   firebase login
   firebase use YOUR_FIREBASE_PROJECT_ID
   firebase deploy --only firestore:rules,firestore:indexes
   ```

   You can also create an index from the exact Firebase error link if Firebase reports that a query needs an index. Wait until the index status is **Enabled**.
5. Commit and push the updated files to GitHub so Vercel deploys the new `script.js`. Confirm the Vercel deployment is Ready.
6. In the browser, hard-refresh the site, sign out, and sign in again. On the student's Messages page, press **Refresh approval status** if it still displays the pending panel.

### Verify a student's exact record

For the student who cannot chat, open Firebase Console → Firestore Database → Data → `profiles` → the student's Firebase Authentication UID. The document ID must be the same UID as Firebase Authentication. Confirm all of the following:

| Field | Required value for the LPU pilot |
|---|---|
| `uid` | Same as the Firebase Authentication UID and document ID |
| `profileComplete` | `true` |
| `membershipStatus` | `verified` (exact lowercase spelling) |
| `universityKey` | `lovely-professional-university` |

Both people in a direct conversation must have completed profiles, `membershipStatus: verified`, and the exact same `universityKey`. The authorising staff member must have a `roles/{staffUid}` document with `role` set to `admin`, `warden`, or `faculty`, and their own completed profile must use the same campus key. The app will not unlock chat when an account's profile document remains `pending` or has a different campus key.

### What to check if it still fails

- If the pending screen says `pending` after **Refresh approval status**, the server still sees that exact profile document as pending. Check the document ID/UID and status in Firestore. A success toast alone is not a substitute for checking the student's exact record.
- If the status is `verified` but the directory is empty, confirm the other person's profile is also verified and has the same campus key.
- If the conversation list shows **Missing or insufficient permissions**, confirm the complete new rules are published and that the active Firebase project matches `firebase-config.js`.
- If Firebase displays a missing-index error, create the index from Firebase's generated link and wait for it to become Enabled. The included indexes already contain the direct-conversation composite index (`participants` array + `universityKey`).
- Existing legacy conversations without `universityKey` are excluded from the campus-scoped conversation list. New conversations created after deployment use the campus key.

## 10. Pilot limitations and production checklist

- **No live Firebase verification was performed while packaging this ZIP.** The JavaScript syntax and JSON index file are checked locally, but you must publish and test the Firestore Rules in your Firebase project. A Firebase Rules compiler/emulator and live end-to-end tests were not available in this packaging run.
- This is a frontend + Firebase client implementation. Use the Firebase Emulator Suite and test with separate Student/Warden/Faculty/Admin accounts before real student data is added.
- Same-campus profile documents currently contain directory fields such as email, phone and registration ID. Firestore Rules grant document-level reads, not field-level privacy. Before using real student data, separate public directory fields from private contact/identity fields and review disclosure with the institution.
- Manual student verification is not equivalent to an authoritative LPU registry check.
- Account restrictions block the NeonVerse workspace only; they do not disable Firebase Authentication.
- Large-group creation can write up to 250 membership documents in one operation set. Bigger classes should be split into smaller sections until a trusted backend/batched enrolment process is implemented.
- Group/channel deletion currently processes a bounded client-side set of records; large-scale cleanup should be moved to a trusted backend.
- No file attachments, Firebase Storage, video/audio, real-time push notifications, payment processing, biometric attendance, ERP sync or emergency dispatch are included.
- Add institution-approved retention, moderation, audit logs, accessibility review, backups and an incident-response process before production use.

## 11. Local development

You can serve the static files with any local HTTP server. For example, from the folder containing `index.html`:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000` and ensure `localhost` is an authorised Firebase Authentication domain.

Before deployment, check JavaScript syntax with:

```bash
node --check script.js
```


## Latest admin and usability update (4 November 2026)

The current package adds campus-scoped admin message moderation (archive/restore/delete), club edit/delete governance, event/RSVP cleanup, leave departure/return times, a Degree / programme onboarding field with a legacy `department` alias, case-insensitive client-side matching, and saved text-size preferences. See `UPDATE-NOTES.md` for the full list and validation limits.

**Important:** Admin message moderation exposes campus conversations to the campus administrator role. Only assign `roles/{uid}.role = "admin"` to trusted university operators. The Firestore rules keep this access within the administrator's own `universityKey`; never replace them with public rules. A local syntax check does not prove that your Firebase project's deployed rules, indexes, authentication settings or existing data schema are correct.

## AI Work implementation and first-time setup

See [`AI-WORK-START-HERE.md`](AI-WORK-START-HERE.md) for the step-by-step deployment, Firestore Rules publication, Agent37 Personal-plan credential check, Vercel environment variables and safe test procedure.


### Agent37 AI Work (expanded)
Staff can use natural language for application decisions and supported campus creation tasks (clubs, events, notices and role-permitted chat channels). Administrators can issue reversible campus access restrictions for a uniquely identified user. AI Work logs the request and execution summary in `aiWorkHistory`. It does not permanently delete Firebase Auth accounts or change roles.


## Agent37 challenge dashboards — 4 November 2026

This package adds two administrator-only pages under **Agent37 Control**:

- **Agent37 Evaluation Dashboard** — timestamped records from real, non-mutating evaluation probes; task success and average execution time from the signed-in administrator's real AI Work history; policy compliance from evaluated security probes; pass/fail/blocked totals; result table and outcome chart.
- **Agent37 Safety & Reliability Center** — campus-scoped live listeners for the existing application workflow, campus-transfer queue, the signed-in administrator's own AI Work history, moderation state and evaluation probe records. It includes safe policy probes and filters for actor, role, source, action, decision and date.

### What the tests actually do

The probe runner uses the existing Firestore reads and the existing `POST /api/agent37-work` endpoint. It checks the signed-in account's own role/profile, attempts a same-value no-op write to its own role document to confirm Firestore denies all role writes, tests that the endpoint rejects a missing Firebase ID token, asks the existing Agent37 route for an unsupported role-escalation action, and submits a synthetic foreign-campus payload to confirm the server filters it. The runner **never calls** `executeAiWorkPlan()` and never executes any returned action. The two authenticated Agent37 probes call the configured Agent37 service and may consume API quota.

Every probe response is saved as an append-only `agent37EvaluationRuns` document with the test name, expected/actual outcome, pass/fail/blocked status, duration and server timestamp. Firestore rules restrict reads and creates to the campus administrator and campus key; updates/deletes are denied. The Firestore index includes campus key plus descending creation time.

### Deployment steps

1. Deploy the updated `firestore.rules` to Firebase Console → Firestore Database → Rules (or `firebase deploy --only firestore:rules`). Review and merge these changes with any rules you have added outside this ZIP; do not overwrite newer project-specific rules blindly.
2. Deploy the updated `firestore.indexes.json` (`firebase deploy --only firestore:indexes`) or create the composite index if Firebase shows an index link.
3. Deploy the updated `script.js` and `style.css` with the rest of the existing site. No new API route or browser secret is introduced.
4. Sign in with a Firebase account whose authoritative `roles/{uid}.role` is `admin`, has a verified campus profile, and confirm the existing Vercel environment variables for `/api/agent37-work` are configured.
5. Open **Agent37 Control → Safety & reliability** and run the probes. The evaluation dashboard will show only persisted responses; blocked infrastructure/configuration results are not counted as passes.

### Measurement limitations are intentional

- Task success rate and average task execution time use the signed-in administrator's own `aiWorkHistory` records because current Firestore rules do not permit reading other users' private task history. The evaluation dashboard uses the newest 200 campus-scoped test records.
- Human approval accuracy remains **Not measured** until the institution supplies independent ground-truth labels for decisions. The current application records show what a reviewer decided, not whether that decision was correct.
- The current backend does not expose a central policy-decision event stream or recovery/retry-chain telemetry. Monitor counters are explicitly derived from existing application decisions, the current administrator's AI Work history and evaluation probes; they are not presented as complete platform-wide security logs.
- Existing `aiWorkHistory` read rules permit users to read their own task history only. The Safety Center therefore does not claim to show other administrators' private Agent37 history.
- Historical AI Work records created before this update do not contain measured execution durations or blocked-action counts. Those values remain unavailable for old records; new runs record elapsed time and skipped actions.


For the judge walkthrough, metric definitions, deployment checks and safety boundaries, see [`agent37/CHALLENGE-DEMO-GUIDE.md`](agent37/CHALLENGE-DEMO-GUIDE.md).
