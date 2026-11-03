# NeonVerse — setup guide

NeonVerse is a vanilla HTML/CSS/JavaScript campus management starter designed for Firebase Authentication + Cloud Firestore on the Firebase Spark (free) plan, with static deployment on Vercel. It does not use Firebase Storage, Cloud Functions, a paid database, or a frontend framework.

## Included

- Animated landing page, responsive dashboard, light/dark theme and guided tour.
- Email/password and Google authentication.
- Student profile onboarding and profile editing.
- Same-university student directory and profile detail views.
- Direct text chat, live Firestore message listener, and university membership checks.
- Student applications; warden/admin review actions (approve, reject, escalate).
- Campus notices, academic overview, hostel-service request entry points.
- Global quick navigation/search.
- Firestore security rules and a role-provisioning pattern.

## 1. Create Firebase project (Spark)

1. Open https://console.firebase.google.com/ and create a project.
2. In **Build → Authentication → Get started**, enable **Email/Password** and **Google** providers.
3. In Authentication → Settings → Authorized domains, add your Vercel domain (and `localhost` for local testing).
4. In **Build → Firestore Database**, create a database. Choose a location close to your users.
5. Open Project settings → General → Your apps → Add app → Web app. Copy the Firebase config.
6. Paste the values into `firebase-config.js`. Do not commit private service-account keys. The web config is public by design; Firestore rules protect data.

## 2. Publish Firestore rules

In Firebase Console → Firestore Database → Rules, replace the starter rules with the contents of `firestore.rules`, then click **Publish**.

The rules deliberately deny client-side role assignment. Never loosen this rule to make a UI role selector work.

## 3. Provision the first warden/admin safely

This static-only version does not have a trusted server to validate a secret warden ID or issue custom claims. A secret typed into browser JavaScript is not secret.

Recommended no-backend setup:
1. Have the warden create/sign in to an account through Firebase Authentication.
2. In Firestore Console, create a document in the `roles` collection whose document ID is the warden's Firebase Authentication UID.
3. Set its field to `role` (string) = `warden`. Use `admin` for the university administrator.
4. The warden uses the Warden access option on the sign-in screen. The account is checked against the protected role document.

Because this version has no trusted backend, it intentionally does not collect or validate a secret warden ID in browser code. A secret embedded in JavaScript can be extracted by every visitor. The Warden access screen is therefore a role-restricted entry point: only the pre-authorised Firebase account can enter. If you require a separate secret-ID enrolment workflow, add a trusted server/Cloud Function or secure external identity provider later.

## 4. University membership and changing university

The profile's `university` value is used to scope the directory, chat and notices. In this starter, students can edit their university field, as requested. **This is not verified affiliation.** For a real university deployment, restrict university changes and require a verifier/admin approval process. Otherwise a user could type another university's name and impersonate membership. Firestore rules are a security boundary, but a string field alone cannot prove a student's enrolment.

For stronger production isolation, use a verified institution email domain, admin-approved membership records, and immutable university IDs. Do not use a free-text university name as the sole access credential.

## 5. Run locally

Because the app uses JavaScript modules, open it through a local static web server (not by double-clicking the HTML file).

For example, in this folder run:
```bash
python3 -m http.server 5500
```
Then visit http://localhost:5500.

## 6. Deploy to Vercel

1. Push the folder contents to a GitHub repository.
2. In Vercel, import the repository.
3. Framework preset: **Other**. Build command: leave empty. Output directory: `.` (root).
4. Deploy.
5. Add the Vercel production and preview domains to Firebase Authentication → Authorized domains.

## Free-plan and scope notes

- Firebase Authentication and Firestore have free-tier quotas and limits. Monitor usage in Firebase Console; quotas and availability can change.
- This project intentionally does **not** upload profile photos, images, PDFs or other files. It supports text-only messages and a document-reference field. Actual file upload requires a storage provider or an external document service; do not put file data in Firestore.
- The app does not generate PDF files yet. PDF export can be added as client-side generation later without Firebase Storage.
- No AI provider is connected. The Agent37 integration point is intentionally left for a later step. Never put an AI secret/API key in browser JavaScript.
- Academic timetable, attendance, events, analytics, visitor pass, SOS, audit log, moderation, group chats, read receipts, typing indicators, voice/video calls, push notifications and full admin management are roadmap items, not complete features in this starter.
- This is a starter release, not a security-audited production university system. Test with separate student and warden accounts before real use.

## Current data model

- `profiles/{uid}` — user profile and university name.
- `roles/{uid}` — trusted role assignment; manually created by project owner.
- `applications/{applicationId}` — student requests and review state.
- `conversations/{sortedUid_uid}` — direct conversation metadata.
- `conversations/{conversationId}/messages/{messageId}` — text messages.
- `notices/{noticeId}` — university notices.
- `activity/{activityId}` — basic event records.

## Troubleshooting

- **Firebase config not set:** update `firebase-config.js`.
- **auth/unauthorized-domain:** add your current hostname to Authentication → Settings → Authorized domains.
- **Missing or insufficient permissions:** publish the supplied rules, verify the profile exists, and provision staff role docs from the Firebase Console.
- **Google popup blocked:** allow popups for your deployed domain and test in a normal browser window.
- **Firestore index required:** if Firebase shows a link to create a composite index, open it and create the suggested index.
