# ActionBridge Embedded Setup Plugin UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build ActionBridge as an embedded setup-plugin experience with customer-safe wizard state and a separate operator control model.

**Architecture:** Add a small UX contract layer first: status vocabulary, host theme tokens, and connector wizard descriptors. Then shape existing setup/connectors/tool-catalog APIs around that safe contract before adding UI components. Keep customer-facing setup separate from operator-only audit/error/kill-switch surfaces.

**Tech Stack:** Next.js route handlers, TypeScript server-only ActionBridge modules, Supabase-backed connector state, existing contract/security test scripts.

---

## File Structure

- Create: `src/frontend/lib/actionbridge/embedded-setup-ux.ts` — status vocabulary, theme tokens, step descriptors, connector setup descriptors.
- Modify: `src/frontend/app/api/actionbridge/setup-session/route.ts` — include embedded setup UX metadata without secrets.
- Modify: `src/frontend/app/api/actionbridge/connectors/route.ts` — ensure serialized connector response maps to wizard status and connector-specific setup hints.
- Create: `docs/specs/actionbridge-embedded-setup-plugin.md` — product-facing concise spec derived from approved design.
- Modify: `scripts/test-actionbridge-contracts.mjs` — contract markers for embedded setup UX, secret safety, WhatsApp setup hints, and operator/customer split.

## Task 1: Add Embedded Setup UX Contract Module

**Files:**
- Create: `src/frontend/lib/actionbridge/embedded-setup-ux.ts`
- Modify: `scripts/test-actionbridge-contracts.mjs`

- [ ] **Step 1: Write contract test markers**

Add `src/frontend/lib/actionbridge/embedded-setup-ux.ts` to `requiredFiles` in `scripts/test-actionbridge-contracts.mjs`.

Add this contract block near other ActionBridge module checks:

```js
if (exists('src/frontend/lib/actionbridge/embedded-setup-ux.ts')) {
  const embeddedUx = read('src/frontend/lib/actionbridge/embedded-setup-ux.ts');
  for (const token of [
    'ActionBridgeEmbeddedSetupStatus',
    'draft',
    'waiting',
    'connected',
    'needs_attention',
    'paused',
    'ActionBridgeHostThemeTokens',
    'createActionBridgeEmbeddedSetupDescriptor',
    'connector.choose',
    'values.enter',
    'permissions.choose',
    'connection.test',
    'connector.activate',
    'operatorOnly: false',
  ]) {
    if (!embeddedUx.includes(token)) fail(`embedded setup UX contract missing ${token}`);
  }
  if (embeddedUx.includes('secret_ref') || embeddedUx.includes('token_digest') || embeddedUx.includes('idempotency_key')) fail('embedded setup UX contract must not expose secret/internal fields');
  if (!process.exitCode) pass('Embedded setup UX contract defines customer-safe wizard state');
}
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm run test:contracts
```

Expected: FAIL because `embedded-setup-ux.ts` does not exist or markers are missing.

- [ ] **Step 3: Create minimal implementation**

Create `src/frontend/lib/actionbridge/embedded-setup-ux.ts`:

