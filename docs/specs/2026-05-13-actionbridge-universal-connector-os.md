# ActionBridge Universal Connector OS — North Star

Date: 2026-05-13
Status: Product north star / alignment spec

## One-Line Vision

ActionBridge is the connector layer that turns any customer-approved website, URL, app, plugin, backend capability, or digital surface into safe, typed, auditable agent tools that Schwarzwald-Agent can use and execute under policy.

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

The agent should not need to understand raw APIs, DOM selectors, OAuth mechanics, form fields, RPA clicks, backend quirks, or customer-system internals. It receives a constrained tool catalog with policy, approvals, audit, and redaction built in.

ActionBridge is not the chatbot, AI assistant, or automation product itself. Those experiences belong to Schwarzwald-Agent. ActionBridge is the bridge those agents use to reach customer-approved websites/apps/backends safely.

ActionBridge is not “API-first.” APIs are only one path. The core product must also support a simple website/plugin path: the customer proves authorization for a domain, installs a lightweight bridge script/plugin/SDK when deeper capabilities are needed, activates capabilities, and Schwarzwald-Agent can then answer questions or perform approved actions through ActionBridge.

## Product Outcome

Schwarzwald-Agent chatbots, assistants, and automations become usable by any SME because ActionBridge onboarding becomes:

1. Customer enters a website, URL, app, shop, calendar, inbox, or backend target.
2. Customer proves authorization/ownership via Meta tag, DNS TXT, well-known file, OAuth consent, or approved account flow.
3. If capabilities require site/backend access, customer installs the simplest bridge: one-line script, platform plugin, or small SDK adapter.
4. ActionBridge observes/imports exposed capabilities and translates them into agent-safe JSON tool schemas.
5. Sentinel policy assigns risk, approval, redaction, rate limits, audit, and execution boundaries.
6. Nexus builds/activates connector actions only inside those guardrails.
7. The customer can expose Schwarzwald-Agent through chatbot/widget, internal console, API, or workflow automation.

## Connector Surfaces

ActionBridge is not one connector. It is a connector OS with multiple adapters that all emit the same agent-action shape.

| Surface | Purpose | Default Mode |
|---|---|---|
| Website Bridge | Public pages, forms, offers, FAQ, routes | Observe / draft |
| Site Plugin / Script Bridge | One-line script/plugin/SDK installed by customer to expose approved site/backend capabilities | Converse / read / draft / approved act |
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

Customer verifies the domain and embeds a lightweight bridge/widget script or installs a platform plugin:

```html
<script src="https://actionbridge.example/bridge.js" data-site-id="customer-site-id" async></script>
```

The bridge can power a Schwarzwald-Agent chatbot and expose customer-approved capabilities such as public knowledge access, lead capture, appointment requests, order-status lookup, support-ticket creation, or other backend actions registered by a plugin/SDK. The agent uses ActionBridge tools to answer, draft, and — only with policy approval — act.

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

ActionBridge is not sold as stealth scraping, login bypass, paywall bypass, or unauthorized automation.

It is sold as:

> Universal Agent Connector OS: safe agent access and execution for customer-approved digital capabilities.

Meta/DNS/well-known proves authorization. Bridge script/plugin/SDK provides hands. Policy/approval/audit/redaction/kill-switches provide control. That positioning protects the product, the customer, and Schwarzwald-Agent.
