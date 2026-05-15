# Sentinel Review — ActionBridge Behavioral Security Tests

**Date:** 2026-05-16
**Scope:** Uncommitted ActionBridge behavioral security test/docs changes, focused on endpoint path rejection, unresolved signing refs before network, and timeout/non-2xx failure persistence.

## Verdict

**GO for pilot evidence improvement.**

**NO-GO for claiming the production behavioral-test blocker fully closed.**

No Critical/High security blocker was introduced by this change set. However, the new behavioral test is a self-contained model of expected behavior rather than an integration test against the production route/lib functions, so it is not sufficient by itself to prove the production blocker is fully remediated.

## Evidence Reviewed

- `scripts/test-actionbridge-behavioral-security.mjs`
- `package.json` test script wiring
- `docs/production-readiness-checklist.md`
- `docs/sentinel-production-blockers.md`
- Existing implementation references in:
  - `src/frontend/app/api/actionbridge/connectors/route.ts`
  - `src/frontend/lib/actionbridge/webhook-signing.ts`
  - `src/frontend/app/api/actionbridge/execute/route.ts`

Verification run:

```bash
npm run test:behavioral-security
```

Result: passed.

## Findings

### 1. Endpoint path rejection behavior — PASS with caveat

The new test covers rejection/default behavior for:

- absolute URL override (`https://evil.test/hook`)
- scheme-relative URL (`//evil.test/hook`)
- query-bearing path (`/hook?token=secret`)
- hash-bearing path (`/hook#secret`)
- backslash path (`/hook\\evil`)
- relative segment normalization (`lead-submit` → `/lead-submit`)

This matches the current connector-route normalization logic and database CHECK intent.

**Caveat:** the test duplicates `normalizeActionBridgeWebhookEndpointPath()` instead of importing/exercising the production implementation or route. This can drift.

### 2. Unresolved signing refs before network — PASS with caveat

The test covers:

- explicit unsigned pilot mode permits no secret;
- HMAC with missing ref fails;
- HMAC with unresolved ref fails;
- resolved env-backed secret permits signing.

The production execute route checks `signingResolution.ok` before `decideActionBridgeWebhookDeliveryThrottle()` and before `deliverActionBridgeWebhook()`, so the implementation shape supports “unresolved signing ref blocks before network.”

**Caveat:** the behavioral test does not spy/mock `deliverActionBridgeWebhook()` to prove no network function is called. It validates a local resolver model only.

### 3. Timeout/non-2xx failure persistence — PASS with caveat

The test covers expected final behavior for:

- non-2xx webhook result;
- timeout/error-style result;
- rate-limit result.

It asserts fail-closed response, `deny` decision, failed execution persistence, and error-code/category/severity mapping.

**Caveat:** the test models `createExecutionPersistenceResult()` locally. It does not execute `execute/route.ts` or verify database persistence through `persistActionBridgeExecutionResult()` / `persistActionBridgeErrorEvent()`.

## Security Severity

| Severity | Finding | Status |
|---|---|---|
| Critical | None identified | Clear |
| High | None introduced by this change set | Clear |
| Medium | Behavioral test duplicates production logic and may create false confidence if implementation drifts | Open |
| Low | Docs mark checklist items complete more strongly than the current test evidence supports | Open |

## Required Follow-up Before Production GO

1. Replace or supplement local model tests with tests that import production functions where possible.
2. Add route/integration tests that prove:
   - rejected `endpoint_path` is rejected by connector creation/persistence path;
   - unresolved HMAC `secret_ref` does not call the webhook delivery/network function;
   - timeout/non-2xx delivery persists failed execution and error event through the real persistence boundary.
3. Keep production readiness wording as “behavioral model tests added” until integration evidence exists.

## Final Gate

- **Pilot:** GO
- **Production:** NO-GO until integration-level behavioral tests close the evidence gap
- **High/Critical blocker exists:** No
