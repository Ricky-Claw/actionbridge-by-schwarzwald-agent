# Sentinel Webhook-v1 Implementation Re-review

**Date:** 2026-05-15  
**Reviewer:** Sentinel 🛡️  
**Scope:** `webhook-delivery.ts`, execute route webhook integration, connector network execution gate, connector type migration, Webhook-v1 tests/docs.  
**Verdict for controlled pilot:** **CONDITIONAL GO** for a tightly controlled pilot with verified webhook endpoints and operator/customer authorization. **NO-GO** for broad production or unverified third-party rollout.

## Executive Summary

The previous blocking High findings have been materially addressed.

Webhook-v1 now uses connection-pinned HTTPS via `https.request()` to the already validated DNS IP while preserving original `Host` and SNI. The execute route now catches delivery exceptions, records a failed execution state, and treats non-2xx webhook responses as failed ActionBridge executions. Connector network execution remains gated behind webhook type, `safety_status: 'pass'`, `permission_status: 'active'`, at least one server-owned allowed origin, and explicit `network_execution_enabled` update.

Remaining risk is pilot-scope rather than High blocker: HMAC signing is implemented in the delivery module but not wired to secret storage, and I did not find a dedicated unsigned-pilot runbook note outside this review. That must be explicit before any customer-facing pilot enablement.

## Reviewed Evidence

- `src/frontend/lib/actionbridge/webhook-delivery.ts`
- `src/frontend/app/api/actionbridge/execute/route.ts`
- `src/frontend/app/api/actionbridge/connectors/route.ts`
- `src/frontend/lib/actionbridge/dns-ip-guard.ts`
- `supabase/migrations/20260515000300_actionbridge_webhook_connector.sql`
- `docs/specs/actionbridge-webhook-v1-adapter.md`
- `scripts/test-actionbridge-contracts.mjs`
- `scripts/test-actionbridge-security-gauntlet.mjs`

Verification run:

```bash
node scripts/test-actionbridge-contracts.mjs && node scripts/test-actionbridge-security-gauntlet.mjs
```

Result: **passed**.

## Previous Findings Re-check

### Fixed — DNS/IP guard is now connection-pinned

**Evidence:** `deliverActionBridgeWebhook()` resolves `target.hostname`, validates all returned addresses through `decideActionBridgeDnsPinning(...)`, selects a validated `pinnedAddress`, then calls `postPinnedHttpsJson(...)`. That helper uses `https.request()` with:

- `host: input.pinnedAddress`
- `servername: input.target.hostname`
- `Host: input.target.host`
- original target path/search
- no `fetch()` re-resolution path

**Assessment:** This closes the prior DNS-rebinding gap where validation and connection could use different resolver answers. The actual outbound connection is made to the validated IP.

**Residual note:** This still relies on DNS lookup returning all relevant addresses and selecting the first validated address. Acceptable for controlled pilot; production should add behavioral tests or an egress-layer denylist to prove private/link-local targets cannot be reached even if application logic regresses.

### Fixed — Delivery exceptions fail closed and are persisted

**Evidence:** The execute route wraps `deliverActionBridgeWebhook(...)` in `try/catch`. Exceptions are converted to a redacted `webhook_delivery_error` result with stable error codes:

- `ACTIONBRIDGE_WEBHOOK_TIMEOUT`
- `ACTIONBRIDGE_WEBHOOK_DELIVERY_FAILED`

The route sets `finalExecutionStatus = 'failed'` when `!webhookResult.ok`, persists via `persistActionBridgeExecutionResult(...)`, and returns a controlled 502 response for failed delivery.

**Assessment:** The approval execution no longer falls into an uncaught 500/ambiguous state after lead outbox persistence.

### Fixed — Non-2xx webhook responses are execution failures

**Evidence:** `deliverActionBridgeWebhook()` returns `ok: response.ok` and `status: 'webhook_failed'` for non-2xx. Execute route sets:

