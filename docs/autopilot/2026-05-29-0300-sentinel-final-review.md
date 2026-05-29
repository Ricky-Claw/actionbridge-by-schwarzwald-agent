# Sentinel Final Review — ActionBridge Autopilot Slice 2026-05-29 03:00

**Scope:** Operator setup-link UX (`ActionBridgeSetupLinksClient.tsx`), `operator/page.tsx` integration, `GET/POST /api/actionbridge/setup-links` rate-limit enforcement, `setupLinks` policy in `rate-limit.ts`, demo/userflow/security test updates, and production checklist.

**Reviewer:** Sentinel (security subagent)
**Date:** 2026-05-29

---

## 1. Verdict

**GO**

This slice is safe to commit for controlled-pilot continuation. No High/Critical blockers remain.

---

## 2. Findings by Severity

### 🔴 Critical — None

### 🟡 Medium — None

### 🟢 Informational / Minor

1. **Token prefix leak in `maskToken()`.** The helper reveals the token prefix format (`absl_`) and first 10 chars in the UI. This is acceptable because:
   - The token is a one-time, short-lived setup token (not a long-lived secret).
   - The full token is never rendered in list views, logs, tests, docs, or SSR output.
   - The prefix does not expose tenant, owner, or cryptographic material.
   - The risk is informational only; no actionable exploit path.

2. **Rate-limit policy is pilot-process-local.** The `setupLinks` policy uses `scope: 'pilot_process_local'` with a 60-second / 20-request window. This is correct for controlled pilot but must be upgraded to `production_distributed_required` before broad rollout (already tracked in production-readiness checklist and `sentinel-production-blockers.md`).

---

## 3. Evidence

### Files Changed (uncommitted)

| File | Change |
|------|--------|
| `src/frontend/app/actionbridge/operator/ActionBridgeSetupLinksClient.tsx` | **New** — Live client component consuming `GET/POST /api/actionbridge/setup-links` |
| `src/frontend/app/actionbridge/operator/page.tsx` | Replaced static shell with `<ActionBridgeSetupLinksClient />` import/render |
| `src/frontend/app/api/actionbridge/setup-links/route.ts` | Added shared `setupLinks` rate-limit enforcement and success/denial headers for create/list |
| `src/frontend/lib/actionbridge/rate-limit.ts` | Added `setupLinks` policy to `DEFAULT_POLICIES` |
| `scripts/test-actionbridge-demo-flow.mjs` | Added assertions that operator setup-link UX calls real JSON API, handles shown-once token, and rejects static shell markers |
| `scripts/test-actionbridge-userflow-smoke.mjs` | Updated `/actionbridge/operator` route expectation from generic "setup" to "Live setup link generator" |
| `scripts/test-actionbridge-security-gauntlet.mjs` | Added `setupLinks` rate-limit marker and setup-link route rate-limit/header assertions |
| `docs/production-readiness-checklist.md` | Checked off "Operator setup-link UX consumes the real setup-links API" under Gate 6 and documented setup-link create/list rate-limit coverage under Gate 3 |

### Auth / Data / Token Safety

- **Authentication:** Both `GET` and `POST` to `/api/actionbridge/setup-links` go through `requireActionBridgeUser()` (Supabase auth session check). Unauthenticated requests return 401.
- **Owner scoping:** `GET` filters `.eq('user_id', user!.id)` and `POST` validates `connectorId` ownership via `.eq('user_id', user!.id)` before creation. No cross-owner access.
- **Token shown-once:** The `POST` 201 response returns `token` and `url` exactly once. The `GET` list response selects columns explicitly excluding `token` and `token_digest`. The UI list type `SetupLinkView` has no `token` field.
- **No token persistence in UI:** The raw `token` is held only in React component state (`createdSetupLink`) and is cleared before refresh/new creation. It is never written to `localStorage`, `sessionStorage`, `document.cookie`, or `indexedDB`.
- **No token in logs/tests/docs/static output:** Verified by `grep` across the operator directory and by the demo-flow test script, which scans all MVP UI pages for forbidden markers.

