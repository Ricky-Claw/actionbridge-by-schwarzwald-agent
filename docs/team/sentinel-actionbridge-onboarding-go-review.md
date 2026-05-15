# Sentinel ActionBridge Pilot Onboarding GO Review

**Date:** 2026-05-15  
**Reviewer:** Sentinel 🛡️  
**Scope:** setup link replay/expiry/status; bridge origin/token/revocation; domain verification; capability enabling gates; execution dry-run/read-only/approval gates; audit/redaction; SSRF/DNS guards.  
**Constraint:** No source-code changes. No external network tests. Local npm tests only.

## Verdict: NO-GO

ActionBridge is close to pilot-ready and has strong fail-closed foundations, but Sentinel cannot approve pilot onboarding yet because several onboarding/control-plane events are not auditable, setup links remain replayable for the full validity window, and redaction is secret-focused rather than GDPR/PII-safe for onboarding/audit evidence.

No Critical release blocker was found in local code review. The NO-GO is driven by High/Medium control gaps that must be closed before customer onboarding, especially for German SME business data and ActionBridge’s approval/audit contract.

## Evidence reviewed

### Local verification

Command run from `/data/.openclaw/workspace-breaker/actionbridge-by-schwarzwald-agent`:

```bash
npm test
```

Result: **pass**.

Covered suites:
- `test-actionbridge-contracts.mjs`
- `test-actionbridge-security-gauntlet.mjs`
- `test-actionbridge-dns-ip-guard.mjs`
- `test-actionbridge-visibility-sanitizer.mjs`
- `test-actionbridge-demo-flow.mjs`

Notable passing evidence from tests:
- SSRF payloads for localhost, private IPv4, IPv6 loopback, decimal/octal/hex IPv4, IPv4-mapped IPv6, `.local`, `.internal`, and userinfo confusion are blocked.
- Execution allowlists are server-owned, not request-body supplied.
- Bridge handshake only permits `pending`/`opened` setup links and does not revive revoked installations.
- Execution approval consumption is consume-once/idempotent and returns non-network dry-run state.
- Tool catalogs are dry-run only and avoid raw config/token fields.

### Code/control evidence

- Setup links are digest-only: `src/frontend/lib/actionbridge/setup-links.ts` generates `absl_` random tokens and stores `sha256:` digests only.
- Setup session validates token prefix/length, checks digest, blocks revoked/expired/completed status, and transitions `pending -> opened`: `src/frontend/app/api/actionbridge/setup-session/route.ts`.
- Bridge handshake requires exact HTTPS origin, Origin header/body consistency, digest token match, pending/opened setup link status, expiry check, and revoked installation block: `src/frontend/lib/actionbridge/bridge-handshake.ts`, `src/frontend/app/api/actionbridge/bridge/handshake/route.ts`.
- Domain verification normalizes HTTPS origins, rejects private hosts, supports DNS TXT/meta/well-known/human attestation, stores token digests, checks expiry/revocation, uses DNS pinning before HTTP verification, and sets connector `safety_status`/`permission_status`: `src/frontend/lib/actionbridge/domain-verification.ts`, `src/frontend/app/api/actionbridge/connectors/verify/route.ts`.
- Capability enabling requires owner-authenticated connector and blocks enabled rules unless connector `safety_status='pass'` and `permission_status='active'`: `src/frontend/app/api/actionbridge/capabilities/route.ts`.
- Execution is auth-gated, server-policy driven, approval-gated for non-read risks, server-allowlisted, dry-run by default, and read-only network execution is behind kill-switch + connector network/safety/permission controls: `src/frontend/app/api/actionbridge/execute/route.ts`, `src/frontend/lib/actionbridge/execution-controls.ts`, `src/frontend/lib/actionbridge/read-only-executor.ts`.
- Audit persistence exists for execution/approval paths: `src/frontend/lib/actionbridge/persistence.ts`, `supabase/migrations/20260501104300_actionbridge_core.sql`, `20260505234500_actionbridge_execution_state.sql`.

## Findings by severity

### High — Setup link replay window remains open until expiry/status closure

**Evidence:** `setup-session/route.ts` accepts any usable token and only changes status from `pending` to `opened`; `bridge/handshake/route.ts` accepts setup links in `pending` or `opened` until expiry. There is no nonce, single-use exchange, or mandatory completion/revocation after customer setup.

**Impact:** If a setup token leaks through browser history, support screenshots, referrers, logs, or chat, it can be replayed throughout the 14-day lifetime to view setup state and attempt repeated same-origin handshakes. Origin matching limits blast radius, but replay is still inconsistent with Sentinel’s approval/replay gate for onboarding.

**Required fix:** Exchange setup token for a short-lived setup session nonce on first open; mark links consumed/completed after successful bridge + verification/capability selection; provide explicit revoke endpoint/action; reduce default setup token TTL for pilot or require operator renewal.

### High — Onboarding control-plane audit trail is incomplete

**Evidence:** Execution paths call `persistActionBridgeAuditEvent`, but setup link creation/opening, bridge handshake success/failure, verification challenge issuance/check, connector status activation, capability enable/disable, and bridge revocation decisions are not consistently persisted to `actionbridge_audit_logs` or an equivalent immutable audit table.

**Impact:** Sentinel cannot reconstruct who enabled what, from which origin, using which verification method, at what time, and why a capability became active. This violates ActionBridge’s “no audit → no production action” rule for onboarding.

