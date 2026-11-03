# NeonVerse — updated campus workspace

NeonVerse is a vanilla HTML/CSS/JavaScript web app using Firebase Authentication and Cloud Firestore, designed to run on the Firebase Spark plan and deploy as a static site on Vercel. It does not require React, a build command, Firebase Storage or Cloud Functions.

This update fixes the original chat write order and replaces the old two-person-only chat rules with campus-scoped direct and group conversations. It also adds navigation history, responsive mobile chat navigation, required-profile gating, campus verification, case-insensitive search, group administration, message editing/deletion and in-app notifications.

## Included and working in this release

- Email/password and Google sign-in.
- Warden/admin sign-in based on manually provisioned Firebase role records.
- Required student onboarding: name, university, registration ID, department, course and year.
- Workspace navigation with a Back button and mobile navigation drawer.
- Responsive dashboard, profile, applications, hostel request forms, notices, settings and theme toggle.
- Case-insensitive people and chat search by name, university email, phone, registration ID, department and course (within the profiles returned by the campus query).
- Student directory and direct messages limited to verified members of the same canonical campus.
- Chat feed contains only conversations the signed-in user has started or joined. It does not list every student.
- Direct and group text conversations; group creation supports up to 8 members including the creator.
- Live message updates, read/seen indicators, search within a conversation, edit own messages and soft-delete own messages for everyone.
- Group admins can rename the group, add/remove users, promote/demote admins and delete the group and its messages.
- Larger in-app notification inbox for messages, application decisions and campus-transfer decisions, with unread counts, mark-all-read and delete controls.
- Student application submission/cancellation and staff approval, rejection or escalation.
- Campus transfer requests; an administrator/verifier at the destination campus must approve before the student's campus is changed.
- Administrator/verifier queue for approving pending student membership.
- Firestore rules and suggested composite indexes.

## Search coverage and personal-data warning

The current client-side campus search loads up to 150 verified profiles for the active campus, then performs case-insensitive matching by name, email, phone, registration ID, department and course in the browser. This is suitable for a prototype or a small pilot, but it is not a scalable university-wide search index. For a large campus, use a dedicated indexed search service or a trusted server-side search endpoint.

Important privacy point: the current rules grant verified same-campus members read access to the campus profile document so the browser can search it. That means fields stored in that same document (including email, phone and registration ID) are visible to those members, not just the fields displayed in the UI. Firestore Rules grant or deny document reads; they do not hide individual fields within a readable document. Do not load real student contact details until the institution approves this visibility or the app is redesigned to separate private contact data from searchable directory data.

## Features not included yet

This build does not provide file/image attachments, Firebase Storage, voice/video calls, typing indicators, push notifications, attendance sync, a live timetable, assignment/exam management, event/club administration, online payments, AI Agent37, or PDF export. The Academics and Events screens are clearly marked as not connected instead of showing fake working buttons. Emergency services are not contacted by this website.

## 1. Add your Firebase web configuration

1. Open Firebase Console → Project settings → General → Your apps → your NeonVerse Web app.
2. Copy the full Firebase Web App configuration.
3. Open `firebase-config.js` and replace all placeholder values. The file should look like:

```js
export const firebaseConfig = {
  apiKey: "YOUR_REAL_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  appId: "YOUR_REAL_APP_ID"
};
```

Use the exact values shown by Firebase. Do not paste a service-account private key into this file. The Web App config is meant to be public; database access is controlled by Firestore Rules.

## 2. Firebase Authentication

In Authentication → Sign-in method, enable:

- Email/Password
- Google

In Authentication → Settings → Authorized domains, add `localhost` for local testing and your Vercel domain after deployment.

## 3. Publish the new Firestore Rules

1. Open Firebase Console → Firestore Database → Rules.
2. Replace the old rules with the complete contents of `firestore.rules` from this updated package.
3. Click **Publish**.

Important: the new rules are stricter than the original rules. Publish them before testing chat. A signed-in student must complete their profile and have `membershipStatus: "verified"` before the directory and messaging become available.

## 4. Create the Firestore indexes

The app uses compound queries. Deploy the included `firestore.indexes.json` with the Firebase CLI if you have it configured, or use the **Create index** link that Firebase shows when a query first runs.

Required collection indexes:

| Collection | Fields |
|---|---|
| `profiles` | `universityKey` Ascending + `membershipStatus` Ascending |
| `conversations` | `participants` Array contains + `universityKey` Ascending |
| `applications` | `universityKey` Ascending + `status` Ascending |
| `applications` | `studentUid` Ascending + `createdAt` Descending |
| `campusChangeRequests` | `requestedUniversityKey` Ascending + `status` Ascending |
| `conversations` (legacy migration) | `participants` Array contains + `university` Ascending |
| `applications` (legacy records) | `university` Ascending + `status` Ascending |

