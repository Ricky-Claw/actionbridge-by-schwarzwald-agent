# ActionBridge by Schwarzwald-Agent

Universal Agent Connector OS between Schwarzwald-Agent and customer-approved websites/apps/backends: APIs, OAuth, MCP, websites, widgets, browser/RPA, webhooks, REST, forms, shops, calendars, inboxes and customer apps normalized into safe, typed, auditable agent actions.

> API-Key = für Programmierer. ActionBridge = für Agents.

North star: ActionBridge translates every customer-approved digital capability into agent-language JSON tool schemas with policy, approval, redaction, audit and kill-switches built in — and executes allowed actions safely. ActionBridge is not the chatbot or automation product itself; Schwarzwald-Agent provides chatbots, assistants, and automations. ActionBridge is their universal connector/plugin layer: Ricky/operator adds it inside the Schwarzwald-Agent dashboard, creates a customer setup link, the customer verifies domain/app authorization, installs the simplest bridge when needed (one-line script, platform plugin, SDK, OAuth, or API), defines allowed actions/rules, and Schwarzwald-Agent acts through ActionBridge. APIs are optional; simple no-code/low-code website capability is central.

## Current pilot capabilities

- Setup links with digest-only tokens.
- Strong domain verification via DNS TXT, meta tag, or `.well-known`.
- Connected-only bridge handshake.
- Capability rules and agent-safe tool catalog without secrets.
- Approval-gated execution with consume-once idempotency.
- `lead.submit` as connector delivery plumbing/outbox state, not a CRM/lead inbox product.
- Webhook-v1 delivery for verified/active connectors with:
  - server-owned exact HTTPS allowlist;
  - server-owned relative `endpoint_path`;
  - pinned HTTPS connection after DNS/IP guard;
  - no redirects;
  - response cap and redaction;
  - idempotency digest header;
  - optional HMAC signing via server-owned secret ref;
  - fail-closed unresolved signing refs;
  - pilot delivery throttle and failure quarantine signal.
- Error log/failure monitor with redacted bounded context and lifecycle status.

## Important status

ActionBridge is currently **controlled-pilot capable**, not production/broad-rollout ready.

Green pilot gates currently rely on:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:userflow-smoke
npm run audit:high
git diff --check
```

Build/typecheck/lint metadata has been restored for the focused `src/frontend` snapshot; browser/userflow smoke now gates the core ActionBridge route journey.

Production blockers are tracked in:

- `docs/production-readiness-checklist.md`
- `docs/sentinel-production-blockers.md`
- `docs/behavioral-test-roadmap.md`
- `docs/error-log-retention-policy.md`

## Included

- Product/design specs.
- Universal Connector OS north-star spec.
- Scope plan and pilot runbooks.
- ActionBridge API + frontend skeleton code.
- Policy/redaction/HTTP/website/webhook guardrails.
- Supabase migrations for connectors/actions/approvals/audit/execution/error state.
- Contract/security/demo-flow/userflow-smoke test scripts.
- Agent operating model: Breaker, Sentinel, Nexus.

## Team model

- **Breaker** finds authorized attack paths and abuse cases.
- **Sentinel** converts risks into policies, approvals, audit, redaction, sandboxing and kill switches.
- **Nexus** builds connector/action schemas only after Sentinel gates exist.

## Safety rules

- No destructive/customer-system testing without explicit authorization.
- No secrets in repo, logs, prompts, or reports.
- No production action without audit trail.
- Unresolved Critical/High finding blocks release.
- Schwarzwald-Agent dashboard integration waits until standalone ActionBridge DoD is green.

## Status

Focused ActionBridge repository snapshot. Build/typecheck/lint metadata has been restored for the focused `src/frontend` snapshot and is covered by the green pilot gates above. Broad production rollout remains blocked until the managed secret-manager/KMS environment is provisioned with least-privilege service identity/token issuance and Sentinel release review.
