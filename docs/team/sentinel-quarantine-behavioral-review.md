# Sentinel Review — Durable Webhook Quarantine + Behavioral Module Gate

**Verdict: CONDITIONAL GO for controlled pilot only. NO-GO for production/broad rollout.**

The change moves ActionBridge in the right direction: a durable quarantine table exists, execute-route checks active quarantine before delivery, failure summaries are redacted, and `npm run check` passes. However, the quarantine control is not yet fail-closed on lookup/persistence errors and remains proven mostly by source/regex gates rather than route/integration behavior.

## Verification performed

- Reviewed uncommitted changes in:
  - `src/frontend/app/api/actionbridge/execute/route.ts`
  - `src/frontend/lib/actionbridge/webhook-quarantine.ts`
  - `supabase/migrations/20260516011500_actionbridge_connector_quarantine.sql`
  - `scripts/test-actionbridge-behavioral-modules.mjs`
  - related docs/package changes
- Ran: `npm run check` — **PASS** (`npm test` + `git diff --check`).

## Findings by severity

### High — Quarantine lookup fails open in execute route

`getActiveActionBridgeConnectorQuarantine(...)` returns `{ quarantined: false, quarantine: null, error: 'ACTIONBRIDGE_CONNECTOR_QUARANTINE_LOOKUP_FAILED' }` on lookup error. The execute route checks only `activeQuarantine.quarantined`, ignores `activeQuarantine.error`, and can proceed to signing/throttle/delivery.

**Risk:** A database/RLS/schema/runtime error in the quarantine lookup disables the durable pause boundary and permits network delivery. For a safety control, this must fail closed.

**Required fix before production:** If quarantine lookup returns an error, block delivery with `networkExecution:false`, persist an error/control event, and return a safe failure summary such as `webhook_quarantine_lookup_failed`.

**Pilot condition:** Controlled pilot may continue only if operators understand this is not a production-grade kill-switch and active monitoring is in place.

### Medium — Quarantine persistence errors are swallowed

When process-local failure quarantine triggers, `persistActionBridgeWebhookFailureQuarantine(...)` can fail, but execute route assigns `durableQuarantine = persistedQuarantine.quarantine` and continues without surfacing/persisting a distinct durable-quarantine persistence failure.

**Risk:** Operators may see `quarantine_required` while durable state is actually absent (`durable:null`), creating a false sense that future deliveries are paused.

**Required fix:** If persistence fails, record a separate medium/high control error event and expose a redacted safe summary flag such as `durablePersistenceStatus:'failed'`. For production, consider failing connector execution closed until quarantine persistence succeeds or operator intervenes.

### Medium — Behavioral module test is useful but not sufficient proof

`test-actionbridge-behavioral-modules.mjs` executes the endpoint path normalizer, but most quarantine/execute/error lifecycle assertions are source/regex checks. It does not simulate Supabase lookup errors, active quarantine rows, persistence failures, or verify `deliverActionBridgeWebhook` is not called under real route execution.

**Risk:** Tests can pass while route behavior regresses around the exact safety properties Sentinel cares about.

**Required fix before production:** Add route/integration tests with mocked service client and webhook delivery covering:
- active quarantine blocks delivery with `networkExecution:false`;
- quarantine lookup error fails closed;
- repeated failures persist active quarantine;
- persistence failure is visible and audited;
- already-quarantined connector never calls delivery/signing-dependent network path.

### Medium — Operator resolve/review flow is not implemented here

Migration supports `active`/`resolved`, but there is no reviewed operator/customer-safe resolution API in this change, and RLS exposes only owner `SELECT`.

**Risk:** Durable pause can be created but not safely managed through an audited lifecycle.

**Required fix before production:** Add explicit review/resolve workflow with audit trail, compare-and-set status transition, reason/comment, and safe redacted customer-visible message.

### Low — Migration is mostly sound, but constraints could be tighter

Positive controls:
- owner-scoped composite FK to `actionbridge_connectors(id,user_id)`;
- one active quarantine per user/connector via partial unique index;
- RLS enabled;
- constrained status/reason values.

Residual hardening:
- add `CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))` or equivalent lifecycle invariant if desired;
- add `CHECK (jsonb_typeof(redacted_context) = 'object')` if only object contexts are intended;
- add/update timestamp trigger if manual `updated_at` drift matters.

### Low — Docs avoid major overclaiming

`docs/sentinel-production-blockers.md` correctly says an initial primitive exists and still requires integration proof. `docs/behavioral-test-roadmap.md` states current gates improve coverage but do not replace full route/integration tests. This is appropriately cautious.

## Security/control assessment

- **Execute route fail-closed:** Partial. Active quarantine blocks delivery, but lookup errors fail open. Production blocker.
- **Quarantine persistence semantics:** Partial. Durable upsert primitive exists, owner-scoped, redacted; persistence errors are not made operationally visible enough.
- **Migration RLS/constraints:** Acceptable for pilot. RLS enabled and owner SELECT exists; service role likely handles writes. Needs lifecycle/operator policies before production.
- **Secret/redaction exposure:** No raw signing secret observed in new summaries. Quarantine context is redacted on write and again on view. Destination origin/action name are acceptable low-sensitivity metadata.
- **Docs claims:** Acceptable; no broad production claim detected.

## Required fixes

### Before controlled pilot continuation

1. Document explicitly in pilot notes that durable quarantine lookup/persistence is not yet a production kill-switch.
2. Monitor for `durable:null` or quarantine persistence failure until surfaced as a first-class event.

### Before production/broad rollout

1. Make quarantine lookup errors fail closed before any network delivery.
2. Surface and audit durable quarantine persistence failures.
3. Add real route/integration tests for active quarantine, lookup failure, persistence failure, and no-delivery assertions.
4. Implement audited operator review/resolve lifecycle.
5. Add migration lifecycle constraints if compatible with the intended workflow.

## Final gate

**CONDITIONAL GO — controlled pilot may continue with narrow scope and monitoring.**

**NO-GO for production** until the fail-open lookup behavior and missing integration proof are fixed.

## Breaker follow-up — 2026-05-16 03:00

The High fail-open lookup finding above was addressed in this run:
- execute route now checks `activeQuarantine.error` before signing, throttle, or delivery resolution;
- lookup failure returns safe `webhook_quarantine_lookup_failed` with `networkExecution:false`;
- lookup failure persists a high-severity `ACTIONBRIDGE_CONNECTOR_QUARANTINE_LOOKUP_FAILED` error event;
- repeated-failure durable quarantine persistence failure is surfaced as `durablePersistenceStatus:'failed'` and persisted as high-severity `ACTIONBRIDGE_CONNECTOR_QUARANTINE_PERSIST_FAILED`.

`npm run check` passed after the follow-up change. Remaining production concerns are still route/integration proof and audited operator resolve/review workflow.
