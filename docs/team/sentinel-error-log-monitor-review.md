# Sentinel Review — ActionBridge Error Log / Failure Monitor

**Date:** 2026-05-15  
**Reviewer:** Sentinel 🛡️  
**Scope:** `20260515000400_actionbridge_error_logs.sql`, error-log persistence, `/api/actionbridge/errors`, execute-route wiring, failures page, contract/security tests.

## Verdict

**GO for controlled pilot, with follow-up hardening before broader production rollout.**

The implementation is owner-scoped, RLS-protected, service-written, and intentionally redacted. I found no Critical or High blocker in the reviewed error log / failure monitor path.

## What passed

- **Auth/RLS:** `/api/actionbridge/errors` requires `supabase.auth.getUser()` and filters by `.eq('user_id', user!.id)`. The table has RLS enabled and owner-only `SELECT` policy.
- **No direct user mutations:** Migration only grants an owner `SELECT` policy; authenticated clients cannot directly insert/update/delete error logs through RLS.
- **Owner scoping:** Error logs carry `user_id`; API, service writes, and composite FKs preserve tenant isolation.
- **FK safety:** `connector_id`, `execution_id`, and `approval_id` are tied to `(id, user_id)` composite references, preventing cross-owner linkage. Referenced tables already expose `UNIQUE (id, user_id)`.
- **No raw idempotency keys:** Execute response returns `sha256:<16 hex>` digest only; error contexts do not include the raw idempotency key.
- **Secrets/tokens:** Error visibility route does not select connector secret fields, token digests, or idempotency keys. Error persistence applies `redactActionBridgeValue()` before insert and again before API view serialization.
- **Severity/category model:** DB-level checks constrain severity to `info|low|medium|high|critical` and category to `setup|verification|approval|execution|webhook|rate_limit|system`.
- **Execution wiring:** Approval-not-executable, webhook failures/rate limits, and failed persisted executions create redacted error events.
- **Pilot tests:** `node scripts/test-actionbridge-contracts.mjs && node scripts/test-actionbridge-security-gauntlet.mjs` passed.

## Findings / follow-ups

### Medium — Redacted context has no explicit size/depth/circular guard

`persistActionBridgeErrorEvent()` redacts arbitrary `context`, but there is no local cap on JSON size, recursion depth, array length, or circular objects. Today the call sites appear bounded and internal, so this is **not a pilot blocker**, but before production it should fail closed or sanitize to a bounded object.

**Recommendation:** add a bounded safe serializer for error context, e.g. max depth, max keys/items, max string length, and circular detection before insert.

### Low — Error status lifecycle is documented but not operable yet

The table supports `open|acknowledged|resolved`, but the reviewed API exposes only `GET`; there is no owner/admin route to acknowledge or resolve events. This is acceptable for failure visibility in a controlled pilot, but limits operational workflow.

**Recommendation:** add a narrowly scoped status-update endpoint with owner check, audit event, and allowed transitions only.

### Low — Retention policy is not explicit

`ON DELETE CASCADE` handles user deletion, but there is no time-based retention or minimization policy for operational error logs.

**Recommendation:** define retention for resolved logs and document GDPR operational log handling before production.

## Controlled pilot acceptance gates

Pilot may proceed if these remain true:

1. Error logs are written only server-side/service-side from authenticated owner context.
2. No customer-system testing occurs without explicit authorization.
3. High/Critical error events block rollout decisions until reviewed.
4. Error contexts stay redacted and bounded by trusted internal call sites.
5. No raw tokens, connector secrets, setup tokens, idempotency keys, or unredacted PII are added to future error contexts.

## Final decision

**GO — controlled pilot only.**  
No Critical/High release blocker found for the current Error Log / Failure Monitor implementation. Production readiness requires bounded context serialization, status lifecycle controls, and retention policy.