```ts
import 'server-only';

import type { ActionBridgeConnector } from './types';

export type ActionBridgeEmbeddedSetupStatus = 'draft' | 'waiting' | 'connected' | 'needs_attention' | 'paused';

export interface ActionBridgeHostThemeTokens {
  brandName?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  cardColor?: string;
  borderColor?: string;
  density?: 'compact' | 'comfortable';
  language?: 'de' | 'en';
}

export interface ActionBridgeEmbeddedSetupStep {
  id: 'connector.choose' | 'values.enter' | 'authorization.verify' | 'permissions.choose' | 'connection.test' | 'connector.activate';
  label: string;
  operatorOnly: false;
}

export interface ActionBridgeEmbeddedSetupDescriptor {
  version: 'actionbridge.embedded_setup.v1';
  status: ActionBridgeEmbeddedSetupStatus;
  theme: ActionBridgeHostThemeTokens;
  steps: ActionBridgeEmbeddedSetupStep[];
  connectorType?: ActionBridgeConnector['type'];
  customerControls: Array<'pause' | 'remove' | 'retry'>;
  operatorControlsExcluded: true;
}

export function mapActionBridgeConnectorToEmbeddedStatus(input: Pick<ActionBridgeConnector, 'enabled' | 'networkExecutionEnabled' | 'safetyStatus' | 'permissionStatus'>): ActionBridgeEmbeddedSetupStatus {
  if (input.permissionStatus === 'paused' || input.enabled === false) return 'paused';
  if (input.safetyStatus === 'fail' || input.permissionStatus === 'revoked') return 'needs_attention';
  if (input.permissionStatus === 'active' && input.safetyStatus === 'pass' && input.networkExecutionEnabled === true) return 'connected';
  if (input.permissionStatus === 'active' || input.safetyStatus === 'pass') return 'waiting';
  return 'draft';
}

export function createActionBridgeEmbeddedSetupDescriptor(input: {
  connector?: Pick<ActionBridgeConnector, 'type' | 'enabled' | 'networkExecutionEnabled' | 'safetyStatus' | 'permissionStatus'>;
  theme?: ActionBridgeHostThemeTokens;
} = {}): ActionBridgeEmbeddedSetupDescriptor {
  const status = input.connector ? mapActionBridgeConnectorToEmbeddedStatus(input.connector) : 'draft';
  return {
    version: 'actionbridge.embedded_setup.v1',
    status,
    theme: {
      density: 'compact',
      language: 'de',
      ...(input.theme || {}),
    },
    steps: [
      { id: 'connector.choose', label: 'Connector auswählen', operatorOnly: false },
      { id: 'values.enter', label: 'Werte eintragen', operatorOnly: false },
      { id: 'authorization.verify', label: 'Autorisierung prüfen', operatorOnly: false },
      { id: 'permissions.choose', label: 'Berechtigungen wählen', operatorOnly: false },
      { id: 'connection.test', label: 'Verbindung testen', operatorOnly: false },
      { id: 'connector.activate', label: 'Aktivieren', operatorOnly: false },
    ],
    connectorType: input.connector?.type,
    customerControls: ['pause', 'remove', 'retry'],
    operatorControlsExcluded: true,
  };
}
```

- [ ] **Step 4: Run test to verify pass**

Run:

```bash
npm run test:contracts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/lib/actionbridge/embedded-setup-ux.ts scripts/test-actionbridge-contracts.mjs
git commit -m "feat: define embedded setup ux contract"
```

## Task 2: Add Embedded UX Metadata To Safe API Responses

**Files:**
- Modify: `src/frontend/app/api/actionbridge/connectors/route.ts`
- Modify: `src/frontend/app/api/actionbridge/setup-session/route.ts`
- Modify: `scripts/test-actionbridge-contracts.mjs`

- [ ] **Step 1: Write contract checks**

Add route markers to `scripts/test-actionbridge-contracts.mjs`:

```js
if (exists('src/frontend/app/api/actionbridge/connectors/route.ts')) {
  const connectorsRoute = read('src/frontend/app/api/actionbridge/connectors/route.ts');
  if (!connectorsRoute.includes('createActionBridgeEmbeddedSetupDescriptor')) fail('connectors route must expose embedded setup descriptor');
  if (!connectorsRoute.includes('embeddedSetup')) fail('connectors route must include embeddedSetup response field');
}

if (exists('src/frontend/app/api/actionbridge/setup-session/route.ts')) {
  const setupSessionRoute = read('src/frontend/app/api/actionbridge/setup-session/route.ts');
  if (!setupSessionRoute.includes('createActionBridgeEmbeddedSetupDescriptor')) fail('setup-session route must include embedded setup descriptor');
  if (!setupSessionRoute.includes('embeddedSetup')) fail('setup-session route must return embeddedSetup metadata');
  if (setupSessionRoute.includes('secret_ref') || setupSessionRoute.includes('token_digest')) fail('setup-session route must not expose secrets or token digests');
}
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm run test:contracts
```

