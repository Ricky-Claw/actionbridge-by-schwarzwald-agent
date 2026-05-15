# Sentinel Review — ActionBridge public/token-adjacent rate-limit gates

Date: 2026-05-15  
Reviewer: Sentinel 🛡️  
Scope: `src/frontend/lib/actionbridge/rate-limit.ts` plus route usage in `setup-session`, `bridge/handshake`, and `connectors/verify`.

## Verdict: GO for pilot gate / NO-GO as production distributed rate limit

The current implementation is acceptable as a pilot abuse throttle for ActionBridge public/token-adjacent onboarding surfaces, provided it is explicitly documented as process-local and backed by platform/WAF limits in production. It must not be treated as the final production rate-limiting control for horizontally scaled/serverless deployments.

## Evidence reviewed

- `src/frontend/lib/actionbridge/rate-limit.ts:21-24` defines per-minute policies:
  - `setupSession`: 30/minute
  - `bridgeHandshake`: 20/minute
  - `domainVerification`: 20/minute
- `src/frontend/lib/actionbridge/rate-limit.ts:27-30` stores counters in `globalThis.__actionBridgeRateLimitBuckets`, making the limiter in-memory and process-local.
- `src/frontend/lib/actionbridge/rate-limit.ts:36-40` keys by first `x-forwarded-for` value or `x-real-ip` plus truncated `user-agent`.
- `src/frontend/lib/actionbridge/rate-limit.ts:50-52` hashes the raw policy/client/discriminator key before storage/return.
- `src/frontend/lib/actionbridge/rate-limit.ts:74-89` returns fail-stop `429` with `Retry-After`, policy, remaining, reset, and key digest.
- Routes enforce the limiter before parsing/auth/database work:
  - `setup-session`: `src/frontend/app/api/actionbridge/setup-session/route.ts:13-16`
  - `bridge/handshake`: `src/frontend/app/api/actionbridge/bridge/handshake/route.ts:9-11`
  - `connectors/verify` POST: `src/frontend/app/api/actionbridge/connectors/verify/route.ts:27-29`
  - `connectors/verify` PATCH: `src/frontend/app/api/actionbridge/connectors/verify/route.ts:104-106`
- Local verification passed:
  - `npm run test:contracts`
  - `npm run test:security`

## Security assessment

### What is acceptable

- **Fail-closed at route level:** all scoped routes check `!rateLimit.ok` and immediately return the generated `429` response before expensive or sensitive operations.
- **No raw secrets in responses:** responses expose only `keyDigest`, not raw IP, user-agent, token, connector ID, or verification token.
- **Token-adjacent setup-session handling is bounded:** `setup-session` uses only `token.slice(0, 16)` as a discriminator and then hashes it with the client/policy key. This is still secret-adjacent internally, but not logged or returned raw by this code.
- **Useful client headers on denial:** denied requests receive `Retry-After`, `X-ActionBridge-RateLimit-Policy`, `X-ActionBridge-RateLimit-Remaining`, and `X-ActionBridge-RateLimit-Reset`.
- **Pilot-friendly dependency profile:** no Redis/external store means no external limiter outage mode. For a pilot, this is simple and hard to misconfigure.

### Bypass / production concerns

1. **Process-local counters are bypassable in distributed production.**
   - Severity: Medium for pilot, High if marketed as production-grade.
   - Evidence: `globalThis` Map in `rate-limit.ts:27-30` resets on process restart and does not coordinate across workers, regions, serverless instances, or deploys.
   - Impact: attacker can spread requests across instances or benefit from cold starts/restarts.

2. **Client IP trust depends on deployment boundary.**
   - Severity: Medium.
   - Evidence: `clientKey()` trusts `x-forwarded-for` first (`rate-limit.ts:36-40`).
   - Impact: if the app is reachable directly instead of only through a trusted proxy/CDN that overwrites forwarding headers, clients can spoof IPs to rotate limiter keys.

3. **Authenticated verification limiter is not user-scoped.**
   - Severity: Low/Medium.
   - Evidence: `connectors/verify` applies only `domainVerification` by client key before auth; it does not add user ID, connector ID, or verification ID after auth.
   - Impact: NAT/shared-office users can throttle each other; authenticated attackers can rotate IP/user-agent. This is okay as an outer public gate, but not enough for per-tenant abuse control.

4. **Successful responses do not include rate-limit headers.**
   - Severity: Low.
   - Evidence: `remaining/resetAt` are returned from the helper on success but not attached by routes.
   - Impact: clients cannot self-throttle until they hit `429`; operational observability is weaker.

5. **No bucket cleanup.**
   - Severity: Low for pilot.
   - Evidence: expired entries are replaced only when the same key is reused; no sweep exists.
   - Impact: high-cardinality spoofed keys can grow memory until process restart. Window is small, but the Map can retain old keys.

## Required gates before production

- Replace or wrap this with a distributed limiter (Redis/Upstash/KV/CDN/WAF) keyed by trusted client identity and route policy.
- Only trust `x-forwarded-for` / `x-real-ip` when requests arrive through controlled infrastructure that strips/sets those headers; otherwise derive IP from the platform request metadata.
- Add per-user/per-connector/per-token-digest throttles for authenticated and token-specific flows, while keeping an outer IP/client limiter.
- Add positive-path rate-limit headers or structured telemetry for remaining/reset values.
- Add expiry cleanup or bounded cardinality/LRU behavior if the in-memory limiter remains enabled anywhere.

## Compliance notes

- GDPR/PII posture is acceptable for pilot: IP and user-agent are only used transiently and stored as a short SHA-256 digest in memory/response. No raw PII or raw token is returned by the limiter.
- Avoid logging `rawKey`, request headers, setup tokens, or `discriminator` in future instrumentation.

## Final decision

**GO** for a controlled pilot as a defense-in-depth gate, with the limitation clearly documented.  
**NO-GO** for production distributed abuse protection until the production gates above are implemented and verified.
