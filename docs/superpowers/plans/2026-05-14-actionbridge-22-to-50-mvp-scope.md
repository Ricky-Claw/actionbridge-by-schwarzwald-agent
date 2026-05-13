# ActionBridge 22% → 50% MVP Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move ActionBridge from ~22% concept/technical foundation to ~50% sellable MVP foundation: dashboard-ready setup links, customer verification, bridge script/plugin v1, capability registration, policy-bound tool catalog, and first end-to-end Schwarzwald-Agent integration contract.

**Architecture:** ActionBridge remains the connector/translation/execution-control layer between Schwarzwald-Agent agents and customer-approved websites/apps/backends. Schwarzwald-Agent owns chatbots, assistants, and automations; ActionBridge exposes verified, tenant-scoped, policy-bound tools they can use. Every build phase requires Nexus architecture/build review and Sentinel security review before progressing.

**Tech Stack:** Next.js API routes, Supabase/RLS migrations, ActionBridge TypeScript libs, bridge script/plugin contract, contract/security test scripts, Nexus/Sentinel subagent review gates.

---

## Current Baseline: ~22%

Already done:
- Universal Connector OS north-star documented.
- ActionBridge vs Schwarzwald-Agent boundary clarified.
- Connector tables/actions/approvals/audit foundation exists.
- Setup profile and widget tool catalog exist.
- Domain verification foundation exists: human attestation, `.well-known`, meta tag, DNS TXT.
- Read-only execution gate exists behind strict controls.
- Core tests exist: contracts, security gauntlet, DNS/IP guard, visibility sanitizer.

Known review debt:
- Nexus/Sentinel review of domain verification commit is pending.
- Automatic enabling of `network_execution_enabled=true` after verification may be too aggressive and must be reviewed.
- Bridge script/plugin v1 does not exist yet.
- Dashboard/customer setup-link flow does not exist yet.
- Action/rule configuration UI/API does not exist yet.
- End-to-end Schwarzwald-Agent tool-consumption contract is not implemented.

---

## 50% MVP Definition

ActionBridge reaches ~50% when this end-to-end demo works in a controlled environment:

1. Ricky/operator creates a setup link from a dashboard-ready API.
2. Customer opens setup link and verifies a domain via meta tag, DNS TXT, or `.well-known`.
3. Customer receives a one-line bridge script/plugin install snippet.
4. Bridge script handshakes with ActionBridge and marks the site connected.
5. Customer/operator enables a small set of allowed capabilities/rules.
6. ActionBridge compiles those capabilities into agent-safe JSON tools.
7. Schwarzwald-Agent can fetch the tool catalog for that tenant/site.
8. At least two safe capabilities work end-to-end:
   - `knowledge.public.read` or `site.content.read` as read-only.
   - `lead.prepare_draft` or `appointment.request.prepare_draft` as draft/approval-gated.
9. Every action has audit, redaction, tenant scoping, kill-switch, and Sentinel-approved policy.

This is not yet 100% product-market-ready. It is the first demoable, customer-understandable, 100k€-target MVP foundation.

---

## Workstream A — Review/Fix Current Verification Slice

**Owner:** Breaker coordinates. Nexus reviews architecture/product fit. Sentinel reviews security. Nexus implements fixes only after Sentinel gates.

**Files likely touched:**
- `src/frontend/lib/actionbridge/domain-verification.ts`
- `src/frontend/app/api/actionbridge/connectors/verify/route.ts`
- `supabase/migrations/20260514001000_actionbridge_domain_verification.sql`
- `scripts/test-actionbridge-contracts.mjs`
- `scripts/test-actionbridge-security-gauntlet.mjs`

- [ ] **Step A1: Collect Nexus and Sentinel review results**

Expected review focus:
- Whether verification should automatically set `network_execution_enabled=true`.
- Whether token replay/expiry/rate limits/audit are strong enough.
- Whether DNS TXT and meta verification need response limits and DNS/IP guards.
- Whether human attestation should be read-only only.

- [ ] **Step A2: Fix all Critical/High/Important review findings**

Minimum expected likely fix:
- Domain verification should set `permission_status='active'` and `safety_status='pass'`, but **not automatically enable broad execution**.
- Prefer capability-specific enabling: `network_execution_enabled` only for read-only after explicit policy gate.

- [ ] **Step A3: Add/extend tests for review findings**

