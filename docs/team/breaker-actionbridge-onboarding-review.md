# Breaker Review — ActionBridge Pilot Onboarding

## Scope checked
Local ActionBridge repo only. No external/customer systems tested.

Pilot goal: customer can test setup flow without dangerous real actions.

Path reviewed:
1. Setup link creation/session
2. Domain verification
3. Bridge/plugin handshake
4. Capability rules/tool catalog
5. Execution dry-run/read-only gates
6. Audit/redaction/security tests

## Sentinel NO-GO items addressed

### 1. Setup link replay window
- Handshake now accepts only `pending`/`opened` setup links.
- Successful bridge handshake marks setup link `completed`, closing further token replay for bridge/session reuse.
- Revoked bridge installations cannot be upserted back to `connected`.
- Guardrail tests added in `scripts/test-actionbridge-security-gauntlet.mjs`.

### 2. Onboarding control-plane audit
Added audit coverage for:
- `setup_link.created` via setup link route.
- `setup_link.opened/completed/revoked/expired` via DB trigger migration `20260515000100_actionbridge_onboarding_audit_triggers.sql`.
- `bridge.handshake.connected` via bridge handshake route.
- `domain_verification.challenge_issued/verified/failed` via verify route.
- `connector.permission_status.changed` via verify route.
- `capability_rule.enabled/disabled` via capabilities route.

Public setup-session route does **not** select `user_id`; status-change audit is handled by DB trigger to avoid exposing owner data in public token flow.

### 3. GDPR/PII redaction
Extended `redactActionBridgeValue()` beyond secrets to redact/minimize:
- email
- phone/mobile/telephone
- contact
- address/street
- IBAN/BIC
- tax/VAT IDs
- free-text email/phone/IBAN patterns

Security gauntlet now checks GDPR redaction markers.

### 4. Human attestation ambiguity
Pilot verification route no longer exposes `human_attestation` as an accepted method. Strong proof only: `.well-known`, meta tag, DNS TXT.

## Earlier fixes retained

### Read-only executor target bug
- Fixed `targetValidation.target` misuse; executor now parses `targetValidation.url`.
- Guardrail test added.

### Bridge revocation replay
- Existing revoked installation blocks handshake.
- Guardrail test added.

## Verification command
- `npm test` ✅
- `git diff --check` ✅

## Breaker verdict
GO for local pilot onboarding smoke test under these constraints:
- No production customer writes.
- No browser/RPA/form-submit execution.
- Network execution remains disabled by default; only explicit read-only path after verified active connector.
- Strong domain proof only; no human-attestation shortcut.
- Setup token closes after successful bridge handshake.
- Onboarding state changes are auditable.

Remaining before production launch:
- Add real TypeScript/Next build gate when frontend build metadata is present.
- Add platform/API rate limits for setup-session, bridge-handshake, and verification endpoints.
- Run authorized staging SSRF/DNS tests with controlled domains before enabling external network execution.
