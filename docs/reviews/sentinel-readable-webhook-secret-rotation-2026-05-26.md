# Sentinel Review — Readable Webhook Secret Rotation UI

**Date:** 2026-05-26 10:03 CEST  
**Scope:** Uncommitted readable/operator UI changes around webhook signing secret rotation:
- `src/frontend/app/actionbridge/connectors/ActionBridgeConnectorsClient.tsx`
- `src/frontend/app/api/actionbridge/connectors/route.ts`
- Existing rotation backend: `src/frontend/app/api/actionbridge/ops/webhook-secret-rotation/route.ts`

## Verdict

**GO for controlled pilot.** No Critical/High release blockers found in this readable UI slice.

The implementation keeps raw webhook signing secrets out of the browser. The connectors API returns only `webhookSecretRefDigest`; the UI posts only a server-owned `nextSecretRef`, the current digest precondition, and dry-run/apply intent. The rotation route still authenticates the owner, resolves the target ref server-side before apply, defaults to dry-run, requires the explicit confirmation header, uses stale-digest protection, and audits redacted rotation outcomes.

## Findings

### Medium — Secret-ref digest is now customer/browser-visible

**Evidence:** `src/frontend/app/api/actionbridge/connectors/route.ts` selects `secret_ref` and serializes `webhookSecretRefDigest`; the UI renders `Current ref digest`.

This is not a raw secret leak, but if refs are human-readable/predictable, an attacker with browser/session access can use the truncated unsalted digest as a small offline oracle for guessed ref labels.

**Recommendation:** For production, prefer an opaque server-generated rotation version/ETag over a hash of the ref, or compute an HMAC digest with a server-only salt/key. Keep current digest acceptable only for pilot if refs remain non-sensitive and server-owned.

### Low — Apply confirmation is UX-level, not step-up approval

**Evidence:** UI checkbox adds `x-actionbridge-rotation-confirm: apply-webhook-signing-ref`; backend accepts that header from the authenticated owner.

This is adequate for owner-scoped pilot rotation, but production write controls should require operator/admin permission or step-up confirmation for signing changes that can break delivery trust.

**Recommendation:** Before production, gate apply behind explicit operator role/approval policy and keep dry-run available to normal owners.

## Controls verified

- Authentication required before connector lookup.
- Connector lookup is owner-scoped by `user_id` + `id`.
- Raw `secret_ref` is not returned; only a truncated digest is serialized.
- Raw signing secret is never sent to client.
- Rotation route validates ref format and fails closed if resolver cannot access the target secret.
- Dry-run default is preserved.
- Apply requires explicit confirmation header.
- Stale-current protection remains present when `expectedCurrentDigest` is supplied.
- Audit records use redacted request/result summaries.

## GDPR / data protection

No personal data expansion observed. Main data-protection concern is operational metadata exposure (`secret_ref` digest), not customer PII.