Run:
```bash
node scripts/test-actionbridge-contracts.mjs
node scripts/test-actionbridge-security-gauntlet.mjs
node scripts/test-actionbridge-dns-ip-guard.mjs
node scripts/test-actionbridge-visibility-sanitizer.mjs
git diff --check
```
Expected: all pass.

- [ ] **Step A4: Commit review fixes**

```bash
git add src/frontend/lib/actionbridge src/frontend/app/api/actionbridge supabase/migrations scripts
git commit -m "fix: harden actionbridge domain verification gates"
```

---

## Workstream B — Dashboard Setup Link Foundation

**Goal:** Create the backend contract Ricky/Schwarzwald-Agent dashboard can call to generate customer setup links.

**Files:**
- Create: `src/frontend/lib/actionbridge/setup-links.ts`
- Create: `src/frontend/app/api/actionbridge/setup-links/route.ts`
- Create migration: `supabase/migrations/YYYYMMDDHHMMSS_actionbridge_setup_links.sql`
- Modify: `scripts/test-actionbridge-contracts.mjs`

**Data model:** `actionbridge_setup_links`
- `id UUID`
- `user_id UUID`
- `connector_id UUID NULL`
- `token_digest TEXT NOT NULL`
- `status TEXT CHECK ('pending','opened','completed','revoked','expired')`
- `target_origin TEXT NOT NULL`
- `allowed_methods JSONB NOT NULL DEFAULT '["meta_tag","dns_txt","well_known"]'`
- `expires_at TIMESTAMPTZ NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`

- [ ] **Step B1: Nexus architecture review before build**

Nexus must confirm:
- setup link belongs in ActionBridge, not Schwarzwald-Agent repo yet;
- dashboard integration contract shape;
- no UI required in this repo for MVP backend slice.

- [ ] **Step B2: Sentinel security review before build**

Sentinel must confirm:
- token digest-only storage;
- expiry and revocation;
- no tenant id from caller;
- service role only for writes;
- customer link cannot access secrets or other tenants.

- [ ] **Step B3: Implement setup link generator**

`setup-links.ts` responsibilities:
- generate token `absl_...`;
- digest token with SHA-256;
- normalize HTTPS origin;
- reject private/internal origins;
- return public setup URL path only, not secrets.

- [ ] **Step B4: Implement auth-gated route**

`POST /api/actionbridge/setup-links`
- requires dashboard/operator auth via current Supabase user;
- accepts `{ targetOrigin, connectorId? }`;
- stores digest;
- returns `{ setupLink: { id, url, expiresAt } }` with raw token only once.

`GET /api/actionbridge/setup-links`
- lists current user setup links without token digests.

- [ ] **Step B5: Add contract/security tests**

Tests must assert:
- route exists and requires `auth.getUser`;
- stores `token_digest`, never raw token;
- rejects `http://`, `localhost`, `.local`, userinfo URLs;
- supports revoke/expire statuses in migration;
- RLS owner SELECT only.

- [ ] **Step B6: Verify and commit**

Run standard gates and commit:
```bash
git commit -m "feat: add actionbridge customer setup links"
```

---

## Workstream C — Customer Setup Session Contract

**Goal:** Let customer open setup link, see verification/install instructions, and complete setup without operator manually touching database.

**Files:**
- Create: `src/frontend/lib/actionbridge/setup-session.ts`
- Create: `src/frontend/app/api/actionbridge/setup-session/route.ts`
- Modify: `scripts/test-actionbridge-contracts.mjs`

- [ ] **Step C1: Nexus reviews session contract**

Confirm endpoint shape for future Ricky dashboard/customer page:
- `GET /api/actionbridge/setup-session?token=...`
- `POST /api/actionbridge/setup-session` for customer choices.

- [ ] **Step C2: Sentinel reviews public-token endpoint risks**

Must require:
- token digest lookup;
- expiry check;
- no user/tenant secrets;
- rate-limit placeholder/gate;
- redacted outputs only.

- [ ] **Step C3: Implement setup session resolver**

Returns:
- target origin;
- verification options;
- bridge script snippet placeholder;
- allowed capability choices;
- current setup status.

- [ ] **Step C4: Add tests**

Assert:
- no raw token stored/returned;
- invalid/expired/revoked token fails;
- session response contains no `secret_ref`, service-role data, idempotency key, raw token digest.

