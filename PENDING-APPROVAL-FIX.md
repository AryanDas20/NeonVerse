# NeonVerse pending student approvals fix

## What changed
- Admin dashboard now uses a dedicated Firestore query for profiles whose `universityKey` matches the admin campus and whose `membershipStatus` is `pending`.
- Pending student records are no longer hidden just because `profileComplete` is false. Incomplete registrations appear with an `Await profile` state; approval/rejection controls remain disabled until onboarding is complete.
- The directory approval panel follows the same rule.
- Firestore rules now explicitly permit campus-scoped `list` queries for Admin/Warden/Faculty verifier roles. The query must constrain `universityKey` to the signed-in staff member's own campus.
- Existing role separation remains: role documents are owner-managed and client writes to `/roles` remain denied.

## Deploy
1. Keep your real `firebase-config.js`; do not replace it with placeholder values.
2. Replace the project files with this package.
3. Publish `firestore.rules` in Firebase Console, or deploy with `firebase deploy --only firestore:rules,firestore:indexes`.
4. Deploy the updated files to Vercel.
5. Ensure each student profile is stored at `profiles/{Firebase Auth UID}` and has `universityKey: "lovely-professional-university"` and `membershipStatus: "pending"`.
6. Ensure the staff account has `roles/{staff Firebase Auth UID}` with `role` equal to `admin`, `warden`, or `faculty`, and its own profile has the same `universityKey`.

## Notes
- A student with an incomplete profile appears in the queue but cannot be approved until profile completion is true.
- This package has local syntax/JSON/ZIP checks only. It has not been tested against your live Firebase project, and Firestore rules have not been compiled by Google's rules compiler in this environment.