```ts
if (!webhookResult.ok) finalExecutionStatus = 'failed';
```

and persists `status: finalExecutionStatus` with `ACTIONBRIDGE_WEBHOOK_DELIVERY_FAILED` on failure.

**Assessment:** Audit semantics are now correct: downstream 4xx/5xx is not recorded as successful ActionBridge execution.

### Partially addressed — Unsigned pilot mode is still not operationally explicit

**Evidence:** `webhook-delivery.ts` supports `signingSecret` and emits `X-ActionBridge-Signature` when provided, but execute route does not pass a secret. Connector creation still rejects secret material with `ACTIONBRIDGE_SECRET_STORAGE_NOT_CONFIGURED`. `docs/specs/actionbridge-webhook-v1-adapter.md` says HMAC is recommended and secret must come from secret store, but I did not find a clear pilot note stating “Webhook-v1 pilot is unsigned” with compensating controls.

**Risk:** Receivers cannot cryptographically authenticate ActionBridge origin in the current pilot path. This is acceptable only if the pilot is constrained to verified endpoints, explicit customer authorization, idempotency digest, HTTPS, allowlisted origins, and external receiver-side controls.

**Required before customer-facing pilot:** Add/update the pilot runbook/spec with an explicit unsigned-mode statement and compensating controls, or wire server-side secret reference retrieval and pass `signingSecret` without exposing secrets to agents/logs/browser/client output.

### Still weak — Tests are marker-heavy, not behavioral

**Evidence:** Current contract/gauntlet checks passed, and they assert the new pinned-delivery/failure markers. They still mostly inspect source tokens rather than exercising network behavior or persistence failure branches.

**Risk:** A regression can preserve marker strings while breaking fail-closed behavior.

**Required before production:** Add behavioral unit/integration tests for DNS rebinding simulation, private-IP DNS answer rejection, timeout/error catch, non-2xx persistence as failed, and redaction of error details.

## Positive Controls Confirmed

- Authentication required on connector and execute routes.
- Webhook connector type is explicitly allowed by route/migration/type definitions.
- New webhook connectors default to `network_execution_enabled: false`, `safety_status: 'untested'`, `permission_status: 'draft'`.
- Network execution enablement requires webhook type, passed safety status, active permission status, and at least one server-owned allowed origin.
- Delivery rejects disabled connectors and `transactional`/`destructive` actions.
- Target comes from server connector base URL + sanitized path; caller body cannot supply target URL.
- HTTPS-only target validation, exact origin allowlist, blocked private/local hosts, no redirects, timeout, byte cap, idempotency digest header, optional HMAC, and redaction are present.
- Lead submission is persisted before webhook delivery and does not perform arbitrary browser/RPA/form submission.
- Failed webhook delivery is reflected in persisted execution status and API response.

## GDPR / Privacy Check

- Payload and response summaries are redacted before webhook/audit exposure.
- Response preview is capped and redacted.
- Raw idempotency key is not sent; only a digest header is included.
- Lead submission data is outbound personal/business data. For German SME/GDPR pilots, the customer must explicitly authorize destination, data categories, and processor/controller role before `permission_status: active` and `network_execution_enabled: true`.

## Pilot Gate Decision

**CONDITIONAL GO for controlled pilot only**, with these constraints:

1. Use only verified, customer/operator-authorized webhook origins.
2. Keep `network_execution_enabled` default-off and enable only after `safety_status: 'pass'` + `permission_status: 'active'`.
3. Treat current mode as **unsigned pilot mode** until secret-ref signing is implemented; document this in the pilot runbook before customer-facing enablement.
4. Monitor failed delivery executions and preserve audit evidence.
5. Do not expand beyond lead-submit webhook delivery until behavioral tests replace marker-only coverage.

**NO-GO for production/broad rollout** until HMAC secret-ref wiring and behavioral security tests are complete.
