# ActionBridge Execution v1 — Webhook Actions

Date: 2026-05-20
Status: controlled-pilot implementation slice

## Scope

Execution v1 allows approved `write` actions to execute only through a verified `webhook` connector. This is the first real action path beyond dry-run and lead outbox plumbing.

## Allowed

- Authenticated user-owned action and connector.
- `risk_level = write` only.
- Approved approval consumed once with idempotency key.
- Connector type `webhook` only.
- Connector must pass existing execution controls:
  - `enabled = true`
  - `network_execution_enabled = true`
  - `safety_status = pass`
  - `permission_status = active`
- Server-owned `base_url`, `endpoint_path`, `allowed_origins`, signing mode, and secret ref.
- Webhook-v1 delivery using existing guardrails:
  - exact HTTPS allowlist
  - DNS/IP pinning
  - pinned HTTPS connect with Host/SNI preservation
  - no redirects
  - timeout and response cap
  - signing ref resolution
  - delivery throttle
  - durable quarantine check
  - failure persistence and error log

## Blocked

- `transactional` and `destructive` approved executions fail closed.
- Browser/RPA/form-submit execution.
- Client-supplied URLs, allowlists, risk levels, secrets, network flags, or approval bypass.
- SEO/deploy/business automations in ActionBridge core.
- Arbitrary connector types in this execution path.

## Payload

Generic approved write actions send a redacted approval snapshot payload:

```json
{
  "approvedWebhookAction": {
    "status": "approved_webhook_action",
    "actionName": "...",
    "actionInput": { "...": "redacted approval input" },
    "networkExecution": false
  }
}
```

`lead.submit` keeps its existing lead outbox persistence first, then optionally delivers the lead submission summary through webhook-v1 when the connector is active and verified.

## Remaining production blockers

- Real distributed rate limiter is still required before broad production.
- Real KMS/secret manager resolver is still required for production signing secrets.
- Behavioral end-to-end tests with a local HTTPS receiver should be added before customer rollout.
