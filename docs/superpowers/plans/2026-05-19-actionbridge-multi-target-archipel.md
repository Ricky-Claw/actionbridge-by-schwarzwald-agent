# ActionBridge Multi-Target Archipel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the ActionBridge multi-target connector MVP so one Schwarzwald-Agent tenant can register many URLs, track ownership/script status, and expose read-only tenant-scoped target tools.

**Architecture:** Add a focused multi-target registry module with URL normalization, tenant scoping, status classification, Archipel seed data, and read-only tool catalog helpers. Add a Supabase migration for durable target storage. Add behavioral tests that prove tenant isolation, dedupe, and script-status classification without network writes.

**Tech Stack:** Node 22 ESM test scripts, TypeScript source contracts, Supabase SQL migrations, existing ActionBridge guard modules.

---

## File Map

- Create `src/frontend/lib/actionbridge/multi-target-registry.ts`: pure server-only registry contracts/helpers for URL intake, status classification, tenant filtering, read-only tool catalog, and Archipel seed targets.
- Create `supabase/migrations/20260519143000_actionbridge_multi_target_registry.sql`: durable `actionbridge_targets` table with tenant/provider columns, target statuses, constraints, indexes, and RLS.
- Create `scripts/test-actionbridge-multi-target-registry.mjs`: behavioral source/module checks and runtime assertions.
- Modify `src/frontend/lib/actionbridge/types.ts`: add target/tenant/status types used by the module.
- Modify `scripts/test-actionbridge-contracts.mjs`: require the new module in the contract suite.
- Modify `package.json`: add `test:multi-target-registry` and include it in `npm test`.
- Modify docs/checklists only if gate status changes.

## Tasks

### Task 1: Add multi-target types

**Files:**
- Modify: `src/frontend/lib/actionbridge/types.ts`

- [x] Add ActionBridge provider/tenant/target status types and `ActionBridgeTarget` interface.

### Task 2: Add registry module

**Files:**
- Create: `src/frontend/lib/actionbridge/multi-target-registry.ts`

- [x] Implement HTTPS URL normalization, private host rejection, deterministic target ids, dedupe, status classification, tenant filter, read-only catalog, and Archipel seed.

### Task 3: Add durable schema

**Files:**
- Create: `supabase/migrations/20260519143000_actionbridge_multi_target_registry.sql`

- [x] Create `actionbridge_targets` with provider/tenant/user/URL/status fields, uniqueness per tenant+origin, status constraints, RLS, and indexes.

### Task 4: Add verification tests

**Files:**
- Create: `scripts/test-actionbridge-multi-target-registry.mjs`
- Modify: `package.json`
- Modify: `scripts/test-actionbridge-contracts.mjs`

- [x] Add checks for pilot seed, dedupe, invalid host rejection, status classification, tool catalog, and cross-tenant isolation.

### Task 5: Run gates

**Commands:**

```bash
npm run test:multi-target-registry
npm test
git diff --check
```

- [ ] Confirm all gates pass before reporting completion.

## Self-Review

- Spec coverage: registry, tenant isolation, bridge origin, pilot URLs, status model, and read-only tool catalog are covered.
- Placeholder scan: no TBD/TODO placeholders.
- Type consistency: names match the spec and new module exports.
