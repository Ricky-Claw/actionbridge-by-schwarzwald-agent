# Sentinel Review — ActionBridge Secret Manager Production-Readiness Preflight

Date: 2026-05-27 23:00 Europe/Berlin
Scope: uncommitted patch touching `src/frontend/lib/actionbridge/webhook-signing.ts`, `scripts/test-actionbridge-behavioral-security.mjs`, `docs/production-readiness-checklist.md`, and `docs/sentinel-production-blockers.md`.

## Decision

**Patch gate: GO for controlled pilot / continued hardening.**

**Production rollout gate: NO-GO remains.** This patch adds a useful redacted environment preflight, but it does not close the production KMS/secret-manager blocker because live managed-secret provisioning, least-privilege identity/token issuance, access audit evidence, and final Sentinel release review remain outstanding.

## Findings

### Critical
- None found in this patch.

### High
- None found in this patch.

### Medium
- **M-01 — Preflight `ok` is configuration-shape only, not proof of production readiness.**
  - Evidence: `checkActionBridgeSecretManagerProductionReadiness()` returns `ok: true` when provider, required flag, project id, and access-token presence are set (`src/frontend/lib/actionbridge/webhook-signing.ts:50-78`). It does not perform a live Secret Manager access check or verify least-privilege IAM scope.
  - Impact: Safe as currently documented/tested as a redacted preflight, but unsafe if later used as a standalone release gate or production-ready claim.
  - Required control: Keep docs/status language explicit that this is environment preflight only. Before production sign-off, require a live managed-secret access proof using the production service identity, negative tests for denied refs, and redacted audit evidence.

### Low
- None.

## Security Control Review

- **Secret leakage:** Pass. The new result summary exposes booleans only for project/token presence and the behavioral test checks the sample token is not present in the summary (`scripts/test-actionbridge-behavioral-security.mjs:159-168`). Existing resolver summaries remain digest-only for refs and provider version resources.
- **Raw env/token/ref exposure:** Pass. Missing entries are env-var names/config expectations, not values. No token/project value is returned by the preflight summary (`src/frontend/lib/actionbridge/webhook-signing.ts:71-77`).
- **Fail-closed behavior:** Pass. Production/required managed-secret mode continues to block pilot env lookup (`src/frontend/lib/actionbridge/webhook-signing.ts:171-172`, `202`) and managed-provider sync resolution remains blocked with `secret_manager_async_required` (`src/frontend/lib/actionbridge/webhook-signing.ts:195-196`).
- **Production-mode bypass:** No new bypass found. The patch does not weaken `providerRequired()`, and docs keep the real secret-manager/KMS gate unchecked.
- **False production-ready claims:** Pass with caveat M-01. Both production docs still mark the production secret-manager/KMS gate unchecked and explicitly state production rollout remains blocked.

## Verification

Executed:

```bash
node scripts/test-actionbridge-behavioral-security.mjs
```

Result: pass. Relevant new checks cover pilot env failing production readiness, managed provider without token failing, configured managed env passing local preflight shape, and token non-disclosure in result summary.

## Required Before Production GO

1. Provision Google Secret Manager resources in the target production environment.
2. Use least-privilege service identity/token issuance; avoid long-lived static bearer tokens where possible.
3. Produce redacted live access-audit evidence for successful latest-version access and denied unauthorized refs.
4. Confirm no raw secret, secret ref, access token, project id, or resource name leaks into DB, logs, UI, agent/tool output, or browser traces.
5. Final Sentinel release review after provisioning evidence is available.