### Forbidden Marker Scan Results

| Marker | Location | Result |
|--------|----------|--------|
| `token_digest` | UI source (`ActionBridgeSetupLinksClient.tsx`, `page.tsx`) | **Absent** |
| `service_role` | UI source | **Absent** |
| `secret_ref` | UI source | **Absent** |
| `idempotency_key` | UI source | **Absent** |
| `localStorage` | UI source | **Absent** |
| `document.cookie` | UI source | **Absent** |
| `sessionStorage` | UI source | **Absent** |
| `indexedDB` | UI source | **Absent** |
| `readOnly` | UI source | **Absent** |
| `https://demo-customer.example` | UI source | **Absent** |
| `JSON API next` | UI source | **Absent** |

Note: `secret_ref` appears in `ActionBridgeWebhookSecretRotationClient.tsx` (pre-existing, not in this slice) as a user-editable input placeholder for the server-owned secret ref string. This is expected and acceptable — the UI never displays resolved secrets or raw refs from the server, only digests.

### API Boundary Validation

- **Connector ID validation:** `UUID_PATTERN` enforces UUID format before database lookup.
- **Connector ownership check:** `POST` verifies the connector exists and belongs to the authenticated user before linking.
- **Target origin validation:** `createActionBridgeSetupLinkDraft()` validates origin shape server-side (HTTPS, no localhost/internal hosts, no credentials/path/query).
- **No SSR leakage:** `page.tsx` is `force-dynamic` and renders only the client component import. No setup link data is fetched or rendered at SSR time.

### Rate-Limit Enforcement Safety

- **Shared policy:** `setupLinks` policy is applied to both `GET` (list) and `POST` (create) with discriminators `${user.id}|list` and `${user.id}|create`, preventing one verb from starving the other.
- **Redacted headers:** Success responses include `X-ActionBridge-RateLimit-Policy`, `X-ActionBridge-RateLimit-Remaining`, `X-ActionBridge-RateLimit-Reset`, and `X-ActionBridge-RateLimit-Mode`. No raw user IDs, IP addresses, or tokens leak in headers.
- **Fail-closed denial:** `enforceActionBridgeRateLimitAsync` returns a 429/503 with `Retry-After` when the limit is exceeded; auth is still required before rate-limit evaluation, so the rate limiter does not weaken authentication.
- **No weakening of auth:** Rate-limit checks occur *after* `requireActionBridgeUser()`. Unauthenticated requests are rejected with 401 before rate-limit logic runs.

### Production NO-GO / Controlled-Pilot Constraints

- The checklist item under **Gate 6 — Product Boundary** is now checked: "Operator setup-link UX consumes the real setup-links API."
- All remaining unchecked items are pre-existing and unrelated to this slice:
  - Gate 2: "Real secret manager/KMS integration for production" — still blocked on environment provisioning and Sentinel release review.
- No new NO-GO constraints introduced.

---

## 4. Required Fixes

None.

---

## 5. Controlled-Pilot Safety Statement

This slice has **no High/Critical blocker** for controlled-pilot commit because:

- It is a **pure frontend UX replacement** (static shell → live API consumer) with **no new backend surface area** beyond the existing setup-links route.
- The **owner-scoped API boundary is preserved**; the UI does not bypass server validation.
- The **raw setup token appears only in the creation response UI** and is not stored in docs, logs, tests, or static SSR output.
- **No token digest, service role, secret refs, idempotency keys, raw secrets, localStorage, cookies, or hidden mock data** leak through the UI, tests, or docs.
- **No unsafe external or destructive action** is introduced.
- **Token-adjacent create/list calls now have shared rate-limit enforcement** and redacted success/denial headers.
- The **production NO-GO/controlled-pilot constraints remain accurate**; no new rollout blockers are added.

---

*Review completed by Sentinel subagent.*
