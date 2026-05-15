# ActionBridge Pilot Smoke Test Runbook

## Goal
Prove the controlled standalone ActionBridge pilot path without external destructive writes.

## Preconditions
- Test tenant/operator account exists.
- Customer/operator controls the target HTTPS origin.
- No production customer endpoint is used unless explicitly approved.
- `npm test && git diff --check` is green before pilot.

## Smoke Flow
1. Create connector with HTTPS `baseUrl`, exact `allowedOrigins`, and optional relative `endpointPath`.
2. Create setup link for the same origin.
3. Open setup session and verify that no `user_id`, `token_digest`, `secret_ref`, base URL secret, or idempotency key is exposed.
4. Verify domain using DNS TXT, meta tag, or `.well-known`.
5. Confirm connector becomes `safety_status=pass`, `permission_status=active`, and `network_execution_enabled=false`.
6. Enable allowed capability rule for `lead.submit` only after verification.
7. Request `lead.submit`; expect approval required.
8. Approve with a fresh idempotency key.
9. Confirm lead outbox state is created.
10. If Webhook-v1 network execution is enabled for a controlled endpoint, confirm delivery result:
    - 2xx = succeeded;
    - non-2xx/timeout = failed;
    - unresolved signing secret ref = failed before network;
    - repeated failure adds quarantine signal.
11. Confirm audit logs and error logs are redacted and owner-scoped.
12. Reuse same approval/idempotency key and confirm consume-once/idempotent behavior.

## Pass Criteria
- No raw secrets/tokens/idempotency keys exposed in API responses.
- No arbitrary external form submission.
- No network execution unless connector is verified/active/network-enabled.
- Failed delivery creates execution failure and error log.
- High/Critical errors stop pilot continuation until Sentinel review.

## Stop Criteria
Stop the pilot immediately if:
- private/internal host can be targeted;
- caller request body controls webhook destination URL;
- raw secret/token/idempotency key appears in response/log/tool catalog;
- failed webhook delivery is recorded as success;
- revoked/closed setup link can reconnect.