- [ ] **Step C5: Verify and commit**

```bash
git commit -m "feat: add actionbridge customer setup session"
```

---

## Workstream D — Bridge Script / Plugin v1 Contract

**Goal:** Define and implement the first minimal bridge script endpoint and handshake. This is not full backend action execution yet; it proves install/connectivity and capability registration shape.

**Files:**
- Create: `src/frontend/lib/actionbridge/bridge-handshake.ts`
- Create: `src/frontend/app/api/actionbridge/bridge/handshake/route.ts`
- Create: `src/frontend/app/actionbridge/bridge.js/route.ts` or equivalent static route pattern used by the app
- Create migration: `supabase/migrations/YYYYMMDDHHMMSS_actionbridge_bridge_installations.sql`
- Modify: `scripts/test-actionbridge-contracts.mjs`
- Modify: `scripts/test-actionbridge-security-gauntlet.mjs`

**Handshake model:**
- browser loads bridge script with `data-site-id` or setup token;
- script sends origin, site id, version, and optional public capabilities;
- server verifies origin matches verified connector/setup session;
- server records connected status;
- no secrets in browser;
- no arbitrary action execution from browser.

- [ ] **Step D1: Nexus designs bridge contract**

Must answer:
- script URL;
- what attributes customer copies;
- what data script sends;
- how dashboard sees connected status;
- what is deferred.

- [ ] **Step D2: Sentinel threat model**

Must cover:
- origin spoofing;
- XSS/script injection;
- token leakage via referer/logs;
- replay;
- CORS;
- public endpoint abuse;
- rate limiting;
- no service role from public path.

- [ ] **Step D3: Implement bridge script v1**

Script v1 does only:
- discover its own `<script>` tag;
- read `data-site-id`;
- POST handshake to ActionBridge;
- expose a tiny `window.ActionBridge.status` object;
- no DOM scraping;
- no form submit;
- no backend calls.

- [ ] **Step D4: Implement handshake endpoint**

Endpoint:
- validates `Origin` header exactly against verified origin;
- validates site/setup token digest;
- records bridge version and connected timestamp;
- returns `{ ok: true, mode: 'connected_only' }`.

- [ ] **Step D5: Add tests**

Assert:
- no credentials/secrets in script;
- exact-origin check marker exists;
- no `fetch` from script except ActionBridge handshake;
- no DOM scraping/form submit;
- route does not select service-role-only secrets.

- [ ] **Step D6: Verify and commit**

```bash
git commit -m "feat: add actionbridge bridge script handshake"
```

---

## Workstream E — Capability Rules v1

**Goal:** Allow customer/operator to define allowed ActionBridge capabilities/rules for a verified setup.

**Files:**
- Create: `src/frontend/lib/actionbridge/capability-rules.ts`
- Create: `src/frontend/app/api/actionbridge/capabilities/route.ts`
- Create migration: `supabase/migrations/YYYYMMDDHHMMSS_actionbridge_capability_rules.sql`
- Modify: `src/frontend/lib/actionbridge/tool-catalog.ts`
- Modify: `scripts/test-actionbridge-contracts.mjs`

**Initial capabilities:**
- `site.knowledge.read` — read-risk, no approval, verified origin only.
- `lead.prepare_draft` — write-risk, approval required, no submit.
- `appointment.request.prepare_draft` — write-risk, approval required, no calendar write.

- [ ] **Step E1: Nexus maps capabilities to tool schema**

Must confirm stable names, input schemas, output descriptions.

- [ ] **Step E2: Sentinel validates policy matrix**

Rules:
- read can be active only for verified origin;
- draft/write always requires approval;
- transactional/destructive absent from v1;
- customer cannot self-set risk to read for write actions.

- [ ] **Step E3: Implement migration and route**

Capability rule fields:
- `id`, `user_id`, `connector_id`, `name`, `risk_level`, `enabled`, `requires_approval`, `config`, `created_at`, `updated_at`.

- [ ] **Step E4: Integrate catalog compiler**

`tool-catalog.ts` should include capability-derived tools but expose only agent-safe fields:
- `name`, `description`, `inputSchema`, `riskLevel`, `requiresApproval`, `enabled`, `connector type/capabilities`.

- [ ] **Step E5: Add tests**

Assert:
- non-read requires approval;
- no client risk override;
- no secrets/config internals in catalog;
- tenant scoping in queries;
- disabled capabilities absent or marked disabled.

