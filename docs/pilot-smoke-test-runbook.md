# ActionBridge Operator Pilot Smoke Test Runbook

## Goal
Prove the controlled standalone ActionBridge pilot path end-to-end without production writes, external destructive actions, or hidden mock behavior.

This runbook is operator-facing: it tells the human operator what to prepare, what evidence to collect, when to stop, and what result is acceptable for a controlled pilot.

## Scope

### In scope
- Setup-link creation and token lifecycle.
- Customer domain/origin verification through DNS TXT, meta tag, or `.well-known`.
- Connected-only bridge handshake.
- Capability activation for the pilot action set.
- Tool-catalog visibility checks.
- Approval-gated `lead.submit` execution.
- Internal connector-delivery state.
- Optional Webhook-v1 delivery to an operator-controlled test receiver only.
- Redacted audit, execution, error, alert, and quarantine evidence.

### Out of scope without fresh Elvis approval
- Production customer writes.
- Third-party scanning or load testing.
- Login/paywall bypass or private data access.
- Arbitrary form submission against customer websites.
- Any endpoint not owned or explicitly approved by the pilot customer.
- Production deploy or broad rollout decision.

## Required preconditions
- Operator has an auth-gated ActionBridge account/session for the pilot tenant.
- Pilot customer/operator controls the target HTTPS origin.
- Any Webhook-v1 receiver is a controlled test receiver, not a real CRM/form inbox, unless explicitly approved.
- Connector config is server-owned; caller bodies must not provide raw destination URLs or raw secrets.
- If webhook signing is enabled, only server-owned `secret_ref` values are used.
- `ACTIONBRIDGE_PUBLIC_BASE_URL` is set to the exact deployed ActionBridge HTTPS origin for staging/production so customer setup snippets post setup tokens back to the same approved environment, not a hardcoded or request-header-derived origin.
- Local verification is green before the smoke run:

```bash
npm test
git diff --check
```

## Evidence packet to collect
Create one timestamped pilot note or ticket containing:
- tenant/customer identifier, redacted if needed;
- verified origin/domain;
- setup-link id/status, never the raw setup token;
- connector id/type/status;
- enabled capabilities;
- approval id/status and idempotency proof, never raw idempotency keys;
- execution id/status;
- audit/error/alert/quarantine ids if created;
- screenshots or response excerpts with tokens, secrets, PII, base URLs, and idempotency values redacted;
- final PASS/FAIL decision and operator name.

## Smoke flow

### 1. Create verified connector candidate
1. Create or select the pilot tenant.
2. Create connector configuration for the controlled HTTPS origin.
3. Confirm connector stores server-owned allowlist configuration:
   - exact HTTPS origin only;
   - relative `endpoint_path` only when used;
   - no redirects required for Webhook-v1;
   - `network_execution_enabled=false` by default.
4. Record connector id and initial safety/permission status.

Expected result:
- Connector exists but cannot deliver network writes until verification, activation, and execution gates pass.

### 2. Create setup link
1. Create a setup link for the same controlled origin.
2. Confirm the response and UI do not expose:
   - token digest;
   - raw secret refs;
   - raw connector secrets;
   - idempotency keys;
   - unrelated tenant data.
3. Record setup-link id and expiry/status.

Expected result:
- Setup link is pending/open and token material is digest-only server side.

### 3. Complete domain/origin verification
1. Use one approved verification method:
   - DNS TXT;
   - HTML meta tag;
   - `.well-known` file.
2. Trigger verification at human-scale frequency only.
3. Confirm human attestation is not accepted as a shortcut.
4. Confirm setup status and connector status move only after proof is valid.

Expected result:
- Domain verification succeeds for the controlled origin only.
- Connector becomes eligible for activation, not automatically allowed to perform risky writes.

### 4. Bridge handshake check
1. Install or simulate only the connected-only Bridge Script v1 path documented for the pilot.
2. Confirm the script `src` and `data-endpoint` use the configured ActionBridge public origin from `ACTIONBRIDGE_PUBLIC_BASE_URL` for this environment.
3. Confirm bridge handshake proves connectivity only.
4. Confirm the bridge does not read cookies, scrape private content, submit forms, or execute arbitrary browser/RPA actions.

