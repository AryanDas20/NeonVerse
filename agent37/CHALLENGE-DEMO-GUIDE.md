# Agent37 hackathon demo guide

This guide describes how to demonstrate the Agent37 Evaluation Dashboard and the Agent37 Safety & Reliability Center using the records and permissions in this NeonVerse release.

## Before the demo

1. Deploy the merged `firestore.rules` and `firestore.indexes.json` to the Firebase project. Review the rules against any project-specific changes before publishing.
2. Deploy the frontend assets and the existing `api/agent37-work.js` Vercel function together. Do not expose `AGENT37_API_KEY` in browser code.
3. Confirm the existing Vercel environment variables are configured: `FIREBASE_PROJECT_ID`, `AGENT37_INSTANCE_URL` and `AGENT37_API_KEY`.
4. Sign in with an email-verified account whose authoritative `roles/{uid}.role` is `admin` and whose campus profile is complete and verified.
5. Open **Agent37 Control → Safety & reliability** and check that the live data sources load without Firestore permission or index errors.

## Recommended judge walkthrough

1. Open **Agent37 Evaluation Dashboard**. Explain that the dashboard starts with an empty state rather than fabricated scores.
2. Run all five safe probes. The identity and immutable-role probes use Firebase reads / a denied same-value role-write attempt. The remaining probes call the existing `/api/agent37-work` route to check unauthenticated rejection, allow-list handling for a role-escalation request, and campus filtering of a synthetic foreign-campus record.
3. Show the test result table, timestamp, measured browser elapsed time, and the pass / fail / blocked chart. Explain that a blocked result means the test did not reach an evaluable policy outcome; it is not silently counted as a pass.
4. Open **Agent37 Safety & Reliability Center**. Demonstrate the live application / campus-transfer approval queue, your own Agent37 task history, moderation state, policy probe results, audit filters and observed failure records.
5. Demonstrate an ordinary campus workflow using a dedicated test account and test data. Do not use the policy tester to approve, reject, restrict or otherwise mutate real student data.

## Metric definitions

- **Task success rate** = successful Agent37 task-history records (`completed`, `success` or `succeeded`) divided by task-history records with an explicitly recognised outcome (`completed`, `success`, `succeeded`, `partial`, `blocked` or `failed`). Records with no recorded status are excluded rather than assumed successful. Only the signed-in administrator's own history is available under the existing Firestore security rules.
- **Task outcome chart** = successful, failed and blocked/partial counts from those same real Agent37 task-history records. It does not graph policy-probe results as task executions.
- **Average task execution time** = mean `executionTimeMs` for that administrator's task-history records that contain a measured duration. Historical records without duration are excluded.
- **Policy compliance rate** = passed policy probes divided by passed plus failed policy probes. Blocked probes are excluded because they did not produce a policy decision.
- **Tests executed / passed / failed / blocked** = counts from persisted `agent37EvaluationRuns` documents for the current campus (newest 200 records on the evaluation page).
- **Human approval accuracy** is deliberately displayed as **Not measured**. Current workflow records contain the decision made, but there is no independent ground-truth label that says whether the decision was correct. Do not present approval volume or approval rate as accuracy.

## Probe safety

The probe runner never calls `executeAiWorkPlan()` and never executes an action proposed by Agent37. The role immutability probe attempts to write the same role value to the signed-in administrator's own `roles/{uid}` document and passes only when Firestore returns `permission-denied`; it does not request a different role. The two authenticated Agent37 probes consume the existing AI Work endpoint's rate limit and may use Agent37 API quota. Run them only during the demo when the service is configured.

## Honest telemetry boundaries

- The current release has no central allow/deny policy-event stream, so monitor totals are workflow-derived indicators, not a complete security event feed.
- The current rules permit an account to read its own `aiWorkHistory`; the dashboard does not bypass that boundary to read other administrators' private task histories.
- The audit explorer combines existing application history entries, transfer review state, the signed-in administrator's own task history, evaluation records and latest moderation records. It is not a replacement for a central immutable audit-log service.
- Recovery / retry-chain telemetry is not present in the source backend and is shown as not instrumented.
- Human approval accuracy needs independent review labels before it can be calculated responsibly.

## Deployment files changed

- `script.js` — admin navigation, dashboard views, safe probes, task timing and audit filters.
- `style.css` — responsive dashboard styling consistent with NeonVerse.
- `firestore.rules` — campus-admin-only, append-only rules for evaluation test records.
- `firestore.indexes.json` — composite indexes for campus evaluation queries and actor/campus AI task history queries.

No new Vercel API route, browser-side Agent37 secret, role mutation endpoint or approval engine is introduced.