- [ ] **Step E6: Verify and commit**

```bash
git commit -m "feat: add actionbridge capability rules"
```

---

## Workstream F — Schwarzwald-Agent Tool Consumption Contract

**Goal:** Define the exact contract Schwarzwald-Agent will use to retrieve ActionBridge tools and call them.

**Files:**
- Create: `docs/specs/2026-05-14-actionbridge-schwarzwald-agent-contract.md`
- Create: `src/frontend/app/api/actionbridge/agent-tools/route.ts`
- Modify: `scripts/test-actionbridge-contracts.mjs`

- [ ] **Step F1: Nexus writes integration contract**

Contract must include:
- how Schwarzwald-Agent identifies tenant/site/agent;
- how it lists tools;
- how it calls actions;
- response shape;
- error shape.

- [ ] **Step F2: Sentinel reviews auth boundary**

Must define:
- dashboard/operator auth vs agent runtime auth;
- no public unauthenticated tool listing;
- token/session model deferred or minimal signed token.

- [ ] **Step F3: Implement agent-tools route**

Route returns same safe catalog shape, but explicitly intended for Schwarzwald-Agent runtime.

- [ ] **Step F4: Add tests**

Assert:
- route auth-gated;
- tenant-scoped;
- no secrets/base URLs/raw connector internals;
- includes capability tools only after verification/enablement.

- [ ] **Step F5: Verify and commit**

```bash
git commit -m "feat: add schwarzwald-agent actionbridge tool contract"
```

---

## Workstream G — Demo Scenario: 100k€ Target MVP Story

**Goal:** Build a repeatable demo script that makes the product understandable to customers/investors.

**Files:**
- Create: `docs/demos/2026-05-14-actionbridge-100k-mvp-demo.md`
- Create/update test fixture docs only; no fake production data.

Demo story:
1. Operator creates setup link for `https://demo-customer.example`.
2. Customer verifies via meta/DNS/well-known.
3. Customer installs bridge script.
4. Dashboard shows connected.
5. Customer enables:
   - site knowledge read;
   - lead draft;
   - appointment request draft.
6. Schwarzwald-Agent fetches tools.
7. Agent answers a customer question using read tool.
8. Agent prepares lead/appointment draft with approval requirement.
9. Audit log shows every step.

- [ ] **Step G1: Nexus validates demo flow**
- [ ] **Step G2: Sentinel validates no unsafe live external target is required**
- [ ] **Step G3: Write demo doc**
- [ ] **Step G4: Commit demo doc**

```bash
git commit -m "docs: add actionbridge 100k mvp demo flow"
```

---

## 50% Readiness Checklist

ActionBridge can be called ~50% ready when:

- [ ] Nexus signs GO on architecture/product fit.
- [ ] Sentinel signs GO on security gates.
- [ ] Setup links exist and are digest-token/expiry/revocation safe.
- [ ] Customer setup session exists.
- [ ] Domain verification is hardened.
- [ ] Bridge script handshake works.
- [ ] Capability rules exist.
- [ ] Safe tool catalog includes capability-derived tools.
- [ ] Schwarzwald-Agent integration contract exists.
- [ ] At least two end-to-end demo capabilities are documented and testable.
- [ ] Standard verification passes:

```bash
node scripts/test-actionbridge-contracts.mjs
node scripts/test-actionbridge-security-gauntlet.mjs
node scripts/test-actionbridge-dns-ip-guard.mjs
node scripts/test-actionbridge-visibility-sanitizer.mjs
git diff --check
```

---

## Explicit Non-Goals Before 50%

Do not build yet:
- full dashboard UI in Schwarzwald-Agent repo;
- payments/billing;
- marketplace;
- arbitrary backend writes;
- browser/RPA autonomous execution;
- login/paywall/captcha bypass;
- transactional/destructive actions;
- broad public SaaS self-serve without stronger auth/rate limits;
- complex platform plugins for WordPress/Shopify/Webflow beyond the script/handshake contract.

---

## Team Operating Rule

Every workstream follows this order:

1. Nexus architecture/product review.
2. Sentinel security review.
3. Build only the approved slice.
4. Run tests.
5. Request Nexus/Sentinel review of the diff.
6. Fix High/Important issues.
7. Commit.

No solo “trust me bro” builds. The whole point of ActionBridge is trust.
