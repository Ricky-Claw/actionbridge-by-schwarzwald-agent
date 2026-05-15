# ActionBridge Behavioral Test Roadmap

## Why
Current gates are strong contract/security marker tests, but production needs behavioral tests that execute failure branches and race conditions. This roadmap converts Sentinel residual notes into concrete test targets.

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
- connector creation returns 400 for rejected paths;
- DB constraint rejects unsafe paths as defense-in-depth;
- execute route never reads caller-supplied body path for webhook delivery.

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
- compare-and-set predicate prevents downgrade;
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
