# Provisioning Admin, Warden and Faculty accounts

NeonVerse does not let a person become staff by selecting a role on the sign-in page. The role selector only tells the app which already-assigned role the person expects to use. Firebase's `roles/{uid}` document is authoritative, and Firestore rules must remain private.

## Create a staff account safely

1. Ask the staff member to create an account using **Create account**. The self-service sign-up flow is intentionally student-only and asks for basic identity and university details, not student course/year details for staff.
2. The staff member verifies the email using the link sent by Firebase Authentication.
3. In Firebase Console, open **Authentication → Users** and locate the verified account. Copy its Firebase Auth **UID**.
4. Open **Firestore Database → Data → roles**. Create a document whose document ID is exactly that UID.
5. Add a string field named `role` with exactly one of these values: `admin`, `warden`, or `faculty`.
6. Have the staff member sign out, sign in again, and choose the matching role button. NeonVerse checks that button against `roles/{uid}`; a mismatch is denied.
7. On first staff sign-in, the profile form asks for staff-specific information: employee/staff ID, designation, department/office, optional office or hostel unit, and professional bio. It does not require student registration ID, course, or year.

## Permissions and safety notes

- Do not add staff roles to a user-editable profile field. Do not loosen Firestore rules to allow users to write `roles` documents.
- Keep `roles/{uid}` writes restricted to trusted university administrators using the Firebase Console or a trusted server-side provisioning process.
- This project supports assigning a role **after** the Firebase Auth account exists, because Firebase Auth UIDs are generated at account creation. Pre-authorising an email before an account exists requires a trusted invitation/Cloud Function workflow; do not implement it in browser JavaScript.
- A role assignment alone is not a substitute for a verified, correct campus profile. Assign staff accounts only for the intended university and verify their staff identity before enabling access to real student records.
- For an existing account, update the `role` field on the existing `roles/{uid}` document; do not create a second account or change the UID.

## Valid role values

| Role document field | Workspace |
|---|---|
| `role: "admin"` | University Administration |
| `role: "warden"` | Warden workspace |
| `role: "faculty"` | Faculty workspace |
| No staff role document (or `role: "student"`) | Student workspace |

If sign-in is rejected, verify that the selected button matches the exact `role` field and that the user is using the correct Firebase project.
