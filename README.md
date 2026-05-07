# ActionBridge by Schwarzwald-Agent

Universal agent connector layer: APIs, OAuth, MCP, websites, widgets, browser/RPA and REST normalized into safe, typed, auditable agent actions.

> API-Key = für Programmierer. ActionBridge = für Agents.

## Included

- Product/design spec
- MVP implementation plan
- ActionBridge API + frontend skeleton code
- Policy/redaction/HTTP connector skeleton
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
