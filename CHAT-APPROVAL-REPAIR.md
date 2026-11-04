# NeonVerse chat approval repair — quick deployment guide

## What this repair addresses

- A student session can keep an old cached `pending` status after a staff member verifies the Firestore profile. The app now refreshes the profile and role from the server and listens for profile/role changes.
- The first live profile snapshot is checked instead of ignored.
- The pending screen shows the exact profile UID and campus key.
- Staff approval is confirmed by reading the target profile back from the Firestore server.
- Direct-conversation existence checks and conversation-list loading use server reads.
- A failed optional conversation-preview update no longer falsely reports that a successfully saved message was not sent.
- Profile document IDs are used as canonical user UIDs in approval lists.

## Deploy all three parts

1. Back up the current project.
2. Replace `script.js` and `firestore.rules` with the files in this package. Keep your own real Firebase Web config in `firebase-config.js`; do not replace it with the placeholder version from a package unless you re-enter your project values.
3. Publish the complete `firestore.rules` file in Firebase Console → Firestore Database → Rules.
4. Deploy indexes from the project root: `firebase login`, `firebase use YOUR_FIREBASE_PROJECT_ID`, `firebase deploy --only firestore:rules,firestore:indexes`.
5. Push the updated project to GitHub and wait until the Vercel deployment is Ready.
6. Hard-refresh the website, sign out, sign back in, open Messages and press **Refresh approval status** if needed.

## Required Firestore profile state for each student

Open `profiles/{Firebase Authentication UID}`. Confirm:

- Document ID is exactly the student's Firebase Authentication UID.
- `uid` equals that same UID.
- `profileComplete` is boolean `true`.
- `membershipStatus` is string `verified` (lowercase).
- `universityKey` is string `lovely-professional-university` for the LPU pilot.

Both people in a direct chat must be verified and have exactly the same `universityKey`. Each staff verifier needs `roles/{staff UID}` with `role` equal to `admin`, `warden`, or `faculty`; the staff member's own profile must be complete and use the same campus key.

## If it still fails

- If **Refresh approval status** reports `pending`, Firestore still returns `pending` for the exact UID displayed by NeonVerse. Check that exact profile document; do not approve a different UID.
- If it reports `verified` but the directory is empty, check the second user's verified status and campus key.
- If the console reports `Missing or insufficient permissions`, confirm the new rules have been Published to the same Firebase project configured in `firebase-config.js`.
- If Firebase reports a missing index, use the generated Firebase link and wait for the index to become Enabled. The included index file has the direct-chat index for `participants` + `universityKey`.
- Legacy conversation documents without `universityKey` are omitted from the new campus-scoped list; new chats created after deployment include the key.

## Validation performed

Local validation performed: `node --check script.js`, JSON parsing of `firebase.json` and `firestore.indexes.json`, HTML parsing, basic Firestore Rules delimiter balance, and ZIP integrity. The Firebase Rules compiler/emulator and a live sign-in/chat test against your Firebase project were not available, so deploy first to a test project or test accounts. This package is not represented as guaranteed error-free until those live tests pass.
