# AI Work — start here

This release adds a staff-only **AI Work** item to the NeonVerse sidebar for authorised Wardens, Faculty and Administrators.

## 1. Understand the Agent37 account route first

The Hackyard message you shared says to use **Agent37 Personal** at <https://www.agent37.com/personal>, choose **Start free**, and do not enter a card. Follow that instruction. Do not open Cloud API, add a card, buy a plan or top up just to connect NeonVerse.

The website code calls the documented Agent API endpoint `https://INSTANCE_ID.agent37.app/v1/responses` and sends an `X-Agent37-Key` header. An instance ID alone is not enough. The public Agent37 API documentation does not confirm that a Personal Free agent exposes the external API key/access needed by this integration.

After creating your Personal Free agent, ask a Hackyard host this exact question:

> I created a Personal Free Agent37 instance for Build 2026. Can my Vercel website call `https://INSTANCE_ID.agent37.app/v1/responses`? If yes, where do I get the `X-Agent37-Key` credential without opening Cloud API, adding a card, or paying?

Do not invent a key or copy any browser/session token. Continue to Step 2 only after the host confirms the supported endpoint and credential for your Personal agent. If the Personal Free plan cannot be called by an external website, the feature cannot connect through this API route until Hackyard/Agent37 provides an approved option.

## 2. Update the deployed project

1. Download/unzip this project update.
2. Copy the updated project files into your existing NeonVerse GitHub repository, keeping the folder structure (`api/`, `agent37/`, `index.html`, `script.js`, `style.css`, `firestore.rules`, `vercel.json`, and documentation).
3. Keep the real Firebase Web config for your NeonVerse project in `firebase-config.js`. Do not replace it with a placeholder from another project.
4. Commit and push the updated files. Vercel should deploy from the connected GitHub repository. This project is static HTML/CSS/JS; no npm build command is required unless your Vercel project already uses one.

## 3. Publish the Firestore security rules

The updated `firestore.rules` requires a staff decision to update an application only while its current status is `pending`. This helps prevent a stale AI plan from overwriting a decision another staff member has already made.

From a terminal with Firebase CLI:

```bash
firebase login
firebase use YOUR_FIREBASE_PROJECT_ID
firebase deploy --only firestore:rules
```

Or copy the full updated `firestore.rules` into Firebase Console → Firestore Database → Rules and click **Publish**. Do not use public rules such as `allow read, write: if true`.

## 4. Configure the Vercel backend

In Vercel → NeonVerse project → Settings → Environment Variables, add/update these for the deployment environment you will test:

| Variable | Value |
|---|---|
| `FIREBASE_PROJECT_ID` | The same project ID in your `firebase-config.js` |
| `AGENT37_INSTANCE_URL` | The base URL confirmed by Agent37, e.g. `https://YOUR_INSTANCE_ID.agent37.app` (no `/v1/responses` at the end) |
| `AGENT37_API_KEY` | The Agent API key explicitly confirmed/issued for your Personal instance |

Store the key only in Vercel. Never put it in `script.js`, `index.html`, `firebase-config.js`, GitHub, a screenshot, or a message. Save the variables and redeploy. The existing chat assistant and AI Work page use these same three variables.

## 5. Give staff their correct roles

For every authorised Warden, Faculty member and Administrator:

1. In Firebase Console → Authentication → Users, open the staff account and copy its User UID.
2. In Firestore, open/create collection `roles`.
3. Create a document whose document ID is exactly that UID.
4. Add a string field `role` with one of: `warden`, `faculty`, `admin`.
5. The staff member signs out/in and completes their campus profile. Their profile must be verified and use the same campus as its student applications.

Never let students create/edit `roles` documents. Staff accounts must be provisioned by the project owner/institution IT team.

## 6. Test safely

1. Sign in as a Warden, Faculty member or Admin and look for **AI Work** in the sidebar.
2. Create or use test applications in a test campus/database: one 1-day leave, one 3-calendar-day leave, one 4-calendar-day leave, and one non-leave application.
3. Enter: `Approve all pending leave applications that are not more than 3 calendar days. Leave longer requests for manual review.`
4. Confirm that only the 1-day and 3-day leave applications appear in the proposed plan. The 4-day and non-leave requests must not be approved.
5. Check each proposed row. Click **Confirm & execute** to apply the approvals. Confirm the Firestore application status, review history, and student's in-app notification.

**Date counting:** both the first date and last date count. For example, June 1 through June 3 is 3 calendar days; June 1 through June 4 is 4 calendar days and is excluded.

## What this first version can do

It can ask Agent37 to interpret staff instructions and produce a plan for approving pending leave requests up to 3 calendar days. It can also summarise pending requests without changing them. The app validates all proposed writes, checks the latest Firestore records and requires staff confirmation. It does not give the model unrestricted access to the university database or browser.

It does not yet approve longer leave, reject applications, publish notices, change student profiles or roles, or carry out arbitrary staff instructions. Add future actions one at a time through explicit backend validation and Firestore rules; do not give the model your Firebase Admin credentials or unrestricted database access.
