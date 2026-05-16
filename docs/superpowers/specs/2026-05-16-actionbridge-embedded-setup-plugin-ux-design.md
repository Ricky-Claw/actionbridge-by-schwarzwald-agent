# ActionBridge Embedded Setup Plugin UX Design

## Decision
ActionBridge must feel like an embedded connector/setup plugin, not a standalone dashboard product. The customer-facing surface is a short guided setup flow that can be launched from Schwarzwald-Agent first and later embedded in customer/admin systems. Internal operational controls remain available to Ricky/operators, not normal customers.

## Product Principle
ActionBridge is the translation/control layer between approved systems and Schwarzwald-Agent agents. Its UX should say: “connect this capability safely,” not “manage another SaaS dashboard.”

## Primary Customer Flow
A customer receives a setup link or opens ActionBridge inside Schwarzwald-Agent.

Steps:
1. **Choose connector** — Website, Webhook, WhatsApp Business, later Shopify/Calendar/Email/etc.
2. **Enter required values** — only non-secret values in the public UI where possible, e.g. domain, endpoint path, WhatsApp Phone Number ID, WABA ID.
3. **Verify ownership/authorization** — DNS/meta/script/OAuth/provider verification depending on connector.
4. **Select allowed actions** — simple toggles like “send approved WhatsApp template,” “submit lead to webhook,” “read public site info.”
5. **Test connection** — dry-run or safe smoke check with redacted results.
6. **Activate** — only when policy, verification, and safety status allow it.

## UI Model
The customer UI is a compact wizard with minimal navigation:
- progress stepper;
- one primary action per screen;
- plain-language field labels;
- inline help for where to find provider IDs;
- status states: `draft`, `waiting`, `connected`, `needs_attention`, `paused`;
- clear pause/remove controls.

No customer-facing log explorer, raw policy editor, database fields, service-role details, token digests, idempotency keys, raw connector config, or internal audit tables.

## Host-Native Design
ActionBridge should support host theme tokens:
- brand name/logo optional;
- primary/accent color;
- background/card/border colors;
- compact vs spacious density;
- language: DE first, EN-ready;
- rounded/card style tokens.

Default mode inside Schwarzwald-Agent should visually feel like Schwarzwald-Agent. Later white-label/customer embed mode can use neutral tokens or customer-provided tokens.

## Operator Surface
Operators/Ricky need a separate control view, not mixed into the customer wizard:
- connector list and state;
- verification status;
- safety status;
- permission status;
- network execution flag;
- recent redacted errors;
- audit trail summary;
- pause/kill switch;
- secret-ref/bootstrap status, never raw secrets.

## Connector-Specific UX Requirements
### Website
- Ask for domain/URL.
- Offer verification methods.
- Explain what the bridge script/plugin does.
- Keep extraction/read-only capability clear before any write action.

### Webhook-v1
- Ask for target origin/path and receiver guide.
- Show signing mode and whether HMAC is configured.
- Do not ask public users for raw signing secrets unless a future secure secret-entry flow is explicitly approved.

### WhatsApp Business
- Ask for WhatsApp Phone Number ID, WABA ID, Graph API version.
- Explain that Meta token setup is required server-side/OAuth before live sends.
- Expose draft capabilities only until token storage, compliance checks, and Sentinel review are complete.
- Future send actions must clearly show template/24h window constraints.

## Data Flow
1. Host opens ActionBridge setup with setup token/context.
2. Setup API returns customer-safe setup state.
3. Customer enters connector-specific non-secret values.
4. Connector draft is stored with network execution disabled.
5. Verification and safety checks update status.
6. Tool catalog exposes only safe/redacted capabilities.
7. Activation requires explicit policy and server-side readiness.

## Error Handling
Customer errors must be actionable and non-technical:
- “Domain verification failed — DNS record not found yet.”
- “WhatsApp values look invalid — Phone Number ID must be numeric.”
- “Webhook receiver is not ready — signature secret is not configured server-side.”

Operator errors can include redacted diagnostic context, severity, category, and runbook links. No raw secrets or private customer data.

## Security Boundaries
- Public setup never exposes or accepts raw secrets by default.
- Agent/tool catalogs never expose base URLs where unnecessary, raw refs, raw tokens, idempotency keys, or setup token digests.
- Write actions require approval/policy.
- Network execution defaults false.
- High-risk connector changes require operator/Sentinel-ready controls.
- Kill switch and pause remain available to operators.

## Implementation Slices
1. **UX contract/spec layer** — document embedded wizard model, host theme tokens, status vocabulary, customer/operator split.
2. **API response shaping** — ensure setup/session/connectors/tool-catalog responses are customer-safe and wizard-friendly.
3. **Theme/wizard component shell** — reusable embedded setup shell in frontend.
4. **Connector screens** — Website, Webhook-v1, WhatsApp Business draft setup.
5. **Operator view** — separate control surface for audit/errors/pause.

## Acceptance Criteria
- ActionBridge can be launched as embedded setup from Schwarzwald-Agent without feeling like a standalone SaaS dashboard.
- Customer can create a connector draft through a simple wizard.
- Public UI uses only customer-safe fields.
- Operator-only controls are separated.
- WhatsApp Business setup captures required non-secret values while keeping live sends blocked until token/Meta compliance work is complete.
- Tests/contracts verify no raw secrets leak into customer-facing setup/tool routes.

## Explicit Non-Goals For This Spec
- No full visual redesign of Schwarzwald-Agent.
- No live WhatsApp message sending yet.
- No production secret manager implementation in this UX slice.
- No customer-facing advanced policy editor.
