# NeonVerse reliability update

## Approval queue and decisions

- Current-schema (`universityKey`) and legacy-schema (`university`) pending applications are loaded independently and merged by document ID.
- If one source fails, the available records remain visible and the screen warns that the queue may be incomplete. If both sources fail, an error is shown instead of an empty queue.
- The review dialog reads the selected record from the Firestore server rather than trusting a potentially stale local cache.
- Review actions map to Firestore's accepted values: `approved`, `rejected`, and `escalated`.
- A Firestore transaction re-reads the application, checks the campus and verifies that the request is still `pending` before recording the decision and reviewer history. Competing reviewers cannot silently overwrite a completed decision.
- Student cancellation remains a separate `cancelled` transition. Duplicate pending requests with the same application type/title and date range are blocked in the client before submit.

## Staff onboarding and roles

- Staff profile completion asks for employee ID, designation, department/office, optional staff unit and professional bio. It does not require student course/year fields.
- Self-editable profile fields include staff profile details but do not include the authoritative role, campus membership state or verification state.
- Admin/Warden/Faculty role assignment remains in `roles/{uid}` and cannot be self-selected or self-written by the browser. See `STAFF-ROLE-SETUP.md`.

## Messaging and notices

- Private direct conversations remain writable only by their participants. Admin moderation is not silently converted into a private-chat impersonation capability.
- Staff can use campus channels and role-permitted class/subject/hostel groups to communicate with a campus or defined group. The Messages page links to these channels.
- Official notices and community posts load independently. A failure in one source no longer hides the other. The board includes keyword search and official categories/priority labels.

## Deployment

1. Preserve your existing `firebase-config.js`, `.firebaserc` and Vercel environment variables.
2. Deploy the project source to your existing Vercel project.
3. Publish the included `firestore.rules` in Firebase Console → Firestore Database → Rules. Do not make the database public.
4. Deploy the existing `firestore.indexes.json` if Firebase displays an index-required error for one of your queries.
5. Test with separate student, admin, warden and faculty accounts in the same campus before using live student records.

## Verification scope

The included JavaScript files and JSON configuration can be syntax/parse-checked offline. A local ZIP check does not prove live Firebase rules, indexes, role assignments, Vercel secrets, Agent37 credentials or campus data are correct. Run the account-based checks in your own Firebase/Vercel environment before production use.
