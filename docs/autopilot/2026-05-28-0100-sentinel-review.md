# Sentinel Review — ActionBridge Secret Manager Live Probe

**Date:** 2026-05-28 01:00 CEST  
**Scope:**
- `src/frontend/lib/actionbridge/webhook-signing.ts`
- `scripts/test-actionbridge-behavioral-security.mjs`
- `docs/production-readiness-checklist.md`
- `docs/sentinel-production-blockers.md`

## Verdict

**GO for controlled pilot continuation.**

**NO-GO for broad production rollout remains in force** until the existing Secret Manager/KMS production blocker is fully closed with real environment provisioning, least-privilege service identity/token issuance, live Secret Manager evidence, and final Sentinel release review.

## Critical / High Findings

None introduced in this scoped diff.

## Security Assessment

The new live-access probe is server-only, fail-closed, and redaction-aware:

- `probeActionBridgeSecretManagerLiveAccess()` first runs production-readiness preflight and validates the server-owned `secretRef`; incomplete preflight or invalid refs return `ok: false` before provider access (`webhook-signing.ts:88-107`).
- Google Secret Manager access uses a digest-only secret id derived from the secret ref, a bounded 3000ms timeout, `cache: 'no-store'`, and never places the bearer token in result summaries (`webhook-signing.ts:131-159`).
- Successful payload access returns the secret only to the resolver path; probe/result summaries include `accessAudit`, `secretRefDigest`, and a digest of the provider version resource name, not raw secret, raw ref, token, or raw provider resource (`webhook-signing.ts:109-127`, `webhook-signing.ts:161-170`).
- Provider denial/unavailability and provider exceptions fail closed with `ok: false` and redacted summaries.

## Behavioral Proof Reviewed

`node scripts/test-actionbridge-behavioral-security.mjs` passes.

Relevant new coverage:

- Mocked live access succeeds without leaking the access token or raw provider resource name (`test-actionbridge-behavioral-security.mjs:204-226`).
- IAM/provider denial fails closed with status/audit metadata only (`test-actionbridge-behavioral-security.mjs:229-236`).
- Incomplete preflight blocks before provider call (`test-actionbridge-behavioral-security.mjs:238-241`).

## Documentation / Blocker State

Docs correctly keep production blocked:

- `docs/production-readiness-checklist.md:25` remains unchecked for real Secret Manager/KMS integration and now explicitly requires real provisioning, least-privilege token issuance, live evidence, and Sentinel review.
- `docs/sentinel-production-blockers.md:42` remains unchecked and explicitly treats the current live-access proof as mocked behavioral coverage, not production closure.

## Residual Requirements Before Production

- Provision real managed secret environment.
- Use least-privilege service identity/token issuance; avoid long-lived operator tokens where possible.
- Capture live Secret Manager evidence using the probe without exposing secrets/tokens/resource names.
- Final Sentinel production release review.
