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
- Webhook-v1 delivery for verified, customer/operator-authorized webhook origins only, when Sentinel has granted pilot GO.
- Dry-run/read-only execution where gates allow it.

Not allowed:
- Arbitrary external form POST.
- Browser/RPA writes.
- Production CRM/API writes without a reviewed adapter.
- Human attestation as strong verification.
- Secrets in tool catalog, UI, logs, reports, or audit payloads.
- Broad or unverified third-party webhook rollout.

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
13. If Webhook-v1 is enabled for the connector, ActionBridge delivers only to the server-owned allowlisted HTTPS origin after DNS/IP guard, pinned outbound connection, no-redirect policy, timeout, response cap, and redaction.
14. Audit logs record setup, verification, capability, approval, delivery, and execution events.

## Webhook-v1 Pilot Mode
Current Webhook-v1 pilot mode is **unsigned unless a server-side secret reference is explicitly wired**. The delivery module supports `X-ActionBridge-Signature`, but connector creation currently rejects raw secret material and the execute route does not read a secret reference.

Compensating controls required before any customer-facing pilot enablement:
- Webhook origin must be verified and explicitly authorized by the customer/operator.
- `network_execution_enabled` remains default-off.
- Enable only after `safety_status = 'pass'`, `permission_status = 'active'`, and at least one server-owned HTTPS allowlist origin exists.
- Receiver should use HTTPS, idempotency/event metadata, receiver-side allowlists where possible, and reject unexpected payload versions.
- Customer must authorize outbound data categories and destination/controller/processor role for GDPR purposes.

Production/broad rollout remains blocked until server-side secret-reference signing and behavioral security tests are implemented.

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
- Webhook delivery exception/timeout: fail closed, redact error, persist execution as failed, and return controlled 502.
- Webhook non-2xx response: persist execution as failed; do not record downstream delivery failure as ActionBridge success.

## Pilot Exit Criteria
Pilot is successful when:
- Customer can verify a domain.
- Bridge connects and closes setup link.
- Allowed capability appears as tool schema.
- Write-risk action queues approval.
- Human approval leads to controlled connector delivery state.
- Optional Webhook-v1 delivery is limited to verified authorized origins and has Sentinel conditional GO.
- Audit trail is complete and redacted.
- No High/Critical Sentinel finding remains.

## Next Product Gate
After standalone pilot succeeds, implement the first reviewed external connector adapter, recommended: `webhook-v1`.
Do not integrate into Schwarzwald-Agent dashboard until ActionBridge standalone DoD is satisfied.
