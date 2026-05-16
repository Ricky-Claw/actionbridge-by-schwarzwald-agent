# ActionBridge Embedded Setup Plugin

## Purpose
ActionBridge is an embedded connector setup plugin, not a standalone dashboard. It should launch from Schwarzwald-Agent first, then later from approved customer/admin systems.

## Customer Wizard
The customer-facing flow is intentionally small:

1. Choose connector.
2. Enter values.
3. Verify authorization.
4. Choose permissions.
5. Test connection.
6. Activate.

The wizard uses plain labels, short help text, and status states: `draft`, `waiting`, `connected`, `needs_attention`, and `paused`.

## Host Theme Tokens
Host Theme Tokens let ActionBridge adapt visually without becoming a separate product surface:

- brand name and optional logo;
- primary/accent colors;
- background/card/border colors;
- compact or comfortable density;
- DE first, EN-ready language mode.

Inside Schwarzwald-Agent, ActionBridge should look native to Schwarzwald-Agent.

## Operator Surface
Operator Surface is separate from the customer wizard. Ricky/operators need connector status, verification state, safety status, permission status, redacted errors, audit summary, pause/kill switch, and secret-ref/bootstrap status. Customers do not need internal logs, raw policies, audit table rows, or service-role details.

## No raw secrets
Customer-facing setup must never expose raw secrets, token digests, idempotency keys, service-role data, raw connector internals, or raw audit rows. Public setup routes should accept non-secret setup values and keep network execution disabled until verification, policy, secret storage, and Sentinel controls are ready.

## Connector Notes
- Website: domain/setup-script verification and read-only extraction first.
- Webhook-v1: endpoint origin/path and receiver guide; HMAC secret bootstrap remains server-owned.
- WhatsApp Business: Phone Number ID, WABA ID, and Graph API version only; raw Meta tokens stay out of public setup.
