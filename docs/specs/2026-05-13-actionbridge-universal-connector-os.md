# ActionBridge Universal Connector OS — North Star

Date: 2026-05-13
Status: Product north star / alignment spec

## One-Line Vision

ActionBridge turns any customer-facing digital surface into safe, typed, auditable agent tools.

## Core Thesis

APIs, websites, widgets, forms, OAuth apps, MCP servers, browser flows, CRMs, shops, calendars, and inboxes are system language.

Agents need action language.

ActionBridge is the translation layer:

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
  "executor": {
    "type": "website_form_draft",
    "connectorId": "...",
    "networkExecution": false
  }
}
```

The agent should not need to understand raw APIs, DOM selectors, OAuth mechanics, form fields, RPA clicks, or customer-system quirks. It receives a constrained tool catalog with policy, approvals, audit, and redaction built in.

## Product Outcome

Schwarzwald-Agent becomes usable by any SME because onboarding becomes:

1. Customer enters website/API/app connection details.
2. ActionBridge observes or imports capabilities.
3. ActionBridge translates them into agent-safe JSON tool schemas.
4. Sentinel policy assigns risk, approval, and execution boundaries.
5. Nexus builds/activates connector actions only inside those guardrails.
6. The customer can expose the assistant through widget, internal console, API, or workflow automation.

## Connector Surfaces

ActionBridge is not one connector. It is a connector OS with multiple adapters that all emit the same agent-action shape.

| Surface | Purpose | Default Mode |
|---|---|---|
| Website Bridge | Public pages, forms, offers, FAQ, routes | Observe / draft |
| Widget Bridge | Chatbot/assistant embedded on customer site | Converse / draft / approved act |
| HTTP/API Bridge | REST/JSON endpoints | Read; writes approval-gated |
| OAuth Bridge | User/customer-authorized SaaS APIs | Least privilege scopes |
| MCP Bridge | Existing agent tools | Tool policy + prompt-injection guard |
| Browser/RPA Bridge | No-API workflows | Assisted action only at first |
| Webhook Bridge | Events into agents/workflows | Signed inbound events |
| Data/Knowledge Bridge | Site docs/FAQ/files as context | Read-only retrieval |

## Execution Ladder

ActionBridge capabilities progress through explicit levels:

1. **Observe** — read public/authorized data and produce a profile.
2. **Understand** — compile profile into structured business/context model.
3. **Draft** — prepare output/payload/form values without submitting.
4. **Assist** — open/fill/preview action with human confirmation.
5. **Act** — execute approved low-risk action.
6. **Transact** — booking/order/payment-level action with strict approval/audit.
7. **Destruct** — cancel/delete/refund; step-up approval required.

No connector jumps levels automatically.

## Customer-Facing Product Shape

### Setup Autopilot

Customer inputs a website or integration target. ActionBridge returns:

- business profile;
- public content summary;
- forms and conversion paths;
- proposed agent tools;
- blocked/high-risk actions;
- setup checklist;
- assistant/widget configuration draft.

### Chatbot / Assistant Widget

Customer embeds:

```html
<script src="https://actionbridge.example/widget.js" data-agent="customer-agent-id"></script>
```

The widget speaks to Schwarzwald-Agent. The agent uses ActionBridge tools to answer, draft, and — only with policy approval — act.

### Internal Agent Console

Teams can use the same tools from an internal console:

- answer customer questions;
- draft replies;
- create support tickets;
- prepare quotes;
- request bookings;
- update CRM records when authorized.

## Safety Contract

Every ActionBridge tool must have:

- connector id;
- action name;
- input schema;
- output contract;
- risk level;
- approval rule;
- executor type;
- tenant/user scope;
- redaction policy;
- audit event;
- kill-switch path.

Secrets never enter browser, prompt, logs, or customer-visible output.

## MVP Direction

The current website connector slice is intentionally only the first probe:

- model website connectors;
- plan public extraction safely;
- compile future website capabilities;
- keep real network execution disabled until Sentinel gates pass.

The true MVP should prove the full translation loop:

1. input a website;
2. produce a business/site profile;
3. compile JSON agent tools;
4. expose those tools to a Schwarzwald-Agent chat/widget flow;
5. allow read/draft actions;
6. require approval for writes;
7. audit everything.

## Non-Negotiable Product Boundary

ActionBridge is not sold as stealth scraping or bypass automation.

It is sold as:

> Universal Agent Connector OS: safe agent access to customer-approved digital capabilities.

That positioning protects the product, the customer, and Schwarzwald-Agent.
