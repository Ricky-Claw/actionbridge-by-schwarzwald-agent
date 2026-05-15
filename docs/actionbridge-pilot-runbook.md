# ActionBridge Pilot Runbook

## Purpose
Run a controlled ActionBridge pilot as a standalone connector layer. This runbook proves the core product path before any Schwarzwald-Agent dashboard integration.

## Pilot Scope
Allowed:
- Customer domain/origin verification via DNS TXT, Meta Tag, or `.well-known`.
- Bridge script/plugin handshake in connected-only mode.
- Capability activation after verified active connector status.
- Agent-safe tool catalog generation.
- Approval-gated `lead.submit` as connector delivery state / internal delivery plumbing.
- Dry-run/read-only execution where gates allow it.

Not allowed:
- Arbitrary external form POST.
- Browser/RPA writes.
- Production CRM/API writes without a reviewed adapter.
- Human attestation as strong verification.
- Secrets in tool catalog, UI, logs, reports, or audit payloads.

## Preconditions
1. Operator account is authenticated.
2. Customer has authority over target domain/app.
3. Customer agrees to pilot limits: no production write automation beyond approved ActionBridge connector path.
4. Sentinel-approved kill-switch and revoke path are available.
5. Tests are green before pilot:
   - `npm test`
   - `git diff --check`

## Main Flow
1. Operator creates setup link for customer target origin.
2. Customer opens setup link.
3. Customer verifies domain with one strong method:
   - DNS TXT
   - Meta Tag
   - `.well-known/actionbridge-verify.txt`
4. Customer installs bridge script/plugin only if needed.
5. Bridge performs connected-only handshake.
6. ActionBridge marks setup link completed.
7. Operator/customer enables allowed capabilities.
8. Agent/tool caller requests action.
9. ActionBridge evaluates policy.
10. Write-risk action creates approval.
11. Human approves or rejects.
12. Approved `lead.submit` creates connector delivery state in ActionBridge; no arbitrary external delivery occurs.
13. Audit logs record setup, verification, capability, approval, and execution events.

## Revoke / Kill-Switch
Use revoke/kill-switch when:
- Customer withdraws permission.
- Domain ownership is uncertain.
- Suspicious repeated setup/handshake attempts occur.
- A connector returns unsafe or unexpected behavior.
- Sentinel marks a finding High/Critical.

Expected result:
- Setup links in closed states cannot reconnect.
- Revoked bridge installations cannot be revived by handshake.
- Network execution remains disabled unless explicitly reviewed.

## Verification Checklist
Before pilot:
- [ ] `ACTIONBRIDGE_GOAL.md` matches connector-only scope.
- [ ] `npm test` passes.
- [ ] `git diff --check` passes.
- [ ] Setup link token is digest-only in storage.
- [ ] Domain verification excludes `human_attestation` for pilot route.
- [ ] Bridge script does not scrape, store cookies, or submit forms.
- [ ] Capabilities require verified active connector.
- [ ] Write-risk capabilities require approval.
- [ ] Audit events exist for setup, verification, bridge, capability, approval, execution.
- [ ] PII redaction covers email, phone, contact, address, IBAN, tax/VAT markers.

## Failure Handling
- Invalid setup token: fail closed with 400/404.
- Expired/revoked/completed setup: fail closed with 409.
- Origin mismatch: fail closed with 403.
- Verification mismatch/expired: fail closed with 403/409.
- Approval not executable/reused incorrectly: fail closed with 409.
- Lead connector delivery state persist failure: mark execution failed and return 503.

## Pilot Exit Criteria
Pilot is successful when:
- Customer can verify a domain.
- Bridge connects and closes setup link.
- Allowed capability appears as tool schema.
- Write-risk action queues approval.
- Human approval leads to controlled connector delivery state.
- Audit trail is complete and redacted.
- No High/Critical Sentinel finding remains.

## Next Product Gate
After standalone pilot succeeds, implement the first reviewed external connector adapter, recommended: `webhook-v1`.
Do not integrate into Schwarzwald-Agent dashboard until ActionBridge standalone DoD is satisfied.
