# Nexus Review — Behavioral Security Tests

Result: **NO-GO for claiming the checked production-readiness items are satisfied.**

## Scope reviewed
- `scripts/test-actionbridge-behavioral-security.mjs`
- `package.json` test wiring
- `docs/production-readiness-checklist.md`
- `docs/sentinel-production-blockers.md`

## Verification run
- `npm run test:behavioral-security` ✅ passed

## Findings

### 1. Behavioral test script is mostly a shadow implementation, not production behavior
The new script redefines local copies of these behaviors instead of importing/exercising the production code or API routes:
- endpoint-path normalization
- delivery-path hardening
- webhook signing-secret resolution
- webhook failure persistence mapping

That catches the intended policy shape, but it can pass even if production code regresses. For a production blocker explicitly saying “marker tests are not enough,” this is still too close to marker/spec-model testing unless backed by route-level or exported production-function tests.

### 2. Docs currently overclaim readiness reduction
The docs mark these as complete:
- Behavioral endpoint path rejection tests
- Behavioral timeout/non-2xx persistence tests
- unresolved signing ref blocks before network

Given the script does not call the connector route, execute route, Supabase persistence path, or webhook delivery path, these should be presented as **spec-model behavioral coverage added** rather than completed production behavioral proof.

### 3. Package wiring is correct
`test:behavioral-security` is wired into `npm test` in the right order and the standalone script exits non-zero on failures. No issue there.

## Recommendation
GO only after one of these is done:
1. Preferable: refactor small pure production functions into importable modules and have this test import them directly.
2. Stronger: add route/integration tests that exercise connector creation rejection and execute-route failure persistence with mocked network/Supabase.
3. Minimal: keep the script, but change docs back to unchecked/partial wording so it does not claim the blocker is closed.

## Bottom line
This change **does reduce risk directionally** and is useful as a guardrail, but it **does not yet close the production behavioral-test blocker** because it verifies duplicated expected behavior rather than the actual production execution path.