Expected: FAIL until route metadata is added.

- [ ] **Step 3: Add connector route metadata**

In `src/frontend/app/api/actionbridge/connectors/route.ts`, import:

```ts
import { createActionBridgeEmbeddedSetupDescriptor } from '@/lib/actionbridge/embedded-setup-ux';
```

Inside `serializeActionBridgeConnector`, add:

```ts
embeddedSetup: createActionBridgeEmbeddedSetupDescriptor({
  connector: {
    type: connector.type,
    enabled: connector.enabled,
    networkExecutionEnabled: connector.network_execution_enabled === true,
    safetyStatus: connector.safety_status,
    permissionStatus: connector.permission_status,
  },
}),
```

- [ ] **Step 4: Add setup-session route metadata**

Import `createActionBridgeEmbeddedSetupDescriptor` in `src/frontend/app/api/actionbridge/setup-session/route.ts` and add a top-level response field:

```ts
embeddedSetup: createActionBridgeEmbeddedSetupDescriptor(),
```

Only include the descriptor, not connector secrets or internal rows.

- [ ] **Step 5: Run full tests**

Run:

```bash
npm test && git diff --check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/frontend/app/api/actionbridge/connectors/route.ts src/frontend/app/api/actionbridge/setup-session/route.ts scripts/test-actionbridge-contracts.mjs
git commit -m "feat: expose embedded setup metadata"
```

## Task 3: Add Product Spec And Keep Boundaries Honest

**Files:**
- Create: `docs/specs/actionbridge-embedded-setup-plugin.md`
- Modify: `docs/production-readiness-checklist.md`
- Modify: `scripts/test-actionbridge-contracts.mjs`

- [ ] **Step 1: Add contract test for spec**

Add:

```js
if (exists('docs/specs/actionbridge-embedded-setup-plugin.md')) {
  const embeddedSpec = read('docs/specs/actionbridge-embedded-setup-plugin.md');
  for (const token of ['Embedded Setup Plugin', 'not a standalone dashboard', 'Host Theme Tokens', 'Customer Wizard', 'Operator Surface', 'No raw secrets']) {
    if (!embeddedSpec.includes(token)) fail(`embedded setup plugin spec missing ${token}`);
  }
  if (!process.exitCode) pass('Embedded setup plugin spec documents UX boundary');
} else fail('Missing embedded setup plugin spec');
```

- [ ] **Step 2: Create concise spec**

Create `docs/specs/actionbridge-embedded-setup-plugin.md` from the approved design with these sections:

```md
# ActionBridge Embedded Setup Plugin

## Purpose
ActionBridge is an embedded connector setup plugin, not a standalone dashboard.

## Customer Wizard
Choose connector → enter values → verify authorization → choose permissions → test → activate.

## Host Theme Tokens
Brand/logo/color/density/language tokens allow Schwarzwald-Agent native appearance and later white-label embedding.

## Operator Surface
Audit, errors, safety status, network execution, secret-ref status, pause/kill switch stay operator-only.

## No raw secrets
Customer-facing setup must never expose raw secrets, token digests, idempotency keys, service-role data, or internal audit rows.
```

- [ ] **Step 3: Update readiness checklist**

In `docs/production-readiness-checklist.md`, under Product Boundary add:

```md
- [x] Embedded setup-plugin UX boundary documented.
- [ ] Embedded setup wizard UI implemented.
```

- [ ] **Step 4: Run tests**

```bash
npm test && git diff --check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/specs/actionbridge-embedded-setup-plugin.md docs/production-readiness-checklist.md scripts/test-actionbridge-contracts.mjs
git commit -m "docs: define embedded setup plugin ux"
```

## Final Verification

Run:

```bash
npm test && git diff --check
git log --oneline -5
```

Expected:
- all tests pass;
- no whitespace errors;
- recent commits show embedded setup UX contract/spec work.

## Deployment / Rollout Note

This plan does not enable live WhatsApp sends or production network execution. It only makes the setup experience embeddable and safer to expose as a customer-facing plugin surface.
