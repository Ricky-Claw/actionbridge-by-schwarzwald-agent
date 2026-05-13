# ActionBridge ↔ Schwarzwald-Agent Tool Consumption Contract

ActionBridge is the connector/translation/execution-control layer. Schwarzwald-Agent owns chatbots, KI assistants, and automations. This contract lets Schwarzwald-Agent list tenant-scoped, policy-bound tools that ActionBridge has compiled from verified customer connectors.

## MVP boundary

- Listing tools is authenticated and tenant-scoped through the current operator/session auth in this repo.
- Runtime signed service-to-service auth is deferred until the Schwarzwald-Agent dashboard/runtime integration is implemented.
- The route does not execute actions, expose secrets, expose connector base URLs, or list tools for unverified tenants.

## Route

`GET /api/actionbridge/agent-tools?connectorId=<optional>`

Returns only agent-safe catalog fields:

```json
{
  "version": "actionbridge.agent-tools.v1",
  "catalogs": [
    {
      "version": "actionbridge.catalog.v1",
      "connector": {
        "id": "uuid",
        "name": "Customer Website",
        "type": "website",
        "enabled": true,
        "capabilities": ["public_page_extract"],
        "safetyStatus": "pass",
        "permissionStatus": "active"
      },
      "tools": [
        {
          "name": "site.knowledge.read",
          "description": "Read approved public site knowledge from a verified ActionBridge origin.",
          "inputSchema": [],
          "riskLevel": "read",
          "requiresApproval": false,
          "enabled": true
        }
      ],
      "execution": { "mode": "dry_run_only", "networkExecution": false }
    }
  ],
  "execution": { "mode": "catalog_only", "networkExecution": false }
}
```

## Caller identity

Current MVP uses authenticated ActionBridge/Supabase user scope. Future service runtime auth must add a signed Schwarzwald-Agent runtime token with:

- tenant/user id;
- allowed connector ids or site ids;
- agent id;
- purpose `actionbridge.agent_tools.list`;
- short expiry and replay protection.

Until that exists, no unauthenticated public runtime listing is allowed.

## Safety rules

- Only connectors with `enabled=true`, `safety_status='pass'`, and `permission_status='active'` are listed.
- Only enabled capability/action tools are included.
- `site.knowledge.read` is read-risk and no approval.
- `lead.prepare_draft` and `appointment.request.prepare_draft` are write-risk and approval-required.
- Transactional and destructive tools are absent from v1.
- Responses must never include `secret_ref`, raw token digests, connector `base_url`, idempotency keys, service-role data, or raw config internals.
- Listing tools never performs network execution.

## Execution handoff

Schwarzwald-Agent should call existing ActionBridge execution/approval APIs only after separate policy evaluation. This route is catalog discovery only.