**Required fix:** Add immutable audit events for:
- `setup_link.created/opened/completed/revoked/expired`
- `domain_verification.challenge_issued/verified/failed/revoked`
- `bridge.handshake.connected/blocked/revoked`
- `connector.permission_status.changed`
- `capability_rule.enabled/disabled`
- `network_execution.enabled/disabled/kill_switch_changed`

### Medium — Redaction is secret-safe but not yet GDPR/PII-safe

**Evidence:** `src/frontend/lib/actionbridge/redaction.ts` redacts keys containing `apiKey`, `authorization`, `clientSecret`, `password`, and `token`. It does not redact common PII keys/values such as email, phone, name, address, IBAN, VAT/tax IDs, or free-text contact details unless keyed as a token/secret.

**Impact:** Approval records and audit logs can retain customer/user PII in `redacted_input` or result summaries. That may be acceptable for necessary business evidence only with retention/minimization policy, but it is not GDPR-first by default.

**Required fix:** Extend redaction/data-minimization for PII classes; define retention periods; add tests for email/phone/address/contact fields and nested/free-text previews.

### Medium — Human attestation can activate permission status without strong verification

**Evidence:** `connectors/verify/route.ts` allows `human_attestation`; on success it updates `permission_status='active'`, with `safety_status='untested'`. Capability enabling still requires `safety_status='pass'`, so this does not currently enable capabilities, but the connector appears permission-active.

**Impact:** Ambiguous operator/customer UX: a connector can look active without strong domain proof. Future code may accidentally key off `permission_status` alone.

**Required fix:** For pilot, either disable `human_attestation` for customer onboarding or use a separate status (`attested`, `limited`, or `draft`) that cannot be confused with verified active permission.

### Medium — DNS/HTTP verification has good guards but lacks full production SSRF hardening evidence

**Evidence:** HTTP verification performs DNS lookup + private IP blocking before fetch, uses `redirect:'manual'`, timeout, and response byte limits. Read-only executor repeats DNS pinning before GET. Tests simulate blocked private rebinding/redirect cases locally.

**Residual risk:** No external network tests were allowed. There is no evidence here for production resolver behavior, proxy behavior, IPv6 edge cases beyond local unit tests, or post-resolution socket pinning at the HTTP client layer.

**Required fix:** Before production, run authorized staging SSRF tests with controlled domains resolving to public/private/changed IPs, and document resolver/socket pinning behavior. For pilot, keep network execution kill-switch ON unless using controlled demo origins.

## Controls that are acceptable for pilot after fixes

- Authentication is required for operator/API management routes reviewed.
- RLS exists for ActionBridge core/setup/bridge/capability/execution tables in migrations reviewed.
- Setup/domain/handshake origins require HTTPS, no userinfo, no path/query/hash for origins, and no private/local/internal hosts.
- Bridge script is connected-only; it does not scrape, store cookies, submit forms, or expose credentials.
- Capability catalog is constrained to safe read/draft tools; write-like draft tools require approval.
- Execution is dry-run by default. Read-only network execution is gated behind kill-switch + `network_execution_enabled` + `safety_status='pass'` + `permission_status='active'`.
- Approval consumption uses DB RPC/idempotency and records non-network execution state.
- SSRF/DNS guards are materially improved and covered by local tests.

## Required fixes for GO

1. **Close setup replay:** one-time token exchange or nonce-bound session; complete/revoke link after setup; explicit revoke action; shorter pilot TTL.
2. **Audit onboarding events:** immutable audit trail for setup, verification, bridge, connector status, capability rules, and kill-switch/network-execution changes.
3. **Upgrade GDPR redaction:** redact/minimize PII in approvals, audit, verification evidence, response previews, and route errors; add tests.
4. **Clarify human attestation:** do not mark permission `active` from attestation alone, or prevent attestation from pilot onboarding.
5. **Document pilot runbook:** operator authorization proof, customer approval capture, emergency revoke/kill-switch path, and Breaker retest checklist.

## Sentinel guardrails for pilot

- **Default deny:** no write/destructive/transactional production action without Sentinel policy, explicit customer authorization, approval gate, and audit event.
- **Kill switch ON by default:** `ACTIONBRIDGE_READONLY_EXECUTION_KILL_SWITCH` must remain active unless Sentinel approves a controlled demo/staging origin.
- **Demo-only network execution:** no external customer-system execution until authorized staging SSRF/DNS tests pass.
- **No secrets in agent-visible surfaces:** never expose setup tokens, token digests, auth refs, raw connector config, idempotency keys, or credentials to agents/logs/reports/browser traces.
- **Strong verification required:** DNS TXT, `.well-known`, or meta-tag verification required before capability enabling. Human attestation alone is not enough.
- **Approval required for drafts/writes:** draft/write/transactional/destructive actions must remain approval-required; destructive actions also require future step-up auth.
- **Immutable audit:** every connector state change and every policy/approval/execution decision must include actor, tenant, connector/action, target/origin, redacted payload/evidence, timestamp, result, and reason.
- **GDPR minimization:** audit what is necessary, redact what is not, define retention/deletion/export behavior before real customer data enters ActionBridge.
- **Breaker retest gate:** Breaker must retest setup-token replay, revoked bridge install, expired verification, capability enable before verification, approval replay/idempotency, and SSRF/DNS rebinding before Sentinel changes verdict to GO.

## Final release gate

**NO-GO until required fixes 1–3 are implemented and verified.** Fixes 4–5 may be accepted as documented pilot constraints only if Sentinel signs off and Breaker retest passes.
