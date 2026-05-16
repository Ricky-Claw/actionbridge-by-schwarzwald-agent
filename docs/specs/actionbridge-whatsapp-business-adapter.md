# ActionBridge WhatsApp Business Adapter

## Purpose
Add WhatsApp Business Cloud API as an ActionBridge connector adapter. ActionBridge remains the connector/control layer; Schwarzwald-Agent or another approved agent remains the assistant/operator.

## User Setup Goal
A user should be able to create a WhatsApp Business connector by entering non-secret Meta values:
- connector name;
- WhatsApp Phone Number ID;
- WhatsApp Business Account ID / WABA ID;
- Graph API version, default `v20.0`.

Raw Meta access tokens are not accepted in public connector forms. Token bootstrap must use server-owned secret storage / secret refs.

## Connector Type
`type = whatsapp_business`

Stored connector shape:
- `base_url`: fixed Meta Graph messages endpoint for the phone number ID, e.g. `https://graph.facebook.com/v20.0/<PHONE_NUMBER_ID>/messages`;
- `auth_mode = bearer`;
- `secret_ref = null` from public setup until server-owned token storage exists;
- `allowed_origins = ["https://graph.facebook.com"]`;
- `network_execution_enabled = false` by default;
- `safety_status = untested`, `permission_status = draft`.

Non-secret values may be represented in capabilities:
- `whatsapp.business.cloud_api`
- `whatsapp.phone_number_id:<id>`
- `whatsapp.business_account_id:<id>`
- `whatsapp.graph_api_version:<version>`
- `whatsapp.message.send`
- `whatsapp.template.send`
- `approval_required`
- `server_secret_ref_required`

## Future Tools
Initial tool catalog should expose dry-run capabilities only until Meta token storage and policy are complete:
- `whatsapp.message.send` — write, approval required, 24h customer-care window required;
- `whatsapp.template.send` — write, approval required, approved Meta template name required;
- `whatsapp.conversation.read` — read, only if scoped webhook/event storage exists.

## Safety Rules
- No raw Meta access token in DB, logs, UI, setup-session route, tool catalog, or agent route.
- No agent-supplied Graph API target URL.
- No arbitrary recipient blast/bulk send in MVP.
- Message sends require policy, approval, rate limit, audit, and Meta compliance checks.
- Template sends require approved template name, locale, variables, and user/business scope.
- Network execution remains false until Sentinel signs off token storage and send execution.

## Production Requirements
Before live WhatsApp sends:
- Meta Business app/WABA verification flow;
- server-owned token secret refs/KMS;
- webhook verification and signature validation;
- inbound event minimization/redaction;
- rate limits per tenant/phone/action/recipient;
- template and 24h window enforcement;
- opt-out handling;
- Sentinel review and behavioral tests.
