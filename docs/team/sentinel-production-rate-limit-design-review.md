# Sentinel Review — ActionBridge Production Rate-Limit Design

Date: 2026-05-15
Reviewer: Sentinel 🛡️
Scope:
- `docs/specs/actionbridge-production-rate-limits.md`
- `src/frontend/lib/actionbridge/rate-limit.ts`
- `scripts/test-actionbridge-contracts.mjs`
- `scripts/test-actionbridge-security-gauntlet.mjs`

## Verdict

**CONDITIONAL PASS for design/spec clarity. NO-GO for production enforcement until the distributed limiter is implemented and verified.**

The new spec clearly marks the current limiter as **pilot-only**, and the source exposes `ACTIONBRIDGE_RATE_LIMIT_MODE = 'pilot_process_local'`. That is acceptable as a temporary defense-in-depth throttle, but it must not be represented as a production abuse-control boundary.

## Findings

### ✅ Satisfied design requirements

- Current limiter is explicitly documented as **pilot-only** and process-local.
- Production architecture requires a distributed atomic counter store using atomic increment + TTL instead of process memory.
- Trusted proxy policy is documented: no arbitrary trust in `x-forwarded-for` / `x-real-ip`, direct origin access must be blocked, and controlled infrastructure must sanitize canonical client IP headers.
- Required dimensions cover tenant/user, setup-token digest, connector id, verification challenge id, action name/execution path, and webhook destination origin.
- Required response semantics include `429`, `Retry-After`, policy, remaining, reset, mode, and hash-only/redacted key metadata.
- Required telemetry/audit prohibits raw IP, user-agent, tokens, idempotency keys, and secrets; only policy/key digest/tenant/surface/decision/remaining/reset should be logged.
- Webhook-v1 delivery throttling is explicitly required per tenant + connector + action + destination origin, with quarantine/manual-review trigger on repeated failures.
- Test scripts now assert rate-limit contract markers and production spec markers.

### ⚠️ Production blockers / gaps to keep explicit

1. **Distributed limiter not implemented yet — High**
   - `rate-limit.ts` still uses a global in-process `Map` bucket.
   - This is bypassable across workers, serverless instances, deploys, restarts, and regions.
   - Production release must wait for Redis/Upstash/KV or equivalent atomic shared counter tests.

2. **Trusted proxy enforcement is documentation-only — High**
   - Pilot code still reads `x-forwarded-for` / `x-real-ip` directly in `clientKey()`.
   - The spec correctly says this is advisory unless origin access is blocked and headers are sanitized by controlled infrastructure.
   - Production implementation needs an allowlisted proxy/header policy and spoof tests.

3. **Success headers are helper-only, not wired into success responses — Medium**
   - `createActionBridgeRateLimitHeaders()` exists, and denial responses include headers.
   - Current route success responses do not attach remaining/reset metadata.
   - Spec says successful responses should include this metadata where safe; production implementation should wire this consistently or document exceptions.

4. **Webhook delivery throttling is not yet enforced in code — High**
   - The spec covers `webhookDelivery`, but `DEFAULT_POLICIES` only includes `setupSession`, `bridgeHandshake`, and `domainVerification`.
   - Before enabling production webhook delivery, add a dedicated distributed policy keyed by tenant + connector + action + destination origin and failure quarantine state.

5. **Per-tenant / per-connector / per-token dimensions are not implemented in the pilot helper — Medium**
   - The production requirement is documented, but current helper mostly uses client header + user-agent + optional discriminator.
   - This is acceptable only because it is clearly pilot-only.

## Verification Performed

Commands run from repository root:

```bash
node scripts/test-actionbridge-contracts.mjs
node scripts/test-actionbridge-security-gauntlet.mjs
```

Both scripts exited `0`.

## Sentinel Gate

- **Pilot:** Allowed, provided UI/docs/status continue labeling this as pilot fallback only.
- **Production:** Blocked until distributed atomic counters, trusted proxy enforcement, production dimensions, success headers, webhook throttling/quarantine, telemetry redaction tests, and cross-instance concurrency tests are implemented and passing.
