# Sentinel Review — Webhook-v1 Pilot Throttling, Failure Quarantine, and Success Rate-Limit Headers

**Date:** 2026-05-15  
**Reviewer:** Sentinel 🛡️  
**Scope:** `rate-limit.ts`, setup-session, bridge handshake, connector verification, execute route, contract/security tests.

## Verdict

**GO for controlled Webhook-v1 pilot defense-in-depth throttling.**  
**NO-GO for production-grade distributed abuse control or production quarantine enforcement.**

The implementation keeps the limiter clearly labeled as `pilot_process_local`, adds Webhook-v1 delivery/failure dimensions without exposing raw limiter keys, and adds safe success rate-limit headers to the public/token-adjacent setup, bridge handshake, and verification routes.

## Findings

### Pass — Pilot-only status remains explicit

- `ACTIONBRIDGE_RATE_LIMIT_MODE = 'pilot_process_local'` remains exported.
- All current policies, including `webhookDelivery` and `webhookFailureQuarantine`, are scoped as `pilot_process_local`.
- `ACTIONBRIDGE_PRODUCTION_RATE_LIMIT_REQUIREMENTS` still lists distributed counters, trusted proxy policy, per-tenant/per-connector dimensions, success/denial headers, and redacted telemetry.
- `docs/specs/actionbridge-production-rate-limits.md` still states the current limiter is not a production distributed abuse-control boundary.

### Pass — Webhook delivery throttle is redacted enough for pilot

- Webhook delivery throttle keys are derived from client key plus tenant, connector, action, and destination origin, then exposed only as `keyDigest`.
- Responses do not return raw IP, raw `x-forwarded-for`, raw `x-real-ip`, raw user-agent, connector base URL, token, or idempotency key.
- The rate-limited webhook result exposes only policy name, key digest, reset time, and retry-after.

### Pass — Failure quarantine result is audit/response safe

- Failure quarantine metadata is limited to:
  - `policy: webhookFailureQuarantine`
  - `status: recorded | quarantine_required`
  - `keyDigest`
  - `resetAt`
- No raw webhook URL, IP, user-agent, token, idempotency key, or connector secret is returned in quarantine metadata.
- Failed webhook delivery still fails closed by setting final execution status to `failed` and returning failure status.

### Pass — Success rate-limit headers do not leak raw keys

Success headers added to setup session, bridge handshake, and connector verification include only:

- `X-ActionBridge-RateLimit-Policy`
- `X-ActionBridge-RateLimit-Remaining`
- `X-ActionBridge-RateLimit-Reset`
- `X-ActionBridge-RateLimit-Mode`

These do **not** expose raw IP, token, user-agent, connector ID, base URL, or key digest.

### Medium — Quarantine is still a pilot signal, not an enforcement quarantine

`recordActionBridgeWebhookFailureQuarantine()` currently increments a process-local bucket and annotates the result. It does not persist quarantine state, pause the connector, block future attempts across workers, alert operators, or create a durable manual-review gate.

**Impact:** acceptable for pilot visibility/fail-closed signaling, but unsafe to describe as production quarantine.

**Required before production:** distributed/durable quarantine state keyed by tenant + connector + action + destination origin, persistent audit event, operator/customer-visible review state, and a kill-switch/pause action for repeated failures.

### Medium — Process-local and client-header-derived keys remain bypassable in production

The limiter still keys on `x-forwarded-for` / `x-real-ip` plus user-agent unless infrastructure sanitizes those headers. This is already documented as a production blocker.

**Required before production:** trusted proxy enforcement, canonical client identity source, distributed atomic counter store, and cross-instance/concurrency tests.

## Verification

Ran:

```bash
node scripts/test-actionbridge-contracts.mjs && node scripts/test-actionbridge-security-gauntlet.mjs
```

Result: passed.

## Production blockers that remain explicit

- Distributed atomic rate-limit store not implemented.
- Trusted proxy/header spoofing controls not implemented in app code.
- Webhook failure quarantine is not durable enforcement.
- Production telemetry/audit redaction needs behavioral tests proving no raw IP/token/user-agent/idempotency key leakage.
- Cross-worker/restart/deploy bypass tests are still required.

## Final security decision

**Pilot:** GO, under controlled Webhook-v1 pilot constraints and existing ActionBridge authorization/audit requirements.  
**Production/broad rollout:** NO-GO until distributed rate limiting and durable quarantine enforcement are implemented and verified.
