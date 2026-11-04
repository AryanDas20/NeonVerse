# Add Agent37 to NeonVerse — beginner setup

## Read this first: there are two different Agent37 products

Hackyard's message describes both **Agent37 Personal** (the free personal agent) and **Agent37 Cloud API** (an API key + metered cloud workspace). They are different routes.

- The Personal free plan is started at https://www.agent37.com/personal. Hackyard's founder says to use this exact page for the challenge, not the Cloud Sandbox/API page, and not to enter a card.
- The website connector in this ZIP uses Agent37's documented Agent API: `POST https://INSTANCE_ID.agent37.app/v1/responses`, authenticated by `X-Agent37-Key`. This is the API integration route. Agent37's public docs show a `sk_live_...` key in that header. An instance ID by itself is not enough to authenticate this API call.

**Do not create a Cloud API workspace, add a card, buy a plan, or top up just because this guide mentions the API.** If you are following Hackyard's Personal-free-plan instruction, ask a Hackyard host whether your Personal instance exposes the documented `/v1/responses` API and which credential is permitted for external website integration. Do not use the Cloud API page if the host told you not to. This ZIP keeps the widget disabled until valid server-side API settings exist.

## A. If you already have a Personal free agent (Hackyard route)

1. Open https://www.agent37.com/personal and sign in with the same Agent37 account used for Build 2026.
2. Open your free agent and let it finish starting.
3. Copy the **instance ID** from the dashboard. Keep it private enough that you do not post it with credentials.
4. For the Hackyard challenge, follow the submission instructions at https://hackyard.org/build2026/agent37 and submit the requested project details/screenshots.
5. Before connecting it to NeonVerse, ask a Hackyard host/Agent37 support this exact question: **“I have a Personal Free Agent37 instance. Can my Vercel-hosted website call its `/v1/responses` endpoint? If yes, where do I obtain the required `X-Agent37-Key` without creating a Cloud API workspace or adding a card?”**
6. If they confirm a supported endpoint/key, use that endpoint and key in the Vercel variables listed in section C. If they say Personal instances cannot be called externally, do not try to scrape the dashboard, iframe a private dashboard, disable authentication, or put credentials in browser code. You would need an approved API route or a different Agent37 plan/route.

## B. If Agent37/Hackyard explicitly authorises the Cloud API integration

Only do this if you choose the Cloud API route or a Hackyard host confirms it is permitted for your use case.

1. Follow the credit claim instructions only at https://www.agent37.com/redeem/HACKYARD, if the offer is available to your account. The claim message says no card is needed.
2. Check the balance at https://www.agent37.com/dashboard/cloud/billing.
3. Create an API key under the Cloud API **API keys** area. Copy it once and keep it secret. Do not send it to ChatGPT, put it in JavaScript/HTML, or commit it to GitHub.
4. Create one `agent37-hermes` instance. Check the estimated compute/disk price before creating it. The Cloud route bills compute/disk separately from model usage.
5. Agent37 managed model calls require a non-zero per-instance managed-services budget. A budget is a spending ceiling, not extra credit. The Hackyard example uses `credit_micros: 1000000` ($1.00 headroom); set only what you are prepared to spend. Do not top up or add a card if the no-card challenge instructions apply to your account.
6. Copy the instance ID. The standard instance base URL is `https://INSTANCE_ID.agent37.app` (no trailing slash). Confirm the URL and API key are allowed for the selected instance.
7. If managed model access is unavailable on your instance, follow the Agent37 dashboard's supported model/provider setup. Do not paste a model-provider key into NeonVerse frontend files.

## C. Configure NeonVerse on Vercel

The website code calls a same-origin Vercel Function at `/api/agent37-chat`. The API key never reaches the browser.

1. Open your Vercel dashboard and select the existing NeonVerse project.
2. Open **Settings → Environment Variables**.
3. Add these variables for **Production** (and Preview if you test previews):

   - `FIREBASE_PROJECT_ID` — the `projectId` value from your existing `firebase-config.js` / Firebase Project Settings.
   - `AGENT37_INSTANCE_URL` — `https://YOUR_INSTANCE_ID.agent37.app`; do not append `/v1/responses`.
   - `AGENT37_API_KEY` — the Agent37 key explicitly issued/authorised for the Agent API. Do not paste it into a chat or source file.

