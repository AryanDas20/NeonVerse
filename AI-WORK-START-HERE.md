# NeonVerse AI Work — setup guide (Agent37 Cloud API credit route)

This project update already contains the NeonVerse AI Work page and its secure Vercel backend. The backend calls Agent37 at `https://YOUR_INSTANCE_ID.agent37.app/v1/responses` using `X-Agent37-Key`; the secret stays on Vercel, never in browser JavaScript.

## Why this guide uses Cloud API

For a website integration, use **Agent37 Cloud API**, not the Personal Free dashboard agent. The Cloud API has documented instance provisioning, per-instance managed-model budgets, and an API credential. A Personal instance ID alone is not sufficient for the website's authenticated API request. This choice is for the NeonVerse integration; it does not change the separate Build 2026 challenge submission rules.

## 1. Claim the Hackyard credit first — do not add a card

1. Open <https://www.agent37.com/redeem/HACKYARD>.
2. Sign in to the Agent37 account you want to use for NeonVerse.
3. Click **Claim $10.00**.
4. Continue only if the page confirms the credit was added.
5. Check <https://www.agent37.com/dashboard/cloud/billing>. Make sure you are viewing **Cloud API** billing and that the balance includes the promotional credit.

The credit instructions supplied for this event say no card is needed. **Do not add a card, buy a subscription, enable auto top-up, or manually top up.** If the claim page asks for a card or does not show the credit, stop here rather than paying. Promotional availability can vary by account.

## 2. Create a Cloud API key

1. Open <https://www.agent37.com/dashboard/cloud/api-keys>.
2. Create a new API key for NeonVerse.
3. Copy it once and store it in a password manager temporarily. It is a secret. Do not send it to ChatGPT, paste it into source code, screenshots, GitHub, or `firebase-config.js`.

This key is used by the Vercel backend to call the Agent37 instance. Agent37 uses a Bearer key for Cloud control-plane operations and the raw key in the `X-Agent37-Key` header when calling the instance's `/v1/responses` endpoint.

## 3. Create one agent instance

1. Open the Cloud API **Instances** page: <https://www.agent37.com/dashboard/cloud/instances>.
2. Click **Create instance**.
3. Select template **agent37-hermes**.
4. Keep the default size initially, but inspect the displayed compute and disk price before creating it.
5. Set a managed-services budget. The supplied Hackyard example is **$1.00** (`credit_micros: 1000000`). This is only the maximum managed-service spend allowed for this instance; it is not extra money. The actual spend still comes from the Cloud API wallet.
6. Create the instance and wait until it is running.
7. Copy its instance ID and URL. The URL normally has this shape: `https://YOUR_INSTANCE_ID.agent37.app`.

If the dashboard exposes the budget when creating the instance, set the one-time credit/headroom to $1.00 and leave the monthly cap at $0 unless you intentionally want a recurring monthly allowance. If the dashboard does not expose these fields, use the API instructions below only after creating the instance and review the budget screen before allowing model calls.

### Optional: set the $1 one-time managed-services headroom with the API

Use a terminal on your own computer. Replace the placeholders locally; never paste your real key into chat or commit it to GitHub.

```bash
export AGENT37_API_KEY='YOUR_CLOUD_API_KEY'
export AGENT37_INSTANCE_ID='YOUR_INSTANCE_ID'

curl -sS -X PATCH "https://api.agent37.com/v1/instances/$AGENT37_INSTANCE_ID/budget" \
  -H "Authorization: Bearer $AGENT37_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"monthly_cap_micros":0}'

curl -sS -X POST "https://api.agent37.com/v1/instances/$AGENT37_INSTANCE_ID/budget/top-up" \
  -H "Authorization: Bearer $AGENT37_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"amount_micros":1000000,"idempotency_key":"neonverse-ai-work-initial-budget"}'
```

The API call adds a spending ceiling, not funds. Confirm the workspace wallet balance before doing this. The initial example creates only $1.00 of managed-service headroom. Monitor usage and do not raise the limit unless you intentionally want to spend more.

## 4. Understand the credit and compute costs

The Cloud API wallet pays for both instance compute/storage and managed services. The instance budget only caps managed services (such as model calls); it does not cap compute or disk. The default 2 vCPU / 4 GB instance has been listed around $4.76/month if it runs continuously, with disk charged while the instance exists. Auto-sleep reduces compute while idle, but disk may still be charged. Stop or delete instances you no longer need. Check the live price shown in your dashboard because rates can change.