Wait for each index to say **Enabled** before testing that section. Your earlier `applications` index (`studentUid`, `createdAt`, `__name__`) is the student-application index; the updated app may request additional indexes. The package now includes `firebase.json`, so a Firebase CLI user can deploy both rules and index definitions from this folder with `firebase deploy --only firestore:rules,firestore:indexes` after running `firebase use` for the `neonverse-18e00` project. Alternatively, paste the rules in the Firebase Console and create each index from the error link as Firebase requests it. For CLI deployment, install Firebase CLI, run `firebase login`, select the project with `firebase use --add` (choose `neonverse-18e00`), then run `firebase deploy --only firestore:rules,firestore:indexes`.

## 5. Campus membership verification

The university name alone is not proof of enrolment. This version separates profile completion from membership verification:

1. A student signs up and completes the required profile.
2. The student's `membershipStatus` starts as `pending`.
3. A university administrator or college verifier checks the registration ID against real university records.
4. The verifier opens Student directory → Pending student verification and clicks **Verify**.
5. Only verified users can search the campus directory, start direct conversations or join group chats.

For the very first admin/verifier, the project owner can create `roles/{firebaseAuthUid}` in Firestore with `role: "admin"` or `role: "verifier"`. The role document is trusted and cannot be created/changed by the website itself. The admin/verifier should complete their profile and have `profiles/{uid}.membershipStatus` set to `verified` by the project owner (or have another authorised verifier verify them).

For a warden, create `roles/{uid}` with `role: "warden"`. Wardens can review applications and publish notices. The admin/verifier role is the one allowed to approve student membership and destination-campus transfers. If a warden or faculty member should also participate in student chats, set that staff profile's `membershipStatus` to `verified` after confirming their campus affiliation; the chat rules check every participant profile, including staff.

## 6. University abbreviations and case-insensitive matching

Search matching is case-insensitive. The initial alias map treats `LPU`, `lpu`, `Lovely Professional University`, and `Lovely Professional University (LPU)` as the same canonical campus key.

To add another official university short form, edit `CAMPUS_ALIASES` near the top of `script.js`, for example:

```js
const CAMPUS_ALIASES = {
  lpu: "lovely-professional-university",
  lovelyprofessionaluniversity: "lovely-professional-university",
  iitm: "indian-institute-of-technology-madras",
  indianinstituteoftechnologymadras: "indian-institute-of-technology-madras"
};
```

The key is built from the alias target after normalisation. Add both the short form and the full-name normalised form. Use official aliases supplied by the university; do not map unrelated institutions to the same key.

A student who needs to join another university can use **My profile → Request campus change**. The destination campus admin/verifier must approve the request. After the transfer, the student is pending verification in the new campus until the destination verifier confirms enrolment.

## 7. Run locally on Mac

Open Terminal in the NeonVerse folder and run:

```bash
python3 -m http.server 5500
```

Then open `http://localhost:5500`. Do not open `index.html` by double-clicking it; the JavaScript modules need to be served over HTTP.

## 8. Deploy on Vercel

1. Upload the contents of this folder to the root of your GitHub repository.
2. Import that repository into Vercel.
3. Framework preset: **Other**.
4. Build command: leave empty.
5. Output directory: `.`.
6. Deploy, then add the Vercel hostname to Firebase Authentication → Settings → Authorized domains.

## Data model

- `profiles/{uid}` — student/staff profile, canonical `universityKey`, `membershipStatus`.
- `roles/{uid}` — trusted staff role assigned by the project owner.
- `applications/{id}` — student requests and review state.
- `campusChangeRequests/{id}` — requests to move to a new campus, reviewed by the destination verifier.
- `conversations/{id}` — direct or group metadata, participant UIDs, group admins and last-message summary.
- `conversations/{id}/messages/{id}` — text messages, edit/delete state and read receipts.
- `notices/{id}` — campus announcements.
- `notifications/{uid}/items/{id}` — in-app notification inbox.

## Troubleshooting

- **Missing or insufficient permissions:** first confirm that the new `firestore.rules` have been published. Then check that your profile is complete, `membershipStatus` is `verified` for chat, and staff roles are provisioned in `roles/{uid}`.
- **New students cannot see directory/chat:** their membership is still pending. An admin/verifier must check their registration ID and approve them.
- **Firestore index required:** open the creation link, create the exact suggested index and wait for Enabled.
- **Message send rejected:** the conversation record is created before its first message in this version. If it still fails, check the conversation's university key and that every member is verified in the same campus.
- **Google sign-in rejected:** add the current hostname to Authentication → Settings → Authorized domains.
- **Campus abbreviation not matching:** add the official short form and full university name to `CAMPUS_ALIASES` in `script.js`.

## Important deployment warning

This is a more capable starter, not a security-audited production university system. Do not use real student records until the institution has reviewed the rules, membership-verification process, retention policy, moderation/reporting workflow and privacy obligations. Text chat currently has no file attachments, encryption beyond Firebase's transport/storage controls, blocking/reporting UI, or push notifications. The browser does not contain a secret warden ID; trusted roles are managed in Firebase.
