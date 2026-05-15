# Sentinel Review — Webhook Signing Mode + Production Docs

Date: 2026-05-15
Reviewer: Sentinel 🛡️
Scope: current working-tree batch covering explicit webhook signing mode migration/routes/resolver, production readiness checklist, production blockers, retention policy, receiver guide, pilot smoke runbook, behavioral roadmap, and marker tests.

## Verdict

**GO for controlled pilot continuation. NO-GO for broad production rollout remains.**

The batch addresses the prior ambiguity by making unsigned webhook delivery an explicit connector state (`webhook_signing_mode = 'unsigned_pilot'`) and requiring HMAC connectors to carry a server-owned `secret_ref`. It does **not** re-open client-provided secret acceptance, and the documentation accurately frames current readiness as pilot-only with production blockers still open.

## Checks Performed

- Reviewed changed implementation files:
  - `src/frontend/lib/actionbridge/webhook-signing.ts`
  - `src/frontend/app/api/actionbridge/connectors/route.ts`
  - `src/frontend/app/api/actionbridge/execute/route.ts`
  - `supabase/migrations/20260515234500_actionbridge_webhook_signing_mode.sql`
- Reviewed relevant docs:
  - `docs/specs/actionbridge-webhook-v1-adapter.md`
  - `docs/production-readiness-checklist.md`
  - `docs/sentinel-production-blockers.md`
  - `docs/error-log-retention-policy.md`
  - `docs/webhook-signature-receiver-guide.md`
  - `docs/pilot-smoke-test-runbook.md`
  - `docs/behavioral-test-roadmap.md`
- Ran verification:
  - `node scripts/test-actionbridge-contracts.mjs`
  - `node scripts/test-actionbridge-security-gauntlet.mjs`
  - Result: both passed.

## Security Findings

### Positive Controls Confirmed

- **Explicit unsigned mode:** connector creation now persists `webhook_signing_mode: 'unsigned_pilot'` instead of relying on missing `secret_ref` as an implicit unsigned signal.
- **HMAC requires server-owned ref:** migration adds `actionbridge_connectors_webhook_signing_ref_required` requiring `secret_ref IS NOT NULL` when `webhook_signing_mode = 'hmac_sha256'`.
- **Fail-closed HMAC resolver:** `resolveActionBridgeWebhookSigningSecret()` returns `ok: false` for `hmac_sha256` without a valid/resolvable secret ref, blocking delivery before network execution.
- **No new client-secret acceptance:** connector POST still rejects `secretRef`, `secret_ref`, `secretValue`, and `secret_value`; server persists `secret_ref: null` for user-created connectors.
- **No raw secret leaks observed:** resolver returns only digest/summary metadata, not raw secret refs or secret values. Existing checks also fail on `console.log`/raw `secretValue` markers.
- **Route exposure is safe:** connector GET/POST exposes `webhookSigningMode`, but not `secret_ref` or signing secrets.
- **Docs distinguish pilot vs production:** production checklist/blockers retain unresolved production items: distributed rate limits, durable quarantine/pause, behavioral tests, real secret manager/rotation, GDPR/data-processing gates.

### Residual Risks / Production Blockers

No new Critical/High blocker was introduced by this batch, but existing production blockers remain:

1. **Unsigned pilot mode is still permitted.** Acceptable only under controlled pilot authorization and compensating controls. Must not be treated as production-safe default.
2. **Secret manager/rotation remains incomplete.** Env-backed resolution is acceptable for pilot bootstrap, not a complete production secret lifecycle.
3. **DB constraint checks presence, not secret-ref format.** Invalid refs fail closed in resolver, which is safe, but production hardening should add a DB format check or controlled admin-only write path for `secret_ref`.
4. **Marker tests are not enough for production.** Behavioral tests listed in the roadmap remain required before broad rollout.

## Compliance Notes

- GDPR posture remains pilot-bounded: docs require redacted/bounded logs and avoid raw payload/secret retention.
- Receiver guide correctly instructs customers/operators not to place shared secrets in clients, agents, logs, browser pages, or support chats.
- Production rollout still requires formal Sentinel sign-off after the unchecked readiness items are implemented or explicitly accepted by Elvis/Ricky.

## Final Decision

**Sentinel decision: GO for controlled pilot continuation; NO-GO for production/broad rollout.**

This batch is security-positive and closes the signing-mode ambiguity without weakening secret handling. Keep the production blockers visible and do not market or integrate this path as production-ready until the remaining gates are verified.
