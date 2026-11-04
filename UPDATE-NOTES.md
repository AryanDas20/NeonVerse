# NeonVerse update notes

## Included changes

- Staff verification queues now read all campus-scoped profile pages (500 documents per page) and show every student with `membershipStatus: pending` or a legacy missing status, including profiles that have not been completed and display 0% progress.
- Approval is disabled until both email verification and required profile completion are recorded.
- Email/password registration sends a Firebase verification email. Unverified password accounts cannot enter the workspace. Email domains are not restricted; users must be able to receive the verification link.
- Signup and profile completion collect a college short name. Full and short names are included in the people search. Search matching ignores case and punctuation.
- Department, course and hostel matching for automatic group enrolment ignores case.
- Updated dark and light theme colors to emerald/green and rose/pink, with improved contrast for chat messages, controls, form fields and search results.
- Fixed the undeclared `firstProfileSnapshot` variable and the auth form's `finally` block clearing error messages immediately.

## Required Firebase steps

1. Keep your real Firebase Web App values in `firebase-config.js`; the values in this package are placeholders.
2. In Firebase Authentication, enable Email/Password and keep the email verification template enabled. Add your Vercel hostname to Authorized domains.
3. Publish the included `firestore.rules` and deploy `firestore.indexes.json` if your project uses the Firebase CLI.
4. Deploy the updated project to Vercel.

## Validation scope

`script.js` passed `node --check`; `firebase.json` and `firestore.indexes.json` parsed as valid JSON; the ZIP archive passed its integrity check. This is static validation only. Live Firebase Authentication, Firestore Rules compilation, Firestore indexes, browser rendering and Vercel deployment still need to be tested in the user's Firebase/Vercel projects.

## University operations & admin refinement — 4 November 2026

This revision builds on the Green/Pink edition and adds:

- Campus administrators can review campus-scoped direct and group conversations, archive/restore messages, and permanently remove messages. Admin moderation is read-only unless the admin is a conversation participant.
- Campus administrators can archive/restore and remove messages in class, subject, hostel, campus and club channels.
- Campus administrators can edit club name/category/description/join availability, delete clubs and remove linked club membership requests, club channels, channel memberships and channel messages.
- Campus administrators can delete events and their RSVP records, and the existing notice/community post moderation remains available.
- Club approval now ensures the approved student has an active channel-membership record, even if the original request flow did not create it successfully. The student also receives an in-app notification.
- Hostel/medical/emergency leave applications now request departure and return dates and times and validate that the return is after departure.
- Profile onboarding now labels the academic field **Degree / programme**. It writes the new `degree` field and keeps `department` as a compatibility alias for older records and existing course/roster logic.
- Search and matching are normalised case-insensitively in the client-side directory, campus people search, featured groups, hostel matching and faculty roster filtering.
- Settings now include a persistent interface text-size preference (compact/default/comfortable/large). Default is Comfortable.
- Larger modals, increased body/control/chat text, green/pink accent refinement, improved focus states and subtle background animation have been added.
- Static labels that implied an unverified live/official metric have been clarified. Counts fetched with limits are labelled as the current loaded view.
- Firestore rules now allow campus administrators to list/read campus conversations for moderation and archive message metadata, while keeping the scope restricted to their own campus and preserving role checks. Club metadata updates are limited to safe fields and cannot change campus ownership.
- Composite indexes were added for club cleanup and event RSVP cleanup queries.

### Deployment and testing notes

1. Keep the real Firebase Web App values in `firebase-config.js`.
2. Publish the included `firestore.rules` in Firebase Console → Firestore Database → Rules.
3. Deploy the included indexes using `firebase deploy --only firestore:rules,firestore:indexes` or create the exact indexes Firebase requests.
4. Verify admin permissions with a separate test student, faculty/warden and admin account. Do not test destructive actions on real campus records first.
5. JavaScript syntax, JSON parsing, HTML parsing, CSS delimiters and ZIP integrity were checked locally. The Firebase Rules compiler, live Firebase project, browser UI and cross-account workflows were not available for end-to-end verification in this packaging session.
- New profile and channel records also store normalised degree/course/hostel keys so matching can ignore capitalization while preserving the display labels. Legacy records retain their original exact-field fallback until users update their profile.

### Firestore Rules syntax hotfix — 4 November 2026

- Fixed the invalid `allow update` statement in the channel-message rules: added the required `if` keyword before the permission condition.
- This resolves the Firebase Console parser warning: `Missing 'if' before conditional expression` at the affected rule line.
- Rechecked JavaScript syntax, Firebase config/index JSON parsing, rule delimiter balance and `allow`-statement `if` presence.
- This local static validation does not replace publishing the rules in the intended Firebase project or testing with the Firebase Rules Emulator/Console simulator.
