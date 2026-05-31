# ActionBridge Pilot Runbook

## Purpose
Run a controlled ActionBridge pilot as a standalone connector and execution-control layer. This runbook proves the core product path before any Schwarzwald-Agent dashboard integration.

## Pilot Scope
Allowed:
- Customer domain/origin verification via DNS TXT, Meta Tag, or `.well-known`.
- Bridge script/plugin handshake in connected-only mode.
- Capability activation after verified active connector status.
- Agent-safe tool catalog generation without secrets, raw base URLs, token digests, auth refs, or idempotency values.
- Approval-gated `lead.submit` as connector delivery state / internal delivery plumbing.
- Webhook-v1 delivery for verified, customer/operator-authorized webhook origins only, when Sentinel has granted pilot GO.
- Webhook signing with server-owned secret refs only; newly created webhook connectors default to `unsigned_pilot` until an approved rotation/provisioning flow changes them.
- Dry-run/read-only execution where gates allow it.

Not allowed:
- Arbitrary external form POST.
- Browser/RPA writes.
- Production CRM/API writes without a reviewed adapter and explicit approval.
- Human attestation as strong verification.
- Caller/browser supplied raw secrets, raw `secret_ref`, destination URLs, token digests, or idempotency keys.
- Secrets in tool catalog, UI, logs, reports, support notes, or audit payloads.
- Broad or unverified third-party webhook rollout.

## Preconditions
1. Operator account is authenticated.
2. Customer has authority over target domain/app.
3. Customer agrees to pilot limits: no production write automation beyond the approved ActionBridge connector path.
4. Sentinel-approved kill-switch, revoke, pause/quarantine, alert, and retention paths are available.
5. `ACTIONBRIDGE_PUBLIC_BASE_URL` is set to the exact deployed ActionBridge HTTPS origin for staging/production smoke runs; setup snippets must not fall back to a hardcoded or request-header-derived public origin.
6. Local gates are green before pilot:
   - `npm run check`
   - This includes `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:userflow-smoke`, `npm run audit:high`, and `git diff --check`.
7. If Webhook-v1 HMAC signing is used, the next signing ref is server-owned, resolver-backed, and verified through dry-run before apply. Raw secret material must never be pasted into ActionBridge UI/API requests.
8. If a managed Secret Manager/KMS environment is claimed, the Managed Secret Manager/KMS Evidence Gate below is mandatory before production/broad-rollout language is used.

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
13. If Webhook-v1 is enabled for the connector, ActionBridge delivers only to the server-owned allowlisted HTTPS origin after DNS/IP guard, pinned outbound connection, no-redirect policy, timeout, response cap, signing resolution when configured, redaction, delivery throttle, and quarantine checks.
14. Audit logs record setup, verification, bridge, capability, approval, delivery, errors, quarantine, and execution events.

## Webhook-v1 Signing and Rotation Mode
Default controlled-pilot mode:
- New webhook connectors are created as `unsigned_pilot` and `network_execution_enabled=false`.
- Unsigned pilot delivery is acceptable only for a controlled receiver explicitly authorized by the customer/operator and Sentinel.
- Receiver must use HTTPS, idempotency/event metadata, receiver-side allowlists where possible, and reject unexpected payload versions.

HMAC mode:
- HMAC signing is supported through `webhook_signing_mode=hmac_sha256` plus a server-owned `secret_ref` that resolves server-side.
- Connector creation rejects browser/caller-supplied raw secret material and raw refs.
- The operator rotation route is dry-run-first and guarded by the Sentinel marker `sentinel.actionbridge.webhook_signing_secret.rotate.v1`.
- Apply requires explicit confirmation, stale-digest protection when supplied, local receiver-smoke evidence, and redacted control audit.
- Unresolved signing refs fail closed before network delivery.
- Pilot env lookup is allowed only outside production-required mode. Production-required mode must use the managed resolver path.

Managed Secret Manager/KMS Evidence Gate:
- Broad production remains blocked until a real managed Secret Manager/KMS environment is provisioned with least-privilege runtime identity/token issuance.
- Required evidence: live secret-manager probe success, `auditPersisted: true`, matching redacted audit row, digest-only secret-ref reporting, no raw provider resource names/tokens/secrets in responses or audit, and final Sentinel release review with no Critical/High blocker.
- A local/mock route-core test is not enough for production GO.

