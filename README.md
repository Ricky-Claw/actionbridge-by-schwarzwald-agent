# ActionBridge by Schwarzwald-Agent

Universal Agent Connector OS: APIs, OAuth, MCP, websites, widgets, browser/RPA, webhooks, REST, forms, shops, calendars, inboxes and customer apps normalized into safe, typed, auditable agent actions.

> API-Key = für Programmierer. ActionBridge = für Agents.

North star: ActionBridge translates every customer-approved digital capability into agent-language JSON tool schemas with policy, approval, redaction, audit and kill-switches built in — and executes allowed actions safely. The product goal is a universal connector/plugin layer for Schwarzwald-Agent: verify domain/app authorization, install the simplest bridge when needed (one-line script, platform plugin, SDK, OAuth, or API), activate capabilities, and let chatbots/assistants/automations act through ActionBridge. APIs are optional; simple no-code/low-code website capability is central.

## Included

- Product/design spec
- Universal Connector OS north-star spec
- MVP implementation plan
- ActionBridge API + frontend skeleton code
- Policy/redaction/HTTP + Website connector guardrail skeletons
- Supabase migrations for connectors/actions/approvals/audit state
- Contract test script
- Agent operating model: Breaker, Sentinel, Nexus

## Team model

- **Breaker** finds authorized attack paths and abuse cases.
- **Sentinel** converts risks into policies, approvals, audit, redaction, sandboxing and kill switches.
- **Nexus** builds connector/action schemas only after Sentinel gates exist.

## Safety rules

- No destructive/customer-system testing without explicit authorization.
- No secrets in repo, logs, prompts, or reports.
- No production action without audit trail.
- Unresolved Critical/High finding blocks release.

## Status

Extracted from Schwarzwald-Agent workspace as a focused ActionBridge repository snapshot.
