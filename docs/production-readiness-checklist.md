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
- [x] Behavioral endpoint path rejection tests.
- [x] Behavioral DNS rebinding/pinned-connection tests. _Behavioral module now proves mixed public/private resolver results block before network and that the delivery helper validates all returned DNS answers before connecting to the pinned IP with original Host/SNI._
- [x] Behavioral timeout/non-2xx persistence tests. _Execute-route source-order proof plus behavioral persistence simulation covers failed execution/error event recording for non-2xx and timeout-safe summaries._

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
- [x] Durable quarantine behavioral proof for repeated-failure persistence and pre-network delivery block.
- [x] Cross-instance/concurrency tests. _Behavioral module covers shared-counter cross-worker denial, TTL reset, and process-local bypass proof; production still requires a real distributed atomic store._

## Gate 4 — Observability and Operations
- [x] Redacted audit logs.
- [x] Execution state and consume-once idempotency.
- [x] Error log table/API with category, severity, status lifecycle.
- [x] Bounded error context and circular guard.
- [x] Compare-and-set error status updates.
- [x] Retention/GDPR policy implemented operationally for resolved error logs.
- [x] Scheduled/background retention execution path. _Bearer-secret protected cron route added; dry-run default and destructive deletion requires env enable plus explicit confirmation header._
- [x] Operator notification/alerting for High/Critical errors. _Durable owner-scoped alert inbox plus bearer-secret protected scheduled alert digest added for open High/Critical alerts; production can wire the digest output to the approved external notification channel without exposing secrets/context._
- [x] Operator failure UI consuming `/api/actionbridge/errors`.

## Gate 5 — Verification Tooling
- [x] `npm test` gate.
- [x] `git diff --check` gate.
- [x] Build metadata restored (`tsconfig`, Next config, lockfile/install context). _Next/TypeScript/ESLint/package-lock restored for the focused `src/frontend` snapshot._
- [x] `npm run build`. _Runs `next build src/frontend` successfully._
- [x] Typecheck. _Runs `tsc --noEmit` successfully._
- [x] Lint. _Runs `eslint src/frontend --max-warnings=0` successfully._
- [x] Browser/userflow E2E. _Production Next smoke starts the built frontend locally and verifies core ActionBridge routes, route intent copy, connector-only UX anchors, and absence of obvious secret-like leakage._

## Gate 6 — Product Boundary
- [x] Connector-only scope documented.
- [x] No CRM/lead inbox/product drift.
- [x] Schwarzwald-Agent integration explicitly delayed until standalone DoD.
- [x] Embedded setup-plugin UX boundary documented.
- [x] Embedded setup wizard UI implemented. _Customer setup page now renders an embedded setup wizard from the API-provided `actionbridge.embedded_setup.v1` descriptor, lets customers choose verification method/capability intents locally, and keeps activation fail-closed until server verification, bridge handshake, capability API, approvals, and audit controls pass._
- [x] Standalone setup UX consumes real API state instead of explanatory static pages. _Customer setup page now resolves the public setup token through `/api/actionbridge/setup-session`, renders target origin/status/expiry, API-provided verification methods, masked bridge snippet, and capability choices, and fails closed when the session is missing or invalid._
- [x] Operator-facing smoke runbook for pilot.

## Rule
No production/broad rollout until every unchecked item above is either implemented and verified or explicitly accepted as out-of-scope by Elvis/Ricky with Sentinel sign-off.
