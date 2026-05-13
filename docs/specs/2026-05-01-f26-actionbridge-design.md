# F26 ActionBridge — Universal Agent Connector Design

## Goal
Build **ActionBridge**, a Universal Agent Connector OS that makes customer systems agent-capable without creating 200 bespoke integrations.

ActionBridge turns customer-approved digital capabilities into safe, typed, auditable **agent actions** such as `find_product`, `check_availability`, `create_cart`, `book_appointment`, `create_ticket`, or `request_quote`.

The big goal is not only an HTTP connector or a website scraper. The big goal is translation: websites, forms, APIs, OAuth apps, MCP servers, widgets, browser/RPA flows, webhooks, CRMs, shops, calendars and inboxes become one consistent agent-language tool catalog.

## Core Insight
APIs, DOMs, forms, widgets, OAuth scopes, MCP tools and browser flows are system language. Agents need action language.

Instead of exposing raw API keys, REST endpoints, OAuth complexity, or one-off integrations, ActionBridge gives agents a constrained action interface:

```json
{
  "action": "find_product",
  "input": { "query": "ergonomic office chair", "max_price": 300 },
  "risk": "read",
  "requires_approval": false
}
```

The customer system remains behind a secure gateway. Secrets stay server-side. Writes can require approval. Every action is logged.

## Product Positioning
- **Not:** 200 individual integrations.
- **Not:** raw API key proxy.
- **Not:** developer-only MCP infra.
- **Yes:** KMU-friendly universal agent connector with security, no-code setup, widget/SDK, audit, and approval flows.

## Competitive Learning
### Frontegg AgentLink
Useful patterns:
- MCP/server tool generation from existing APIs.
- Agent IAM with role/tool permissions.
- Step-up auth and human approval for risky actions.
- Data masking and tenant policies.
- Agent analytics and audit trail.

Our difference:
- DACH/KMU UX, no-code action builder, widget-first integration, Schwarzwald-Agent-native workflows.

### agentgate.org / AgentGate
Useful patterns:
- Credentials never exposed to agent.
- Read actions pass through; write actions queue for approval.
- MCP compatibility.

Name conflict:
- `AgentLink` and `AgentGate` are too close/occupied. Use **ActionBridge** as product name.

## North Star

ActionBridge receives a customer-approved surface and emits JSON-like agent tool schemas:

```json
{
  "name": "customer.lead.prepare_draft",
  "description": "Prepare a lead/contact request from a customer conversation.",
  "riskLevel": "write",
  "requiresApproval": true,
  "inputSchema": [
    { "name": "name", "type": "string", "required": true, "description": "Customer name" },
    { "name": "email", "type": "string", "required": true, "description": "Customer email" },
    { "name": "message", "type": "string", "required": true, "description": "Request details" }
  ],
  "executor": { "type": "website_form_draft", "networkExecution": false }
}
```

This tool catalog can power Schwarzwald-Agent in a website chatbot widget, internal console, automation workflow or future MCP-compatible interface.

## MVP Scope
Build universal foundation, not individual connectors.

### MVP Components
1. **Action Definition Schema**
   - Action name, description, input schema, output schema.
   - Risk level: `read`, `write`, `transactional`, `destructive`.
   - Required permission and approval policy.

2. **Connector Adapters**
   - HTTP/API connector maps actions to server-side HTTP requests.
   - Website connector observes public pages/forms and proposes read/draft actions.
   - Widget connector exposes the assistant on customer websites.
   - Future adapters: OAuth, MCP, Browser/RPA, webhooks, CRM/shop/calendar/inbox.
   - Server-side secret storage only.
   - Response mapping to agent-friendly output.

3. **Policy Decision Layer**
   - Decides: allow, deny, require approval.
   - Checks tenant/user/agent/action/risk/amount/volume.
   - No broad default allow for writes.

4. **Approval Queue**
   - Stores pending risky actions.
   - Human can approve/reject.
   - Agent receives pending/rejected/approved status.

5. **Audit Log**
   - Logs agent id, user id, tenant id, action id, input hash/redacted input, decision, result, latency.

6. **Agent Tool Interface**
   - Internal tool-call API for Ricky/Studio.
   - MCP-compatible shape later; do not overbuild full public MCP server in first slice.

7. **Widget/SDK Contract**
   - Customer site can open Schwarzwald-Agent as a chatbot/assistant window.
   - Widget passes signed context and receives agent responses.
   - Agent can call ActionBridge tools for read/draft/approved actions.
   - No secrets in browser.
   - Signed short-lived session/action tokens.

## Non-Goals for MVP
- No Amazon/Booking direct production integration.
- No full marketplace.
- No claim that every website can be bypassed; unsupported or unsafe surfaces must block with a clear reason.
- No public MCP server until security model passes review.
- No F21/F22/F24 work.
- No browser-stored customer secrets.

## Security Model
### Default Rules
- Read actions may execute immediately if allowed by policy.
- Write actions require explicit allow policy; high-risk writes require approval.
- Destructive actions require approval and step-up later.
- Secrets stay server-side.
- Inputs/outputs are redacted before logs where needed.
- All actions are tenant-scoped and user-scoped.

### Risk Levels
| Risk | Examples | Default |
|---|---|---|
| `read` | search products, check availability | allowed if scoped |
| `write` | create ticket, add cart item | approval unless explicitly trusted |
| `transactional` | book, order, charge | approval required |
| `destructive` | delete, cancel, refund | approval + step-up later |

## Data Model Draft
Tables to add later via migration:
- `actionbridge_connectors`
- `actionbridge_actions`
- `actionbridge_secrets`
- `actionbridge_policy_rules`
- `actionbridge_approvals`
- `actionbridge_audit_logs`

## API Draft
- `GET /api/actionbridge/actions`
- `POST /api/actionbridge/actions/test`
- `POST /api/actionbridge/execute`
- `GET /api/actionbridge/approvals`
- `POST /api/actionbridge/approvals/:id/approve`
- `POST /api/actionbridge/approvals/:id/reject`

## MVP Success Criteria
- A customer can define one HTTP-backed action.
- Ricky/Studio can call the action through a safe internal endpoint.
- Read action executes and returns normalized output.
- Write/transaction action creates approval instead of executing by default.
- Audit log records every attempt.
- Tests prove no secrets reach browser/client response.
- Typecheck passes.
- Quinn + Dante review pass before push.

## Open Questions
1. Product name final: ActionBridge likely, but trademark check still needed.
2. Should MVP UI be in Studio or Integrations first?
3. Which demo action should showcase value: product search, appointment booking, or support ticket?

## Recommendation
Prove the full translation loop, not just one connector:

1. Website/setup input creates a public business profile.
2. Profile compiles into JSON agent tools.
3. Schwarzwald-Agent widget can answer questions from the profile.
4. The agent can prepare a contact/request quote draft.
5. Any send/write action is approval-gated and audited.

This proves the universal action model without payment/booking liability, while keeping the north star pointed at every customer-approved digital surface.
