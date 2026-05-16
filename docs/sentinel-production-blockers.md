# ActionBridge Sentinel Production Blockers

This file tracks blockers that must remain visible until fixed. A controlled pilot may continue only under Sentinel-approved constraints.

## Blocker 1 — Distributed Rate Limiting
Current limiter is `pilot_process_local`. Production needs a distributed atomic counter store and trusted proxy identity.

Required proof:
- [ ] cross-instance counter test;
- [ ] TTL reset test;
- [x] trusted proxy absent/missing-header fail-closed proof in production mode;
- [x] tenant/connector/action/token dimensions documented and used in pilot throttles;
- [ ] real distributed atomic counter store wired.

## Blocker 2 — Durable Quarantine / Pause
Initial durable connector quarantine primitive exists: `actionbridge_connector_quarantine`, `webhook-quarantine.ts`, and execute-route pre-delivery blocking for active webhook quarantine.

Still required proof before production:
- [ ] route/integration test proves repeated failures persist quarantine state;
- [ ] route/integration test proves quarantined connector cannot deliver;
- [x] operator can create/review/resolve quarantine with audit via `/api/actionbridge/quarantine`;
- [x] customer/operator visible reason is safe and redacted.

## Blocker 3 — Behavioral Security Tests
Marker tests are not enough for production.

Required proof:
- [ ] endpoint path rejection behavior; _spec-model coverage added; production route/import coverage still required_
- [ ] webhook timeout/non-2xx persistence; _spec-model coverage added; production route/persistence coverage still required_
- [x] unresolved signing ref blocks before network; _spec-model plus execute-route source-order proof added: unresolved signing blocks before throttle/delivery branch_
- [ ] error lifecycle race cannot downgrade state;
- [x] visibility routes never expose raw secrets. _Runtime sanitizer proof now covers nested sensitive values plus audit/execution route sanitizer usage._

## Blocker 4 — Secret Management / Rotation
Webhook HMAC supports server-side env-backed secret ref resolution, and the pilot env bootstrap/rotation story is documented in `docs/specs/actionbridge-webhook-secret-bootstrap-rotation.md`. Production still needs a real secret-store/KMS implementation and operational rotation controls.

Required proof:
- [x] secret refs cannot be client supplied;
- [x] pilot rotation story preserves idempotency/audit continuity;
- [x] no raw secret in DB/log/UI/agent route;
- [x] receiver guide is followed by pilot receiver documentation;
- [ ] production KMS/secret-manager resolver with access audit;
- [ ] operator rotation workflow/job with rollback and monitoring.

## Blocker 5 — Build/Typecheck/Lint Metadata
This focused repo snapshot lacks full framework build metadata.

Required proof:
- lockfile/install context restored;
- `npm run build`;
- typecheck;
- lint;
- browser/userflow smoke test.

## Blocker 6 — Operational Retention
Error logs are bounded and redacted. A resolved-log retention operation now exists on `/api/actionbridge/errors` with dry-run default, explicit destructive confirmation, severity-age cutoffs, and redacted deletion summary audit.

Required proof:
- [x] retention job or admin operation;
- [x] resolved-log deletion by severity age;
- [x] deletion summary audit;
- [x] GDPR handling documented for pilot customers;
- [x] operator UI for routine dry-run/delete retention operations;
- [ ] scheduled/background execution for production operations.