Do not enable auto top-up. Do not add a card or purchase a plan to finish this setup. The $10 promotion is a finite wallet balance, not a promise of unlimited hosting.

## 5. Configure the NeonVerse Vercel backend

Open Vercel → your existing NeonVerse project → **Settings → Environment Variables**. Add these values for Production (and Preview if you will test preview deployments):

| Name | Value |
|---|---|
| `FIREBASE_PROJECT_ID` | The `projectId` from your existing `firebase-config.js` |
| `AGENT37_INSTANCE_URL` | `https://YOUR_INSTANCE_ID.agent37.app` (base URL only; no `/v1/responses`) |
| `AGENT37_API_KEY` | Your Cloud API key from Step 2 |

Save and redeploy. Never add `AGENT37_API_KEY` to HTML, `script.js`, `firebase-config.js`, or GitHub. Do not replace the existing Firebase web configuration with another project's values.

## 6. Publish Firestore rules

The updated `firestore.rules` contains the AI Work access protections. Publish it to the same Firebase project used by NeonVerse:

```bash
firebase login
firebase use YOUR_FIREBASE_PROJECT_ID
firebase deploy --only firestore:rules
```

Or paste the full updated `firestore.rules` into Firebase Console → Firestore Database → Rules → Publish. Review the rules against any custom rules you added after this ZIP was made; do not blindly overwrite newer project-specific security rules.

## 7. Give staff roles

For each authorised Warden, Faculty member and Administrator:

1. Firebase Console → Authentication → Users → copy the staff user's UID.
2. Firestore → collection `roles` → create a document whose document ID is exactly that UID.
3. Add string field `role` with one of: `warden`, `faculty`, `admin`.
4. Ensure `profiles/{uid}` contains a verified campus profile, including `universityKey`, `university`, and `membershipStatus: "verified"`.

Only the project owner/institution IT team should provision roles. Students must not be able to assign themselves staff roles.

## 8. Test AI Work safely

1. Sign in to NeonVerse as a Warden, Faculty member or Admin.
2. Open **AI Work** in the staff navigation.
3. Test in a test campus/database first with pending leave applications of 1, 3 and 4 calendar days, plus a non-leave application.
4. Enter: `Approve all pending leave applications that are not more than 3 calendar days. Leave longer requests for manual review.`
5. The proposal must include only eligible 1–3 day pending leave requests. Check every student and date.
6. Click **Confirm & execute** only after reviewing the list. Verify Firestore status, review history and the student's in-app notification.

The current release is intentionally limited: it can propose approval of pending leave requests of 1, 2 or 3 calendar days and read-only summaries. It does not execute arbitrary natural-language tasks, reject requests, publish notices, edit student profiles, or change roles. Agent37 proposes; NeonVerse validates and applies only the allow-listed action after staff confirmation.

## 9. Quick connection test

After setting Vercel variables and redeploying, open:

`https://YOUR-VERCEL-DOMAIN/api/agent37-chat`

A configuration response showing `configured: true` confirms that the environment variables exist; it does not prove the Agent37 key is valid. Then sign in and test a harmless read-only prompt in the existing NeonVerse AI chat, followed by AI Work using test leave records.

## Troubleshooting

- **AI Work not configured / HTTP 503:** one or more Vercel environment variables are missing. Save them and redeploy.
- **Agent37 401/403:** check that the key is a Cloud API key and that the instance URL/ID is correct.
- **Agent37 not completing:** check instance state, managed-service budget and Cloud API wallet balance.
- **Insufficient balance:** stop testing; do not add a card or top up automatically. Check the promo claim and billing page.
- **Staff-only access error:** verify `roles/{uid}.role`, and the signed-in user's verified `profiles/{uid}` campus data.
- **No pending applications:** verify the test records have `status: "pending"` and belong to the staff member's campus.

## Official references

- Hackyard credit claim: <https://www.agent37.com/redeem/HACKYARD>
- Cloud API billing: <https://www.agent37.com/dashboard/cloud/billing>
- Cloud API keys: <https://www.agent37.com/dashboard/cloud/api-keys>
- Cloud API instances: <https://www.agent37.com/dashboard/cloud/instances>
- Agent37 managed-services budgets: <https://www.agent37.com/docs/agents-api/budgets>
- Agent37 Cloud overview: <https://www.agent37.com/cloud>
