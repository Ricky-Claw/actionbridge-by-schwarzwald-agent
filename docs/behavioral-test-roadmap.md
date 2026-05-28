# ActionBridge Behavioral Test Roadmap

## Why
Current gates are strong contract/security marker tests, but production needs behavioral tests that execute failure branches and race conditions. This roadmap converts Sentinel residual notes into concrete test targets.

## Current Added Gate
`npm test` now includes:
- `test:behavioral-security`: spec-model checks for endpoint paths, signing modes, and failure persistence semantics.
- `test:behavioral-modules`: extracts and executes importable/source-level ActionBridge seams where build metadata is unavailable, starting with real `normalizeActionBridgeWebhookEndpointPath(...)` behavior from the connector route.
- `test:secret-manager-live-probe-route`: executable route-core tests for the managed-secret live-probe path with mocked auth Supabase, service audit client, rate limiter, provider probe, and audit persistence. It covers unauthenticated/missing/not-found/non-HMAC/service-unavailable/rate-limited/audit-failed/success/provider-denied branches plus negative assertions that raw secret refs, tokens, signing secrets, and provider resource names do not reach response or audit summaries.

These gates improve coverage but do not replace full deployed Next/Supabase integration tests.

## Priority 1 — Webhook Endpoint Path
Behavioral cases:
- `/hook` accepted.
- `hook` normalized to `/hook`.
- `/hook?token=x` rejected.
- `/hook#frag` rejected.
- `https://evil.test/hook` rejected.
- `//evil.test/hook` rejected.
- `/safe\\evil` rejected.

Expected proof:
- connector route path normalizer rejects unsafe paths; **covered by `test:behavioral-modules`**;
- connector creation returns 400 for rejected paths before insert; **covered by `test:behavioral-modules` source-order proof**;
- DB constraint rejects unsafe paths as defense-in-depth; **covered by `test:behavioral-modules` migration proof**;
- execute route never reads caller-supplied body path for webhook delivery. **covered by execute-route source proof using stored connector `endpoint_path`**

## Priority 2 — Webhook Delivery Failure Semantics
Behavioral cases:
- DNS private address returns blocked before network.
- timeout/connection error creates failed execution + error log.
- non-2xx response creates failed execution + error log.
- unresolved signing secret ref blocks before network.
- resolved signing secret emits `X-ActionBridge-Signature`.

Expected proof:
- persisted execution status is `failed` where appropriate;
- raw idempotency key and secret are absent from responses/audit/error logs;
- networkExecution is true only when request was attempted.

## Priority 3 — Error Lifecycle Race
Behavioral cases:
- `open -> acknowledged` succeeds.
- `open -> resolved` succeeds.
- `acknowledged -> resolved` succeeds.
- `resolved -> acknowledged` blocked.
- concurrent stale update with previous `open` fails after row is already resolved.

Expected proof:
- compare-and-set predicate prevents downgrade; **source-level guarded by `test:behavioral-modules`**;
- control audit event written only for accepted transitions.

## Priority 4 — Rate Limits / Quarantine
Behavioral cases:
- repeated webhook delivery attempts trigger `webhookDelivery` throttle.
- repeated failed deliveries mark quarantine signal.
- success responses include safe rate-limit headers.
- denial responses include `Retry-After` without raw key material.

## Priority 5 — Visibility Sanitization
Behavioral cases:
- audit/execution/error APIs strip secret-like fields from nested JSON.
- setup/session/tool-catalog routes do not expose `secret_ref`, base URL, token digest, idempotency key, or service role details.

## Implementation Note
Use the smallest available local harness first. If full Next/Supabase integration metadata remains unavailable, create focused Node-level tests for pure helpers and route-source contract tests until build metadata is restored.
