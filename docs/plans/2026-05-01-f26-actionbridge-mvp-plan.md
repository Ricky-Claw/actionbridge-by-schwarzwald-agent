# F26 ActionBridge MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first safe MVP slice of ActionBridge: typed actions, policy decision, approval queue contract, audit contract, and internal execution API skeleton.

**Architecture:** Start with testable TypeScript domain modules under `src/frontend/lib/actionbridge/`, then expose minimal Next API routes under `src/frontend/app/api/actionbridge/`. Keep secrets server-only, policy fail-closed, writes approval-gated by default. UI can come after backend/domain gates pass.

**Tech Stack:** Next.js App Router, TypeScript, Supabase server client, existing contract-script pattern, no new external dependencies.

---

## File Map

- Create `src/frontend/lib/actionbridge/types.ts` — shared action/connector/policy/audit types.
- Create `src/frontend/lib/actionbridge/policy.ts` — deterministic policy decision engine.
- Create `src/frontend/lib/actionbridge/redaction.ts` — secret/PII redaction helpers.
- Create `src/frontend/lib/actionbridge/http-connector.ts` — safe HTTP action execution adapter skeleton.
- Create `src/frontend/app/api/actionbridge/execute/route.ts` — internal execution endpoint.
- Create `src/frontend/app/api/actionbridge/actions/route.ts` — list/create action definitions.
- Create `src/frontend/app/api/actionbridge/approvals/route.ts` — approval listing.
- Create `scripts/test-actionbridge-contracts.mjs` — static/security contract gate.
- Add docs to `features/F26-actionbridge/README.md` as source-of-truth feature note.

## Task 1: Domain Types + Contract Gate

**Files:**
- Create: `src/frontend/lib/actionbridge/types.ts`
- Create: `scripts/test-actionbridge-contracts.mjs`

- [ ] Step 1: Write `scripts/test-actionbridge-contracts.mjs` asserting required type names, risk levels, policy decisions, and no client secret fields.
- [ ] Step 2: Run `node scripts/test-actionbridge-contracts.mjs`; expected FAIL because files do not exist.
- [ ] Step 3: Implement `types.ts` with `ActionBridgeRiskLevel`, `ActionBridgeDecision`, `ActionBridgeActionDefinition`, `ActionBridgeConnector`, `ActionBridgeAuditEvent`.
- [ ] Step 4: Run contract script; expected PASS for type existence.
- [ ] Step 5: Commit `feat: add actionbridge domain contracts`.

## Task 2: Policy Decision Engine

**Files:**
- Create: `src/frontend/lib/actionbridge/policy.ts`
- Modify: `scripts/test-actionbridge-contracts.mjs`

- [ ] Step 1: Extend contract script to assert writes/transactional/destructive actions are not default-allowed.
- [ ] Step 2: Run script; expected FAIL.
- [ ] Step 3: Implement `decideActionBridgePolicy()` returning `allow`, `deny`, or `approval_required`.
- [ ] Step 4: Run script; expected PASS.
- [ ] Step 5: Commit `feat: add actionbridge policy engine`.

## Task 3: Redaction + Safe HTTP Connector Skeleton

**Files:**
- Create: `src/frontend/lib/actionbridge/redaction.ts`
- Create: `src/frontend/lib/actionbridge/http-connector.ts`
- Modify: `scripts/test-actionbridge-contracts.mjs`

- [ ] Step 1: Add contract checks for sensitive key redaction (`apiKey`, `authorization`, `clientSecret`, `password`, `token`).
- [ ] Step 2: Add contract checks that connector code refuses browser execution and does not expose `secretValue` in returned payloads.
- [ ] Step 3: Implement `redactActionBridgeValue()` and `executeHttpActionConnector()` skeleton with fail-closed validation.
- [ ] Step 4: Run contract script and frontend typecheck.
- [ ] Step 5: Commit `feat: add safe actionbridge http connector`.

## Task 4: Minimal API Routes

**Files:**
- Create: `src/frontend/app/api/actionbridge/actions/route.ts`
- Create: `src/frontend/app/api/actionbridge/execute/route.ts`
- Create: `src/frontend/app/api/actionbridge/approvals/route.ts`
- Modify: `scripts/test-actionbridge-contracts.mjs`

- [ ] Step 1: Add route contract checks: auth required, service/server client only, execute route calls policy, approval route exists.
- [ ] Step 2: Implement routes fail-closed with stubbed persistence until DB migration task.
- [ ] Step 3: Run contract script, frontend typecheck.
- [ ] Step 4: Commit `feat: add actionbridge api route skeleton`.

## Task 5: DB Migration + Audit/Approval Persistence

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_actionbridge_core.sql`
- Modify API routes to persist actions/audit/approvals.
- Modify `docs/DATABASE_SCHEMA.md` if schema doc exists and is current.

- [ ] Step 1: Create migration with tenant/user scoped tables and RLS.
- [ ] Step 2: Add contract checks for RLS/policies/table names.
- [ ] Step 3: Wire API routes to Supabase with authenticated user scope.
- [ ] Step 4: Run contract script, frontend typecheck, Supabase migration check if available.
- [ ] Step 5: Quinn + Dante review before push.

## Task 6: Demo Action

**Files:**
- Add seed/demo fixture or local mock in tests only.

- [ ] Step 1: Add demo `find_product` read action and `request_quote` write action contract.
- [ ] Step 2: Verify read can be allowed; write becomes approval by default.
- [ ] Step 3: Commit `feat: add actionbridge demo action contracts`.

## Verification Bundle

Run before any completion claim:

```bash
node scripts/test-actionbridge-contracts.mjs
cd src/frontend && npm run type-check -- --pretty false
cd ../backend && npm run typecheck
git diff --check
```

## Review Gate

Before push:
- Quinn QA review.
- Dante risk/security review.
- Fix Critical/High findings.
