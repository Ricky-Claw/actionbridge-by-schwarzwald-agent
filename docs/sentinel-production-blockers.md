# ActionBridge Sentinel Production Blockers

This file tracks blockers that must remain visible until fixed. A controlled pilot may continue only under Sentinel-approved constraints.

## Blocker 1 — Distributed Rate Limiting
Current limiter is `pilot_process_local`. Production needs a distributed atomic counter store and trusted proxy identity.

Required proof:
- cross-instance counter test;
- TTL reset test;
- header spoof rejection test;
- tenant/connector/action/token dimensions.

## Blocker 2 — Durable Quarantine / Pause
Initial durable connector quarantine primitive exists: `actionbridge_connector_quarantine`, `webhook-quarantine.ts`, and execute-route pre-delivery blocking for active webhook quarantine.

Still required proof before production:
- route/integration test proves repeated failures persist quarantine state;
- route/integration test proves quarantined connector cannot deliver;
- operator can review/resolve with audit;
- customer-visible reason is safe and redacted.

## Blocker 3 — Behavioral Security Tests
Marker tests are not enough for production.

Required proof:
- [ ] endpoint path rejection behavior; _spec-model coverage added; production route/import coverage still required_
- [ ] webhook timeout/non-2xx persistence; _spec-model coverage added; production route/persistence coverage still required_
- [x] unresolved signing ref blocks before network; _spec-model plus execute-route source-order proof added: unresolved signing blocks before throttle/delivery branch_
- [ ] error lifecycle race cannot downgrade state;
- [ ] visibility routes never expose raw secrets.

## Blocker 4 — Secret Management / Rotation
Webhook HMAC supports server-side env-backed secret ref resolution, but production needs a real secret-store/rotation story.

Required proof:
- secret refs cannot be client supplied;
- rotation does not break idempotency/audit;
- no raw secret in DB/log/UI/agent route;
- receiver guide is followed by pilot receiver.

## Blocker 5 — Build/Typecheck/Lint Metadata
This focused repo snapshot lacks full framework build metadata.

Required proof:
- lockfile/install context restored;
- `npm run build`;
- typecheck;
- lint;
- browser/userflow smoke test.

## Blocker 6 — Operational Retention
Error logs are bounded and redacted, but retention is policy-only.

Required proof:
- retention job or admin operation;
- resolved-log deletion by severity age;
- deletion summary audit;
- GDPR handling documented for pilot customers.
