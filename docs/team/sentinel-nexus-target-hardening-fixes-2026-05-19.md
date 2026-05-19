# ActionBridge Target Hardening Fix Log — 2026-05-19

Context: Nexus and Sentinel reviewed the multi-target registry/API/UI/live-check work and returned NO-GO findings around tenant membership, status spoofing, SSRF/TOCTOU, response bounding, stored URL revalidation, and theme token sanitization.

## Fixed

- Added `actionbridge_tenant_memberships` with tenant membership RLS.
- Backfilled membership rows from existing `actionbridge_targets` owners.
- Replaced owner-only target visibility with tenant membership checks.
- Added API-level `requireTenantMembership` for GET/POST/PUT.
- Added safe bootstrap only for empty new tenants via service client; existing tenants require membership.
- Disabled manual browser PATCH status spoofing with `ACTIONBRIDGE_MANUAL_TARGET_STATUS_DISABLED`.
- Removed operator UI buttons that manually marked targets as connected/missing/unverified.
- Replaced live-check `fetch(target.url)` with pinned `https.request` using the validated DNS IP while preserving Host/SNI.
- Added stream byte cap at 250KB and abort on overflow; no `response.text()` on untrusted targets.
- Added stored target URL revalidation before live network execution.
- Kept redirects blocked.
- Sanitized theme token echo server-side.
- Updated contract and multi-target tests for the new guardrails.

## Verification

```bash
npm run test:multi-target-registry
npm run test:contracts
npm test
git diff --check
```

Result: PASS.

## Remaining production caveats

- Production distributed rate limiter is still a broader ActionBridge blocker.
- Target status transition audit should be deepened before broad production rollout.
- Schwarzwald-Agent integration should use server-side proxy and derive tenant from authenticated workspace/session, never from browser input.
