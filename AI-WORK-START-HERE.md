# NeonVerse AI Work — updated setup

## What this release does
- Adds an AI Work shortcut to the application top navigation for students and staff.
- Staff can ask Agent37 to approve or reject matching pending applications in their verified campus. The staff instruction supplies the decision criteria; there is no hard-coded three-calendar-day leave limit.
- Students can ask Agent37 to prepare and submit a campus application for their own account.
- Supported actions execute automatically after server-side identity/role checks and client-side record revalidation.
- Application decision history records the acting staff UID, timestamp and review note. Students receive in-app notifications after staff decisions.

## Important limits
This is not unrestricted access to every operation in the website. Agent37 cannot bypass Firebase Authentication, Firestore Rules, campus isolation, or role permissions. In this release, staff automation supports approve/reject application actions; student automation supports submitting an application. Creating public posts, sending direct messages, changing roles, deleting records, payments, and other operations are not yet exposed as AI actions because each needs its own data model, authorization checks and audit handling. Unsupported actions are reported rather than claimed as complete.

## Vercel environment variables
- `FIREBASE_PROJECT_ID` — your Firebase project ID.
- `AGENT37_INSTANCE_URL` — HTTPS base URL of your Agent37 Cloud instance, without `/v1/responses`.
- `AGENT37_API_KEY` — secret Agent37 key. Keep it only in Vercel environment variables.

Set variables in Vercel → Project → Settings → Environment Variables, then redeploy. The Agent37 instance must be running and its managed model budget configured.

## Firebase
Keep the existing Firebase project configuration. Deploy the included `firestore.rules` only if you have reviewed it against your current production rules; do not replace production rules blindly. The AI actions use existing application create/update and notification permissions.

## Test
1. Sign in as a verified student. Open AI Work from the top navigation and ask it to submit a clearly described leave or maintenance application. Confirm it appears in Applications.
2. Sign in as a verified Warden/Faculty/Admin. Ask it to approve or reject a specific pending campus application. Confirm the status, review history and student notification.
3. Try to act on another campus or another student's account; the action should be rejected by authorization checks and Firestore Rules.

## Operational safety
Automatic execution means the agent executes only the supported actions after validation. Do not use this for high-impact or legally binding decisions without a human review process and clear institutional policy. Back up Firestore and test with non-production records before enabling it for real student data.
