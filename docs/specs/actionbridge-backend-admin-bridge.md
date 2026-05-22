# ActionBridge Backend/Admin Bridge Connector

ActionBridge remains universal because it supports multiple legal connection paths under one policy model:

1. **Public website/script path** — proves ownership and inventories public routes/forms.
2. **API/OAuth path** — uses official customer-approved APIs when available.
3. **Admin plugin / server SDK path** — customer installs a plugin/SDK inside their CMS/shop/backend.
4. **Database proxy path** — customer exposes approved read models/views through a narrow server-side proxy.
5. **Schwarzwald-Agent workflow path** — ActionBridge triggers approved internal workflows instead of touching third-party systems directly.

## What the browser script does

The browser script is not the backend connector. It may:

- prove that the customer controls a domain/admin surface;
- hand off setup state;
- show install/status UI;
- inventory public forms/routes;
- report connection health.

It must not contain raw API tokens, database credentials, admin passwords, secret refs, session cookies, or unrestricted private customer data.

## What enables internal data/actions

Internal orders, CRM records, CMS posts, tickets, and database rows require a server-side connector:

- WordPress/WooCommerce plugin;
- Shopify/Webflow/CRM API/OAuth app;
- customer backend SDK;
- database read-model proxy;
- approved Schwarzwald-Agent workflow endpoint.

The customer explicitly chooses scopes such as `backend.read:orders`, `backend.write_draft:blog_post`, or `workflow.trigger:new_lead`. ActionBridge turns those into typed tools only after verification, consent evidence, policy, approval, audit, rate limits, and kill-switch checks.

## Pilot boundary

For the first backend/admin bridge slice:

- allow connector type `backend_bridge`;
- store only non-secret capability metadata;
- force server-owned secret refs later for live execution;
- keep write/transactional actions approval-gated;
- prefer draft/create-workflow actions before direct publish/update/delete;
- expose setup contract text to UI, not credentials.

## Required controls

- customer consent evidence;
- tenant isolation and owner scoping;
- least-privilege scopes;
- server-only secret manager/KMS;
- no browser secrets;
- approval before writes;
- audit logs for every setup/action;
- redacted visibility routes;
- connector quarantine/pause;
- kill switch;
- safe uninstall/revoke path.
