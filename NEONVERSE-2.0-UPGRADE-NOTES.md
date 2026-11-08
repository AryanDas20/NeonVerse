# NeonVerse 2.0 – UI and AI Work upgrade

This upgrade builds on the existing Firebase and Agent37 architecture. It does not replace Firebase configuration, database collections, role documents or Firestore security rules.

## What's new

- **Conversational campus copilot:** the signed-in AI widget now routes verified users through the existing `/api/agent37-work` task planner and the existing permission-checked `executeAiWorkPlan()` executor. It can answer detailed feature questions, open implemented workspace pages and run currently supported actions. Explicit navigation requests use a deterministic page map so common “open…” commands do not depend on model interpretation.
- **Student and staff boundaries:** students can navigate and submit supported requests for their own account. Warden, Faculty and Admin use the current staff allow-list. The API reads the authoritative Firebase role and profile; browser-selected role text is not an authorization signal. Unverified members retain read-only AI help and page navigation, but task execution waits for verified membership.
- **AI Work explanations and personal context:** the assistant receives the current page context, gives detailed feature guidance, and can answer a student’s application-status questions using a server-side Firestore query filtered by the authenticated student UID and campus. It never accepts browser-supplied student history as trusted data. Results remain constrained to the server's action allow-list.
- **University Administration workbench:** added a governance overview for identity and access, academics, campus groups, notices/events, applications/hostel operations and Agent37 oversight. Displayed counts come from the campus-scoped Firestore queries already used by the page.
- **Class and subject groups:** added group-type summaries, searchable channel list, richer group metadata (subject name/code, section and semester), clearer enrolment/group details, and AI-assisted group creation with role-matched group types and bounded campus roster enrolment.
- **Profile redesign:** added a campus identity hero, profile-completion ring, academic and contact summary cards, verification status and checklist.
- **Settings redesign:** added theme, text scale, reduced-motion and compact-layout preferences, account/verification information, AI history clearing, privacy explanations, platform guide links and sign-out controls.
- **Visual refresh:** added animated ambient gradients, subtle background grid movement, page transitions, hover states, animated accents and responsive profile/settings/group layouts. A reduced-motion control and `prefers-reduced-motion` support are included.
- **Overview:** added a campus copilot callout and direct launch control.

## AI capabilities currently supported

The AI assistant can explain the features and role boundaries that are present in this project, navigate among implemented pages and propose actions supported by the existing task executor. Staff actions include navigating, reviewing selected pending applications, creating clubs, events, notices and detailed channels/groups, and restricting a campus account (Admin only). Student actions include navigating, looking up their own application history and submitting supported applications for their own account.

AI does **not** receive unrestricted database access. It cannot grant roles, bypass Firestore rules, delete Firebase Authentication users, create unsupported university integrations, or claim that an unimplemented feature is live. When a task is outside the allow-list, it must be explained or reported as not supported.

## Setup / deployment

1. Keep your current `firebase-config.js` and `.firebaserc` values. Do not replace them with placeholders.
2. Keep the existing Vercel environment variables used by Agent37 and Firebase: `FIREBASE_PROJECT_ID`, `AGENT37_INSTANCE_URL` and `AGENT37_API_KEY`.
3. Deploy the updated source to the same Vercel project.
4. No new Firestore collection or rules migration is required for these UI changes. The new group metadata uses optional fields on existing channel documents.
5. Test with separate Student, Warden, Faculty and Admin accounts from the same campus. Confirm each AI action against the correct role and campus before production use.

## Validation performed in the source bundle

- JavaScript syntax validation for `script.js` and API handlers.
- JSON parsing validation for Firebase configuration and Firestore indexes.
- ZIP integrity validation after packaging.

Live Firebase permissions, Agent37 model behaviour, Vercel environment variables and real campus accounts cannot be verified from this offline source archive. Test those on your deployed environment before using real university records.