## Revoke / Kill-Switch
Use revoke/kill-switch when:
- Customer withdraws permission.
- Domain ownership is uncertain.
- Suspicious repeated setup/handshake attempts occur.
- A connector returns unsafe or unexpected behavior.
- Repeated delivery failures trigger quarantine.
- Sentinel marks a finding High/Critical.

Expected result:
- Setup links in closed states cannot reconnect.
- Revoked bridge installations cannot be revived by handshake.
- Active quarantine blocks later delivery before network.
- Network execution remains disabled unless explicitly reviewed.

## Verification Checklist
Before pilot:
- [ ] `ACTIONBRIDGE_GOAL.md` matches connector-only scope.
- [ ] `npm run check` passes.
- [ ] `npm run test:userflow-smoke` proves setup, verification, bridge, capability, approval, and connector-execution route intent.
- [ ] `npm run audit:high` reports no High/Critical dependency finding.
- [ ] `git diff --check` passes.
- [ ] Setup link token is digest-only in storage.
- [ ] Domain verification excludes `human_attestation` for pilot route.
- [ ] Bridge script does not scrape, store cookies, or submit forms.
- [ ] Setup snippets use the approved `ACTIONBRIDGE_PUBLIC_BASE_URL` origin for deployed staging/production.
- [ ] Capabilities require verified active connector.
- [ ] Write-risk capabilities require approval.
- [ ] Tool catalog excludes secrets, raw base URLs, setup tokens, token digests, auth refs, idempotency values, and service-role details.
- [ ] Webhook-v1 uses exact server-owned HTTPS allowlist origin, server-owned relative `endpoint_path`, no redirects, DNS/IP guard, pinned connection, timeout, response cap, delivery throttle, and quarantine guard.
- [ ] HMAC mode, if used, was dry-run verified through the rotation route before apply and receiver smoke evidence was recorded without secrets.
- [ ] Audit events exist for setup, verification, bridge, capability, approval, execution, delivery, errors, quarantine, and operator controls.
- [ ] PII redaction covers email, phone, contact, address, IBAN, tax/VAT markers, secret-like keys, and nested context.

## Failure Handling
- Invalid setup token: fail closed with 400/404.
- Expired/revoked/completed setup: fail closed with 409.
- Origin mismatch: fail closed with 403.
- Verification mismatch/expired: fail closed with 403/409.
- Approval not executable/reused incorrectly: fail closed with 409.
- Lead connector delivery state persist failure: mark execution failed and return 503.
- Unresolved HMAC signing ref: fail closed before network delivery and persist redacted denial/error evidence.
- Webhook delivery exception/timeout: fail closed, redact error, persist execution as failed, and return controlled 502.
- Webhook non-2xx response: persist execution as failed; do not record downstream delivery failure as ActionBridge success.
- Active quarantine: block before network and show safe redacted reason to operator/customer views.
- Rate-limit/store/proxy failure in production mode: fail closed and avoid raw IP/token/key exposure.

## Pilot Exit Criteria
Pilot is successful when:
- Customer can verify a domain.
- Bridge connects and closes setup link.
- Allowed capability appears as tool schema.
- Write-risk action queues approval.
- Human approval leads to controlled connector delivery state.
- Webhook-v1, if enabled, delivers only to verified authorized origins and has Sentinel conditional GO.
- HMAC signing, if enabled, uses only server-owned refs and verifier evidence; unsigned mode is explicitly scoped to a controlled receiver.
- Audit/error/alert/quarantine trail is complete and redacted.
- No High/Critical Sentinel finding remains.

## Next Product Gate
Webhook-v1 is now the first reviewed external connector-delivery path for controlled pilot. The next standalone gate is not dashboard integration; it is the production evidence package: managed Secret Manager/KMS live evidence, deployed staging setup-to-webhook smoke, deployed SSRF/DNS/rebinding evidence, production distributed rate-limit evidence, and final Sentinel release review.

Do not integrate into Schwarzwald-Agent dashboard until ActionBridge standalone DoD is satisfied.
