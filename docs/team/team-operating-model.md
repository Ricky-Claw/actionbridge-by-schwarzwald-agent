# ActionBridge Team Operating Model

## Team
- **Breaker** — authorized red-team agent. Finds how ActionBridge/connectors/websites can be abused within approved scope.
- **Sentinel** — gatekeeper. Converts Breaker findings into policies, quarantine, approvals, sandboxing, audit, redaction, and kill switches.
- **Nexus** — connector builder. Builds only after Sentinel controls exist.
- **Ricky** — operator/CEO coordination, customer authorization, scope, final decision.

## Core Loop
1. Ricky confirms target + written permission/scope.
2. Breaker performs scoped passive/allowed assessment.
3. Breaker writes audit finding + what would be possible.
4. Sentinel defines controls and acceptance gates.
5. Nexus builds connector/action schema.
6. Breaker retests safely.
7. Sentinel approves or blocks.
8. Ricky reports outcome to Elvis/customer.

## Scope Levels
- **Level 0: Public passive** — fetch public pages, sitemap, robots, metadata, visible forms, public JS references.
- **Level 1: Customer-approved light active** — form validation tests, safe header/CORS checks, rate-limited route probing.
- **Level 2: Authenticated customer-approved** — customer provides session/API/OAuth; read-only by default.
- **Level 3: Controlled write tests** — only test environment or explicit written approval; approvals and audit required.
- **Forbidden:** exploitation, credential theft, data exfiltration, destructive tests, persistence, malware, auth bypass against third parties.

## Product Thesis
API-Key = for programmers. ActionBridge = for agents.

ActionBridge is the Universal Agent Connector OS for Schwarzwald-Agent: every customer-approved digital capability should become a safe JSON-like agent tool with scope, risk, approval, audit, redaction, and kill-switches.

Website Bridge is the first no-key path, not the whole product:
- Observe public content.
- Translate forms/routes/offers into read/draft agent tools.
- Assist with drafts/forms.
- Act only through widget/session/approval.

Other paths follow the same action-language model: API/OAuth, MCP, widgets, browser/RPA, webhooks, CRM, shop, calendar, inbox.

## Audit Finding Template
- Target
- Permission/scope reference
- Surface
- Finding
- Severity
- Evidence
- Safe reproduction summary
- Potential impact if abused
- Sentinel control required
- Nexus build note
