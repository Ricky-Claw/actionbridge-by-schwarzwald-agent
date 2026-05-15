# Sentinel Error Hardening + Webhook Endpoint Path Review

**Date:** 2026-05-15  
**Reviewer:** Sentinel 🛡️  
**Scope:** error-log bounded context serialization, `/api/actionbridge/errors` PATCH status lifecycle, related tests, webhook `endpoint_path` migration, connector route, and execute-route webhook delivery usage.  
**Final Verdict:** **GO for controlled pilot continuation.** The previous two Medium findings are fixed. No Critical/High release blocker found in this reviewed scope.

## Final Recheck Evidence

Reviewed current working tree evidence:

- `src/frontend/app/api/actionbridge/connectors/route.ts`
- `src/frontend/app/api/actionbridge/errors/route.ts`
- `scripts/test-actionbridge-contracts.mjs`
- `scripts/test-actionbridge-security-gauntlet.mjs`

Verification run:

```bash
npm test
```

Result: **passed** — contracts, security gauntlet, DNS/IP guard, visibility sanitizer, and demo-flow checks all completed successfully.

Targeted checks:

- `normalizeActionBridgeWebhookEndpointPath()` now rejects query/hash before normalization:

```ts
if (candidate.includes('?') || candidate.includes('#')) return null;
```

- It still rejects absolute URLs, scheme-relative paths, and backslashes.
- `/api/actionbridge/errors` PATCH now performs compare-and-set status transition by including the previous status in the update predicate:

```ts
.eq('status', currentStatus)
```

- Failed/no-row status updates return `ACTIONBRIDGE_ERROR_STATUS_UPDATE_FAILED` with HTTP `409`, preventing stale concurrent transitions from silently downgrading state.
- Contract/security tests now include static regression guards for endpoint-path query/hash/backslash rejection and error status compare-and-set.

## Findings Recheck

### Previously Medium — `endpointPath` with query/hash was silently accepted and stripped

**Status:** **Fixed**

The connector route now fail-closes on candidates containing `?` or `#`. This aligns implementation with the invariant that webhook `endpoint_path` cannot be absolute, scheme-relative, query/hash-bearing, or backslash-bearing.

### Previously Medium — Error status PATCH transition was not atomic

**Status:** **Fixed**

The service-role update is now scoped by `user_id`, `id`, and `status = currentStatus`, making the lifecycle update compare-and-set guarded. Concurrent stale updates should receive `409` instead of overwriting a newer status.

## Positive Controls Confirmed

- Auth is required for GET/PATCH error log routes and connector/execute routes.
- Error log GET and PATCH are owner-scoped with `.eq('user_id', user!.id)`.
- Service-role writes still include owner filters; no cross-tenant update path found.
- Error log status normalization only permits `open`, `acknowledged`, `resolved`; PATCH refuses client-driven `open`.
- Allowed transitions are forward-only in normal single-request flow: `open -> acknowledged/resolved`, `acknowledged -> resolved`.
- Status changes are control-audited with `error_log.status_changed` and redacted input/result summaries.
- Error context serialization is bounded by max depth, key count, array items, and string length; circular references become `[circular]`.
- Error contexts are passed through ActionBridge redaction both on persist and on view serialization.
- Error log migration has RLS enabled and owner-select policy; table relationships use `(id, user_id)` composite ownership constraints.
- `endpoint_path` migration adds a relative-path CHECK constraint blocking scheme, `//`, backslash, query, and hash at database level.
- Execute route uses server-owned `webhookConnector.endpoint_path`; caller body path does not control webhook delivery destination.
- Raw idempotency keys are not returned in execute responses; digest-only handling remains intact.

## Residual Notes

- Current tests for these two specific fixes are still mostly source-token/static regression checks rather than runtime behavioral race/request tests. They are acceptable for the present pilot gate but should be upgraded before production hardening.
- A DB RPC for error lifecycle transitions remains a cleaner future control if this path becomes operationally critical.

## Gate Recommendation

**GO for controlled pilot continuation.**

Production hardening should still add behavioral endpoint-path rejection tests and a concurrency test/RPC-backed lifecycle transition, but the previously blocking Medium issues are addressed in the current working tree.
