# Nexus Review — Webhook Secret Rotation Slice (2026-05-24 03:00)

## Verdict
**NO-GO for closing the production Blocker 4 / operator-rotation gate as complete.**

The slice is directionally clean for a controlled pilot: it is owner-scoped, dry-run by default, validates server-owned ref shape, resolves the next ref before update, avoids raw secret values, and updates only `webhook_signing_mode` + `secret_ref` on apply.

However, it is not yet a complete connector-control production slice because the write path is only browser-session authenticated and confirmation-header gated. It lacks an explicit Sentinel/control-plane authorization policy and complete audit coverage for attempted rotations.

## Blockers
1. **Control-plane write lacks Sentinel policy / approval binding.**
   - `POST /api/actionbridge/ops/webhook-secret-rotation` performs a service-role update of connector signing state after owner auth + `X-ActionBridge-Rotation-Confirm`.
   - There is no role/operator check, no step-up, no ActionBridge approval object, and no named Sentinel policy reference enforced in code.
   - Per Nexus/ActionBridge rules, connector control writes must be typed, scoped, auditable, and policy-backed; this is scoped but not policy-backed enough.

2. **Audit is incomplete for a rotation workflow.**
   - The route writes `webhook_signing_secret.rotated` only after a successful apply.
   - Dry-runs, invalid refs, unresolved refs, digest mismatches, missing confirmation, and failed updates are not persisted as control audit events.
   - For a secret-rotation control plane, denied/failed attempts are material and should be durable/auditable.

3. **Service-client failure handling is inconsistent with implementation.**
   - `createCoreServiceClient()` throws when required env is missing; it does not return `null`.
   - The route checks `if (!serviceSupabase)` but does not catch thrown env errors, so missing service env can become an unnormalized 500 rather than the documented `ACTIONBRIDGE_WEBHOOK_ROTATION_FAILED`/503 path.

## API / Persistence / Docs Consistency
- **API:** Mostly coherent: accepts `connectorId`/`connector_id`, `nextSecretRef`/`next_secret_ref`, `expectedCurrentDigest`/`expected_current_digest`, `dryRun`; apply requires `x-actionbridge-rotation-confirm: apply-webhook-signing-ref`.
- **Persistence:** Connector update is narrow and owner-scoped. Audit persistence uses existing `actionbridge_audit_logs`; because that table has no `connector_id` column, connector linkage only survives inside `resultSummary`, not as an indexed audit dimension.
- **Docs:** The spec and checklist now describe an operator workflow. That is currently over-stated: the route is authenticated owner-scoped, but not yet an operator/admin or Sentinel-approved workflow. The checklist should not mark the gate complete until policy/audit gaps are closed.

## Standalone Slice Assessment
**Not yet a clean standalone ActionBridge connector-control slice.** It is a useful pilot endpoint, but connector-control writes need explicit policy references and durable audit for all outcomes before this can be considered standalone and production-ready.

## Verification Performed
- Inspected uncommitted route, spec/checklist changes, and contract-test additions.
- Ran `node scripts/test-actionbridge-contracts.mjs` successfully through the visible contract checks; no failing output observed.

## Recommended Fixes
1. Add a Sentinel/control-plane authorization check for `webhook_signing_secret.rotate` before apply.
2. Persist control audit events for dry-run, denied, failed, unresolved, mismatch, and confirmation-required outcomes.
3. Wrap service-client creation/update in normalized error handling.
4. Update docs/checklist to say “pilot operator route added” until the policy/audit gates are implemented.
