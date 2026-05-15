# ActionBridge Webhook-v1 Adapter Spec

## Purpose
Webhook-v1 is the first external connector delivery adapter for ActionBridge standalone MVP. It proves ActionBridge can hand approved agent actions to a customer-controlled endpoint without becoming a CRM, Lead Inbox, automation builder, or arbitrary browser/form submitter.

## Product Boundary
ActionBridge owns:
- connector registration;
- endpoint/origin validation;
- schema normalization;
- policy and approval;
- redaction/minimization;
- idempotency;
- delivery attempt state;
- audit;
- kill-switch and rate-limit gates.

Customer system owns:
- receiving the webhook;
- creating the CRM lead/ticket/calendar item/etc.;
- business-side processing and notifications.

## MVP Capability
Initial supported action:
- `lead.submit` after human approval.

Future actions may use the same adapter once Sentinel approves their schemas and risk policies.

## Connector Configuration
Required server-owned fields:
- `connector_id`
- `user_id`
- `type = webhook`
- `target_origin` / exact HTTPS origin allowlist
- `endpoint_path` without absolute URL override
- `auth_ref` or secret reference, never raw secret in UI/tool catalog
- `enabled`
- `safety_status`
- `permission_status`
- `rate_limit_policy`
- `created_at`, `updated_at`

Forbidden:
- plain HTTP;
- localhost/private/link-local/internal hosts;
- userinfo URLs;
- request-body supplied target URL;
- redirects for write delivery;
- agent-visible secrets;
- arbitrary payload pass-through.

## Delivery Payload
Payload shape must be canonical and minimal:

```json
{
  "version": "actionbridge.webhook.v1",
  "eventId": "uuid",
  "tenantId": "uuid",
  "connectorId": "uuid",
  "actionName": "lead.submit",
  "riskLevel": "write",
  "idempotencyKeyDigest": "sha256:...",
  "approvedAt": "iso-time",
  "payload": {
    "lead": {
      "name": "redacted/minimized string",
      "company": "optional redacted/minimized string",
      "contact": "redacted/minimized string",
      "message": "redacted/minimized string"
    },
    "source": {
      "origin": "https://customer.example",
      "path": "/safe-path-no-query"
    }
  }
}
```

## Execution Rules
- Only server-side executor may deliver.
- Delivery only after approval is approved and consumed exactly once.
- Delivery must be bound to immutable approval snapshot.
- Idempotency digest must be sent; raw idempotency key must never be sent.
- Webhook target must come from server connector config only.
- No redirects.
- Timeout max 5 seconds.
- Response body read cap applies.
- 2xx = delivered.
- 409 with same idempotency digest MAY be treated as already accepted in future; MVP records non-2xx as failed.
- Retry policy must be explicit before production; MVP may record queued/failed without automatic retry.

## Audit Requirements
Every attempt records:
- tenant/user;
- connector;
- action;
- approval;
- execution;
- target origin/path;
- status: queued / delivered / failed / revoked;
- redacted payload summary;
- HTTP status if attempted;
- error code;
- `networkExecution: true` only when request was actually sent.

## Security Controls
- HTTPS only.
- DNS/IP private host guard before delivery.
- No redirects.
- Exact origin allowlist.
- Endpoint path cannot be absolute URL or scheme-relative.
- Secret from secret store only; never stored raw in DB or logs.
- HMAC signature recommended: `X-ActionBridge-Signature` over timestamp + body.
- Timestamp header: `X-ActionBridge-Timestamp`.
- Idempotency header: `X-ActionBridge-Idempotency-Digest`.
- Rate limit per connector/action.
- Kill-switch can stop all webhook delivery.

## Failure Modes
- Missing/disabled connector: deny/fail closed.
- Unverified connector: deny/fail closed.
- Invalid endpoint: deny/fail closed before network.
- DNS private/rebind risk: deny/fail closed before network.
- Timeout/non-2xx: failed attempt, audited.
- Persist failure before network: no network call.
- Persist failure after network: Critical operational incident; must be audited and surfaced.

## MVP Non-Goals
- No arbitrary form submission.
- No browser/RPA.
- No generic payload passthrough.
- No unbounded retries.
- No dashboard CRM/lead inbox.
- No production enablement without Sentinel GO.

## Acceptance Criteria
- Contract tests verify Webhook-v1 spec exists and forbids unsafe patterns.
- Security tests verify exact-origin, HTTPS-only, no userinfo/private hosts, no body-supplied target URL, no redirects.
- Implementation later must pass `npm test` and Sentinel review before any real external delivery is enabled.
