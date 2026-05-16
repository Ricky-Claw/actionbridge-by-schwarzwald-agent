# ActionBridge Production Readiness Checklist

## Status
ActionBridge is suitable for controlled pilot continuation only. This checklist defines the remaining gates before broad production rollout or Schwarzwald-Agent dashboard integration.

## Gate 1 — Connector Execution Safety
- [x] Server-owned connector configuration.
- [x] Exact HTTPS origin allowlist.
- [x] Private/local/internal host rejection.
- [x] Webhook-v1 no redirects.
- [x] Webhook-v1 pinned outbound connection to validated DNS result.
- [x] Server-owned relative-only `endpoint_path`.
- [x] Fail-closed unresolved signing secret reference.
- [ ] Behavioral endpoint path rejection tests. _Spec-model coverage added; production route/import coverage still required._
- [ ] Behavioral DNS rebinding/pinned-connection tests.
- [ ] Behavioral timeout/non-2xx persistence tests. _Spec-model coverage added; production route/persistence coverage still required._

## Gate 2 — Secrets and Signing
- [x] Raw secrets rejected from public connector/setup routes.
- [x] Agent/tool catalog never exposes `secret_ref`, base URL, token digests, or idempotency keys.
- [x] Webhook delivery supports HMAC signing when server-owned secret ref resolves.
- [x] Unresolved signing ref blocks before network.
- [x] Documented env-secret bootstrap for pilot operations.
- [x] Pilot rotation story for webhook signing secrets.
- [ ] Real secret manager/KMS integration for production.
- [x] Receiver verification guide for `X-ActionBridge-Signature`.

## Gate 3 — Abuse Controls
- [x] Pilot process-local rate limiter.
- [x] Pilot webhook delivery throttle.
- [x] Pilot webhook failure quarantine signal.
- [x] Success and denial rate-limit headers for token-adjacent routes.
- [ ] Distributed atomic rate limiter.
- [x] Trusted proxy/header fail-closed enforcement for production mode.
- [x] Durable connector pause/quarantine operator API.
- [ ] Cross-instance/concurrency tests.

## Gate 4 — Observability and Operations
- [x] Redacted audit logs.
- [x] Execution state and consume-once idempotency.
- [x] Error log table/API with category, severity, status lifecycle.
- [x] Bounded error context and circular guard.
- [x] Compare-and-set error status updates.
- [x] Retention/GDPR policy implemented operationally for resolved error logs.
- [ ] Operator notification/alerting for High/Critical errors.
- [x] Operator failure UI consuming `/api/actionbridge/errors`.

## Gate 5 — Verification Tooling
- [x] `npm test` gate.
- [x] `git diff --check` gate.
- [ ] Build metadata restored (`tsconfig`, Next config, lockfile/install context).
- [ ] `npm run build`.
- [ ] Typecheck.
- [ ] Lint.
- [ ] Browser/userflow E2E.

## Gate 6 — Product Boundary
- [x] Connector-only scope documented.
- [x] No CRM/lead inbox/product drift.
- [x] Schwarzwald-Agent integration explicitly delayed until standalone DoD.
- [x] Embedded setup-plugin UX boundary documented.
- [ ] Embedded setup wizard UI implemented.
- [ ] Standalone setup UX consumes real API state instead of explanatory static pages.
- [ ] Operator-facing smoke runbook for pilot.

## Rule
No production/broad rollout until every unchecked item above is either implemented and verified or explicitly accepted as out-of-scope by Elvis/Ricky with Sentinel sign-off.
