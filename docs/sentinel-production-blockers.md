# ActionBridge Sentinel Production Blockers

This file tracks blockers that must remain visible until fixed. A controlled pilot may continue only under Sentinel-approved constraints.

## Blocker 1 — Distributed Rate Limiting
Current limiter is `pilot_process_local`. Production needs a distributed atomic counter store and trusted proxy identity.

Required proof:
- [x] cross-instance counter test; _Behavioral module now proves a shared counter denies a third same-window webhook hit across worker calls and separately proves isolated process-local stores can be bypassed, preserving the production distributed-store blocker._
- [x] TTL reset test; _Behavioral module now proves expired windows reset deterministically._
- [x] trusted proxy absent/missing-header fail-closed proof in production mode;
- [x] tenant/connector/action/token dimensions documented and used in pilot throttles;
- [x] real distributed atomic counter store wired. _Production distributed mode now uses the async ActionBridge limiter path backed by Upstash Redis REST counters for public/setup/verification/backend-bridge/target routes and webhook delivery/failure throttles; it fails closed for missing trusted proxy identity, missing store config, HTTP failures, or invalid Redis responses without exposing raw IPs or tokens._

## Blocker 2 — Durable Quarantine / Pause
Initial durable connector quarantine primitive exists: `actionbridge_connector_quarantine`, `webhook-quarantine.ts`, and execute-route pre-delivery blocking for active webhook quarantine.

Still required proof before production:
- [x] route/integration test proves repeated failures persist quarantine state; _Behavioral module now simulates repeated webhook failures creating active redacted durable quarantine with repeated-failure reason._
- [x] route/integration test proves quarantined connector cannot deliver; _Behavioral module now proves active durable quarantine blocks before network execution; source-order guard remains in execute route._
- [x] operator can create/review/resolve quarantine with audit via `/api/actionbridge/quarantine`;
- [x] customer/operator visible reason is safe and redacted.

## Blocker 3 — Behavioral Security Tests
Marker tests are not enough for production.

Required proof:
- [x] endpoint path rejection behavior; _Behavioral module now covers connector-route normalizer cases, POST fail-closed-before-insert source order, delivery helper validation, and DB constraint defense-in-depth._
- [x] webhook timeout/non-2xx persistence; _execute-route source-order proof plus behavioral persistence simulation covers failed execution/error event recording for non-2xx and timeout-safe summaries._
- [x] unresolved signing ref blocks before network; _spec-model plus execute-route source-order proof added: unresolved signing blocks before throttle/delivery branch_
- [x] error lifecycle race cannot downgrade state. _Route uses monotonic status transitions plus compare-and-set `status=currentStatus`; behavioral proof covers stale open→acknowledged losing after open→resolved._
- [x] visibility routes never expose raw secrets. _Runtime sanitizer proof now covers nested sensitive values plus audit/execution route sanitizer usage._

## Blocker 4 — Secret Management / Rotation
Webhook HMAC supports server-side env-backed secret ref resolution, and the pilot env bootstrap/rotation story is documented in `docs/specs/actionbridge-webhook-secret-bootstrap-rotation.md`. Production still needs a real secret-store/KMS implementation and operational rotation controls.

Required proof:
- [x] secret refs cannot be client supplied;
- [x] pilot rotation story preserves idempotency/audit continuity;
- [x] no raw secret in DB/log/UI/agent route;
- [x] receiver guide is followed by pilot receiver documentation;
- [ ] production KMS/secret-manager resolver with access audit; _Webhook signing now has a managed Google Secret Manager REST resolver primitive, fails closed when managed secret mode is required, records redacted access-audit status in result summaries, maps refs to provider-safe digest-only secret IDs, never returns raw refs/secrets/tokens in summaries, keeps pilot env lookup out of production-required mode, and exposes a redacted configuration-shape preflight for required managed-secret environment variables. This remains a production blocker until least-privilege service identity/token issuance, managed environment provisioning, and Sentinel release review are complete. Operator UI controls now exist for dry-run-first rotation and expose only digest/state summaries._
- [x] pilot operator rotation route with rollback and monitoring markers. _Authenticated owner-scoped rotation route authorizes the connector before resolving refs, dry-runs by default, uses the async managed-secret resolver when configured, requires env/KMS-style resolver success before update, applies only with an explicit confirmation header, writes redacted control audit for meaningful outcomes, uses a Sentinel policy marker, and supports rollback guidance by rerunning with the previous server-owned ref. Full enforced production workflow still requires managed-secret environment provisioning and Sentinel release review; operator UI controls are wired into `/actionbridge/operator` with dry-run/apply confirmation, CAS digest input, required local receiver-smoke evidence before apply is enabled, and rollback guidance._

## Gate 5 — Browser/Userflow E2E — Closed for Controlled Pilot
Build/typecheck/lint metadata has been restored for the focused `src/frontend` snapshot: lockfile/install context exists, `npm run build` executes `next build src/frontend`, `npm run typecheck` executes `tsc --noEmit`, and `npm run lint` executes ESLint with zero warnings.

Required proof:
- [x] browser/userflow smoke test for setup-link → verification → bridge → capability → approval → connector execution. _`npm run test:userflow-smoke` starts the built Next frontend locally and verifies the core ActionBridge route journey, connector-only UX anchors, approval/execution intent copy, and absence of obvious secret-like leakage._

Residual note:
- This closes the local controlled-pilot gate only; production should still add full browser automation against a deployed staging environment once external infrastructure is approved.

## Blocker 6 — Operational Retention
Error logs are bounded and redacted. A resolved-log retention operation now exists on `/api/actionbridge/errors` with dry-run default, explicit destructive confirmation, severity-age cutoffs, and redacted deletion summary audit.

Required proof:
- [x] retention job or admin operation;
- [x] resolved-log deletion by severity age;
- [x] deletion summary audit;
- [x] GDPR handling documented for pilot customers;
- [x] operator UI for routine dry-run/delete retention operations;
- [x] scheduled/background execution for production operations. _`/api/actionbridge/ops/error-retention` is cron-callable, bearer-secret protected, tenant/user allowlist scoped, dry-run by default, and requires both env enablement and confirmation header before deleting._
