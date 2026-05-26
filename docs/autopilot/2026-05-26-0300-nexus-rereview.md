# Nexus Re-review — Webhook Secret Resolver Fix Slice

Date: 2026-05-26 03:00 Europe/Berlin

## Decision

GO for commit/push of this slice.

## Findings

- Rotation route now imports `resolveActionBridgeWebhookSigningSecretAsync as resolveActionBridgeWebhookSigningSecret` and awaits it before the secret-dependent update path.
- Execute route also uses the async resolver after durable quarantine lookup/active-quarantine branches and before webhook delivery.
- Google Secret Manager mapping is provider-safe and digest-only: `actionbridge-webhook-signing-<32 hex sha256 prefix>`. Raw operator labels/refs are not used as provider secret IDs.
- Result summaries expose digest/audit metadata only (`provider`, `accessAudit`, `secretRefDigest`, optional `versionResourceDigest`, HTTP status on failure). No raw secret, token, env name, or raw ref found in the new summaries.
- Production-required mode disables pilot env fallback. Sync compatibility path fails closed for managed provider with `secret_manager_async_required`.
- Docs accurately describe current state as a managed resolver primitive, not full production readiness. Remaining production blockers are still called out: provisioning, least-privilege service identity/token issuance, operator UI controls, rotation automation/release review.

## Verification run

- `npm run test:behavioral-security` — pass
- `npm run test:contracts` — pass
- `npm run test:security` — pass
- `npm run typecheck` — pass
- `npm run lint >/tmp/nexus-lint.log && git diff --check && echo VERIFY_OK` — pass (`VERIFY_OK`)

## Blockers

None.

## Notes / follow-up

Tests cover caller async usage, production pilot-env fallback denial, sync managed-provider fail-closed behavior, and provider-safe digest ID shape. They do not perform a live Google Secret Manager access test; that is acceptable for this slice because docs keep production rollout blocked pending managed environment provisioning and Sentinel release review.