Expected result:
- Bridge status is connected without granting raw website access.
- Setup tokens are posted only to the approved ActionBridge environment for the smoke run.

### 5. Activate minimal capability rules
1. Enable only the minimum pilot capability needed, usually `lead.submit`.
2. Keep unrelated capabilities disabled.
3. Confirm capability state is owner-scoped and audit logged.

Expected result:
- Tool catalog shows only allowed agent-safe tool schemas.
- Tool catalog does not expose secrets, base URLs, setup tokens, token digests, auth refs, or idempotency values.

### 6. Request approval-gated execution
1. Request `lead.submit` with benign pilot data.
2. Confirm write-risk action returns approval-required before execution.
3. Approve once with a fresh idempotency key.
4. Reuse the same approval/idempotency input and confirm consume-once/idempotent behavior.

Expected result:
- No delivery occurs before approval.
- Approval is consumed once.
- Execution state is created and audit logged.
- The internal connector-delivery state is treated as plumbing, not a lead inbox/CRM product.

### 7. Optional Webhook-v1 controlled receiver test
Run this step only when the receiver endpoint is operator/customer-controlled and explicitly within pilot scope.

1. Enable network execution for the verified, active webhook connector.
2. Deliver to the allowlisted HTTPS origin and server-owned relative `endpoint_path`.
3. Confirm success path:
   - 2xx receiver response records delivery success;
   - response body is capped and redacted;
   - idempotency digest header is present;
   - optional HMAC signature verifies with the receiver guide.
4. Confirm safe failure path with controlled receiver behavior only:
   - non-2xx/timeout records failure, not success;
   - unresolved signing ref blocks before network;
   - repeated failure creates a quarantine signal;
   - active quarantine blocks later delivery.

Expected result:
- Webhook-v1 proves real connector delivery in a controlled environment without arbitrary URL control.

### 8. Operator observability check
1. Review audit logs for setup, verification, bridge, capability, approval, execution, and delivery events.
2. Review error logs for any failure path.
3. Review operator alerts for High/Critical conditions.
4. Review quarantine state if repeated webhook failure was tested.
5. Confirm all views are owner-scoped and redacted.

Expected result:
- Operator can explain what happened, why it was allowed or denied, and what state changed.
- No secret, token, idempotency, raw webhook signing material, or unrelated tenant data appears in UI/API/log evidence.

## Pass criteria
- `npm test` and `git diff --check` are green before the pilot.
- Setup-link token material remains digest-only and never appears in responses/logs.
- Domain verification requires DNS TXT, meta tag, or `.well-known` proof.
- Bridge Script v1 remains connected-only.
- Tool catalog is agent-safe and secret-free.
- `lead.submit` requires approval before write-risk execution.
- Approval/idempotency is consume-once.
- Internal delivery state is clearly connector plumbing, not a CRM/inbox feature.
- Webhook-v1, if tested, uses only exact allowlisted HTTPS origin plus server-owned relative path.
- Failed delivery is recorded as failed and creates redacted operational evidence.
- Quarantine/alert evidence is visible to the operator when triggered.

## Fail and stop criteria
Stop the pilot immediately and escalate to Sentinel if any condition occurs:
- private, loopback, link-local, metadata, or internal hosts can be targeted;
- caller-controlled request body can change webhook destination URL;
- redirects are followed during Webhook-v1 delivery;
- raw secret, setup token, token digest, auth ref, idempotency key, or unrelated tenant data appears in response, UI, tool catalog, audit log, error log, or alert;
- failed webhook delivery is recorded as success;
- approval can be skipped, replayed, or consumed by the wrong tenant/action;
- revoked/expired/closed setup link can reconnect or verify;
- bridge script reads cookies, scrapes private data, submits forms, or performs browser automation;
- High/Critical operator alert cannot be found by the operator;
- quarantine does not block later delivery after becoming active.

## Final operator decision
Use this final status line in the pilot evidence packet:

```text
ActionBridge controlled pilot smoke: PASS|FAIL
Verified by: <operator>
Date/time: <ISO timestamp>
Scope: <tenant + controlled origin>
External writes: none | controlled receiver only | explicitly approved customer endpoint
Open blockers: <none or linked findings>
```

A PASS supports controlled pilot continuation only. It is not production/broad-rollout approval.