4. Save the variables and redeploy the Vercel project.
5. Do not replace the real `firebase-config.js` with the placeholder file in this project ZIP. Keep your existing Firebase Web App values.
6. Open `https://YOUR-VERCEL-DOMAIN/api/agent37-chat`. It should return JSON with `configured: true` once all three environment variables exist. This checks configuration only; it does not prove the Agent37 key or instance is valid.
7. Sign in to NeonVerse with a Firebase email-verified account. Open the **NeonVerse AI** button in the bottom-right corner and send “How do I submit a leave application?”

## D. What the integration can and cannot do

- Each Firebase user gets a separate Agent37 conversation session, derived on the server from their verified Firebase UID and browser conversation ID.
- The browser stores the visible recent transcript in that browser's local storage. It is not a cloud-synchronised chat history.
- The floating chat widget receives only the question, role label and campus name. The separate AI Work endpoint sends Agent37 only compact pending-application metadata (student display name, title/type, dates and status); it does not send registration IDs, phone numbers, email addresses, application reasons or supporting-document references.
- The floating chat widget is a **read-only guide**. The separate AI Work page is a restricted staff task planner. In this release it may propose only 1–3 calendar-day pending leave approvals, and a staff member must confirm before NeonVerse writes to Firestore.
- The floating chat endpoint has a best-effort per-instance rate limit and a 2,500-character message limit. AI Work separately limits each instruction to 1,600 characters and up to 100 pending campus applications per run. Use Agent37 usage/billing controls to monitor actual cost.
- If the instance sleeps, the first response may take longer. Agent37 and Vercel function timeout settings both affect the request.

## E. Use the new staff-only AI Work page

After the Agent37 API connection is confirmed and working:

1. Sign in with an authorised Warden, Faculty or University Administrator account. The account must have its role in `roles/{uid}` and a verified campus profile in `profiles/{uid}`.
2. Open the new **AI Work** entry in the left navigation. Students and College verifier accounts do not see this entry, and the backend rejects them even if they manually call the endpoint.
3. Try the prompt chip **Review leaves up to 3 days**, or write: `Approve all pending hostel leave applications that are not more than 3 calendar days. Leave longer requests for manual review.`
4. Agent37 reads compact metadata from up to 100 pending applications in your campus queue and returns a proposed plan. Student phone numbers, email addresses, application reasons and document references are not sent to Agent37.
5. Check every proposed student and date. Click **Confirm & execute** only when the list is correct. NeonVerse re-reads each application and independently enforces the 1–3 calendar-day limit before attempting the update.
6. Approved records receive a review-history entry and students receive the website's in-app application notification. Check the Applications page to confirm the result.

For this initial release, AI Work can only propose approval of pending leave applications with valid dates covering 1, 2 or 3 calendar dates (both the first and last dates count). It does not reject requests, publish notices, modify profiles/roles, or execute arbitrary instructions. Longer, invalid, non-leave and non-pending requests are never approved by this automation. The human confirmation is intentional because a leave decision is an official campus action.

## F. Troubleshooting

- `503 assistant has not been configured`: one or more of the three Vercel environment variables is missing. Add them and redeploy.
- `401 sign-in session could not be verified`: check `FIREBASE_PROJECT_ID`, make sure the user verified their Firebase email, and sign in again.
- `Agent37 rejected the configured key`: key is wrong, revoked, or not authorised for the selected instance.
- `Agent37 did not complete this reply`: check instance status, model/provider setup and available model access/credits.
- `AI Work is available only to authorised staff`: check that the current user's `roles/{uid}.role` is `warden`, `faculty` or `admin` and their own `profiles/{uid}` document has a campus key and `membershipStatus: "verified"`.
- `No pending campus applications`: open Applications and verify there are pending requests for the signed-in staff member's campus. The feature currently scans up to 100 queue entries per run.
- `Agent37 rejected the configured key` on AI Work: this route requires the same externally authorised Agent API endpoint/key as the assistant. An instance ID alone is not enough. Ask a Hackyard host to confirm support for the Personal Free agent before adding or paying for a different Agent37 product.
- `504` or timeout: check if the instance is asleep/starting and whether the Vercel project supports the configured function duration.

Official Agent37 API reference: https://www.agent37.com/docs/agents-api/chat
Agent37 managed budgets: https://www.agent37.com/docs/agents-api/budgets
Agent37 Personal: https://www.agent37.com/personal
