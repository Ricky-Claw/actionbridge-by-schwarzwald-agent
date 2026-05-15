# ActionBridge Production Rate Limits

## Status
Current limiter is **pilot-only** and process-local. It is useful as a defense-in-depth throttle, but it is not a production distributed abuse-control boundary.

## Goal
Before broad production rollout, ActionBridge must enforce rate limits consistently across workers, regions, restarts, and deploys for public, token-adjacent, authenticated, connector, and execution surfaces.

## Required Production Architecture
Use layered throttling:

1. **Edge/CDN/WAF outer gate**
   - IP / ASN / geo / bot-score limits.
   - Protects public setup and verification endpoints before app compute.
   - Must overwrite or sanitize forwarding headers.

2. **Distributed app limiter**
   - Redis/Upstash/KV or equivalent atomic counter store.
   - Shared across app instances and regions or region-scoped with conservative limits.
   - Uses atomic increment + TTL, not process memory.

3. **Tenant/action/entity limiter**
   - Per tenant/user.
   - Per setup-token digest.
   - Per connector id.
   - Per verification challenge id.
   - Per action name / execution path.

4. **Execution-specific guardrails**
   - Webhook-v1 delivery attempts must be limited per tenant + connector + action + destination origin.
   - Repeated delivery failures should trigger quarantine or manual review.
   - Approval idempotency remains consume-once and is not replaced by rate limiting.

## Trusted Client Identity
Production must not trust arbitrary `x-forwarded-for` or `x-real-ip` headers unless the app is reachable only through controlled infrastructure that strips incoming copies and sets canonical values.

Required policy:
- Direct origin access blocked by firewall/private network.
- CDN/proxy appends or overwrites canonical client IP.
- App documents which header is trusted in each deployment.
- If trusted proxy is absent or unknown, client-IP based limits are advisory only.

## Required Policies

| Policy | Key dimensions | Initial production default |
| --- | --- | --- |
| setupSession | trusted client + setup token digest | 20/min, 100/hour |
| bridgeHandshake | trusted client + setup token digest + origin | 10/min, 60/hour |
| domainVerification | tenant + connector + challenge + trusted client | 10/min, 50/hour |
| connectorUpdate | tenant + connector | 20/min |
| approvalCreate | tenant + action + connector | 30/min |
| approvalConsume | tenant + approval + action | consume-once + 10/min safety cap |
| webhookDelivery | tenant + connector + action + destination origin | 30/min, failure quarantine after repeated 4xx/5xx/timeouts |

## Required Response Semantics
All denied requests must return:
- HTTP `429`
- `Retry-After`
- `X-ActionBridge-RateLimit-Policy`
- `X-ActionBridge-RateLimit-Remaining`
- `X-ActionBridge-RateLimit-Reset`
- Redacted/hash-only key metadata

Successful responses should include remaining/reset metadata where safe.

## Required Telemetry / Audit
Do not log raw IP, user-agent, tokens, idempotency keys, or secrets. Store only:
- policy name
- hashed key digest
- tenant/user id when authenticated
- route/action surface
- allowed/limited decision
- remaining/reset

Repeated rate-limit denials on setup, verification, approval, or webhook delivery should be visible to Sentinel-style monitoring.

## Required Tests Before Production
- Atomic distributed increment under concurrent requests.
- TTL expiry and reset behavior.
- Cross-instance simulation proves shared counter.
- Trusted proxy header spoof test.
- Per-tenant/per-connector/per-token dimensions.
- Success + denial headers.
- Webhook delivery failure quarantine trigger.
- Redaction test: no raw IP/token/user-agent/idempotency key in response/audit.

## Pilot Exception
The current process-local limiter may remain enabled as a pilot fallback, but production docs/UI/status must label it as **pilot fallback only** until the distributed limiter is wired and verified.
