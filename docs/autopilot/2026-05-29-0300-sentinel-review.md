# Sentinel Review — ActionBridge Autopilot Slice 2026-05-29 03:00

**Scope:** Operator setup-link UX now uses a new `src/frontend/app/actionbridge/operator/ActionBridgeSetupLinksClient.tsx`; `operator/page.tsx` imports it; demo/userflow tests and `docs/production-readiness-checklist.md` were updated.

**Reviewer:** Sentinel (security subagent)
**Date:** 2026-05-29

---

## 1. Verdict

**GO**

This slice is safe to commit for controlled-pilot continuation. No High/Critical blockers.

---

## 2. Findings by Severity

### 🔴 Critical — None

### 🟡 Medium — None

### 🟢 Informational / Minor

1. **Token prefix leak in maskToken.** The `maskToken()` helper reveals the token prefix format (`absl_`) and first 10 chars in the UI. This is acceptable because:
   - The token itself is a one-time, short-lived setup token (not a long-lived secret).
   - The full token is never rendered in list views, logs, tests, docs, or SSR output.
   - The prefix does not expose tenant, owner, or cryptographic material.
   - The risk is informational only; no actionable exploit path.

2. **Setup-link API rate-limit guardrail added after review request.** Breaker added shared `setupLinks` policy enforcement plus success rate-limit headers on `GET/POST /api/actionbridge/setup-links` after this review was requested. This strengthens token-adjacent abuse control and preserves the existing authenticated, owner-scoped JSON contract.

3. **Static shell fully replaced.** The previous read-only demo input (`https://demo-customer.example`) and disabled "JSON API next" button are removed. No fake/mock product data remains.

---

## 3. Evidence

### Files Changed (uncommitted)

| File | Change |
|------|--------|
| `src/frontend/app/actionbridge/operator/ActionBridgeSetupLinksClient.tsx` | **New** — Live client component consuming `GET/POST /api/actionbridge/setup-links` |
| `src/frontend/app/actionbridge/operator/page.tsx` | Replaced static shell with `<ActionBridgeSetupLinksClient />` import/render |
| `scripts/test-actionbridge-demo-flow.mjs` | Added assertions that operator setup-link UX calls real JSON API, handles shown-once token, and rejects static shell markers |
| `scripts/test-actionbridge-userflow-smoke.mjs` | Updated `/actionbridge/operator` route expectation from generic "setup" to "Live setup link generator" |
| `docs/production-readiness-checklist.md` | Checked off "Operator setup-link UX consumes the real setup-links API" under Gate 6 and documented setup-link create/list rate-limit coverage under Gate 3 |
| `src/frontend/app/api/actionbridge/setup-links/route.ts` | Follow-up guardrail — shared `setupLinks` rate-limit enforcement and success headers for create/list |
| `src/frontend/lib/actionbridge/rate-limit.ts` | Follow-up guardrail — `setupLinks` policy added to default policies |
| `scripts/test-actionbridge-security-gauntlet.mjs` | Follow-up guardrail — static contract now asserts setup-link route rate-limit marker and headers |

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

- It is a **pure frontend UX replacement** (static shell → live API consumer) with **no new backend surface area**.
- The **owner-scoped API boundary is preserved**; the UI does not bypass server validation.
- The **raw setup token appears only in the creation response UI** and is not stored in docs, logs, tests, or static SSR output.
- **No token digest, service role, secret refs, idempotency keys, raw secrets, localStorage, cookies, or hidden mock data** leak through the UI, tests, or docs.
- **No unsafe external or destructive action** is introduced.
- **Token-adjacent create/list calls now have shared rate-limit enforcement** and redacted success/denial headers.
- The **production NO-GO/controlled-pilot constraints remain accurate**; no new rollout blockers are added.

---

*Review completed by Sentinel subagent.*
