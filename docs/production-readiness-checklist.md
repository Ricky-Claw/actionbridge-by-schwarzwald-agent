# ActionBridge Production Readiness Checklist

## Status
ActionBridge is suitable for controlled pilot continuation only. This checklist defines the remaining gates before broad production rollout or Schwarzwald-Agent dashboard integration.

## Gate 1 — Connector Execution Safety
- [x] Server-owned connector configuration.
- [x] Exact HTTPS origin allowlist.
- [x] Setup-link connector binding origin lock. _Bound setup links now require the customer target origin to match the connector base/allowed origin before token issuance; bridge handshake rechecks the binding before completing a setup link so legacy/mismatched rows cannot attach arbitrary origins to a connector._
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
- [ ] Real secret manager/KMS integration for production. _Managed-secret resolver primitive added for webhook signing via Google Secret Manager REST (`ACTIONBRIDGE_SECRET_MANAGER_PROVIDER=google_secret_manager_rest`) with bounded timeout, redacted access-audit summaries, digest-only secret-ref reporting, provider-safe digest secret-id mapping, pilot env lookup disabled when managed secrets are required, a redacted configuration-shape preflight for required managed-secret environment variables, a live-access probe primitive that can prove access/denial without exposing tokens or raw provider resource names, and an authenticated owner-scoped ops route that persists redacted probe evidence for Sentinel review. Production rollout remains blocked on real environment provisioning, least-privilege service identity/token issuance, live Secret Manager evidence, and Sentinel release review. Operator UI controls now exist for dry-run-first webhook signing rotation and expose digest-only refs. Route-core tests now execute the live-probe contract with mocked auth, owner scoping, service-audit availability, rate limiting, provider success/denial, audit failure, and response/audit redaction assertions._
- [x] Receiver verification guide for `X-ActionBridge-Signature`.
- [x] Pilot operator rotation route with rollback and monitoring markers. _Authenticated owner-scoped `POST /api/actionbridge/ops/webhook-secret-rotation` authorizes the connector before secret-ref resolution, dry-runs by default, uses Sentinel policy marker `sentinel.actionbridge.webhook_signing_secret.rotate.v1`, uses the async managed-secret resolver when configured, requires server-side secret-ref resolution and an explicit confirmation header to apply, conditionally updates only the signing ref/mode with stale-digest protection, writes redacted control audit for meaningful outcomes, and returns smoke/monitoring markers without exposing raw refs or secrets. Full production rollout still requires managed-secret environment provisioning and Sentinel release review; the operator rotation UI is wired into `/actionbridge/operator` with dry-run-first/apply-confirm controls, digest-only connector state, and a required local receiver-smoke evidence checkpoint before apply is enabled._

## Gate 3 — Abuse Controls
- [x] Pilot process-local rate limiter.
- [x] Pilot webhook delivery throttle.
- [x] Pilot webhook failure quarantine signal.
- [x] Success and denial rate-limit headers for token-adjacent routes. _Setup-link create/list now uses the shared `setupLinks` policy with redacted rate-limit headers before token issuance/listing._
- [x] Distributed atomic rate limiter. _Production distributed mode now requires trusted proxy identity and a configured Upstash Redis REST provider, increments a Redis counter before allowing requests, fail-closes when the store/config/response is unavailable, and keeps pilot process-local mode unchanged._
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
- [x] Standalone setup UX consumes real API state instead of explanatory static pages. _Customer setup page now resolves the public setup token through `/api/actionbridge/setup-session`, renders target origin/status/expiry, API-provided verification methods, masked bridge snippet, and capability choices, and fails closed when the session is missing or invalid. Bound setup links can now issue and check real DNS TXT/meta/.well-known domain verification challenges through token-scoped `/api/actionbridge/setup-session/verification`; unbound links stay bridge-preview only, verified records are idempotent/no-churn, only draft connectors can be activated, and paused/revoked/disabled/failed/quarantined connectors cannot be reactivated by a still-valid setup token._
- [x] Operator setup-link UX consumes the real setup-links API. _Operator cockpit now creates setup links through authenticated JSON `POST /api/actionbridge/setup-links`, loads owner-scoped recent links through `GET /api/actionbridge/setup-links`, displays the raw setup token only in the one creation response, explains bridge-only preview for unbound links, origin-locks connector bindings, and avoids static demo customer values._
- [x] Operator-facing smoke runbook for pilot.

## Rule
No production/broad rollout until every unchecked item above is either implemented and verified or explicitly accepted as out-of-scope by Elvis/Ricky with Sentinel sign-off.
