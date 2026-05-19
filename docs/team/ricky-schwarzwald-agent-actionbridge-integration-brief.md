# Ricky Brief — Schwarzwald-Agent × ActionBridge Integration

Date: 2026-05-19
Owner for Schwarzwald-Agent code: Ricky only
Prepared by: Breaker

## Goal

Add a Schwarzwald-Agent dashboard module called **Webseiten verbinden** that lets an operator/customer connect multiple websites through ActionBridge without moving ActionBridge connector/security logic into Schwarzwald-Agent.

ActionBridge remains the connector/security backend. Schwarzwald-Agent provides host UI, tenant mapping, and agent-facing integration.

## Current ActionBridge state

Pushed ActionBridge commits:

- `a7b3b0c feat(actionbridge): add multi-target registry`
- `d285cbc feat(actionbridge): add multi-url target intake UI`
- `3ff6852 feat(actionbridge): add bounded target live check`
- `93f1a41 fix(actionbridge): harden target live checks`

Important current capabilities:

- Tenant-scoped target registry: `actionbridge_targets`
- Tenant membership hardening: `actionbridge_tenant_memberships`
- Multi-URL intake API/UI
- Live script check using pinned HTTPS, DNS guard, no redirects, 5s timeout, 250KB byte cap
- Manual connected/verified spoofing disabled
- Read-only target tool catalog
- Default bridge origin: `https://bridge.schwarzwald-agent.de`

## Schwarzwald-Agent integration boundary

### Schwarzwald-Agent owns

- Dashboard page / navigation
- Authenticated user/session/workspace
- Mapping current workspace to `actionbridge.tenant_id`
- Server-side proxy calls to ActionBridge
- UI cards, theme tokens, customer guidance
- Agent runtime deciding when to call read-only ActionBridge tools

### ActionBridge owns

- URL validation
- Tenant target registry
- Membership and RLS
- Live script check
- Domain/ownership verification
- Capability catalog
- Policy, audit, rate limits, kill switch
- Future write execution/approval flow

## MVP page

Route suggestion:

```txt
/dashboard/webseiten-verbinden
```

Label:

```txt
Webseiten verbinden
```

MVP only:

1. List connected/registered websites for current Schwarzwald-Agent workspace.
2. Add one or multiple URLs.
3. Run Live Check.
4. Show status:
   - connected
   - missing_script
   - script_found_no_handshake
   - unreachable
   - error
5. Show safe script snippet per target.
6. Show read-only capabilities.

No deploys, SEO actions, CRM writes, RPA, cross-site writes, or agent write actions in this phase.

## Server-side proxy routes in Schwarzwald-Agent

Do not call ActionBridge from browser with service credentials.

Recommended routes:

```txt
GET  /api/actionbridge/targets
POST /api/actionbridge/targets
PUT  /api/actionbridge/targets/:targetId/live-check
```

The proxy must derive tenant server-side from the logged-in workspace/session.

Never trust `tenant_id` from the browser.

## Tenant mapping

Use:

```txt
provider_id = schwarzwald-agent
tenant_id = current Schwarzwald-Agent workspace/customer id
user_id = current Schwarzwald-Agent operator/user id
target_id = ActionBridge target id
```

## ActionBridge API contract to consume

Current ActionBridge target API:

```txt
GET /api/actionbridge/targets?tenant_id=<tenant>
POST /api/actionbridge/targets
PUT /api/actionbridge/targets
```

POST body from server-side proxy:

```json
{
  "tenantId": "<server-derived-workspace-id>",
  "urls": ["https://example.de"]
}
```

PUT body from server-side proxy:

```json
{
  "tenantId": "<server-derived-workspace-id>",
  "targetId": "abtg_..."
}
```

Expected target fields:

```json
{
  "id": "abtg_...",
  "tenantId": "workspace_id",
  "url": "https://example.de/",
  "origin": "https://example.de",
  "hostname": "example.de",
  "bridgeOrigin": "https://bridge.schwarzwald-agent.de",
  "ownershipStatus": "pending|verified|unverified|failed",
  "scriptStatus": "unknown|connected|missing_script|script_found_no_handshake|unreachable|error",
  "connectionStatus": "pending|connected|unverified|missing_script|unreachable|error",
  "capabilities": ["actionbridge.targets.list", "actionbridge.target.status", "actionbridge.target.capabilities", "actionbridge.target.health_check"]
}
```

## Script snippet to display

```html
<script
  src="https://bridge.schwarzwald-agent.de/bridge.js"
  data-actionbridge-target="TARGET_ID"
  async>
</script>
```

Do not include secrets, setup token digests, or service credentials in the snippet.

## UI components

- `ConnectedWebsitesPage`
- `AddWebsiteUrlsForm`
- `TargetStatusCard`
- `ScriptSnippetPanel`
- `CapabilitiesList`
- `ConnectionHealthBadge`
- `RejectedUrlsSummary`

## Required tests in Schwarzwald-Agent

- Tenant A cannot list Tenant B targets.
- Browser cannot submit arbitrary tenant_id and change workspace.
- Proxy response contains no secrets/service token.
- Add URLs form handles accepted/rejected/duplicates.
- Live Check button calls server-side proxy only.
- Status cards render connected/missing_script/script_found_no_handshake/unreachable/error.

## Security guardrails

- No ActionBridge service token in browser.
- Tenant id derived server-side.
- ActionBridge remains source of validation and live check.
- MVP is read-only connection cockpit.
- No write/execute/automation actions until separate approval spec.
- Human-scale live checks only; no crawl/load/fuzz.

## Recommended Ricky sequence

1. Create short integration spec in Schwarzwald-Agent repo.
2. Add env config for ActionBridge base URL and server token/signing config.
3. Build server-only ActionBridge proxy client.
4. Add `/dashboard/webseiten-verbinden` page.
5. Add target list + add URLs form.
6. Add script snippet panel + live check button.
7. Add tenant/no-secret tests.
8. Ask Breaker/Sentinel/Nexus for review before merge.
