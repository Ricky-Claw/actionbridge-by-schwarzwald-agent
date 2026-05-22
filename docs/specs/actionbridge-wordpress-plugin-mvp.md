# ActionBridge WordPress/WooCommerce Plugin MVP

## Goal

Create a customer-installed WordPress admin plugin that connects a WordPress/WooCommerce site to ActionBridge as a `backend_bridge` connector. The plugin is the server-side hand: it can expose explicitly approved CMS/shop capabilities while ActionBridge keeps policy, approval, audit, redaction, quarantine, and kill-switch controls.

## MVP scope

First version is a safe scaffold, not broad automation.

Allowed MVP capabilities:

- connection health check;
- WordPress site metadata summary;
- optional WooCommerce presence detection;
- create blog post **draft** only;
- read limited WooCommerce order summaries only when customer enables `backend.read:orders`;
- trigger a Schwarzwald-Agent workflow webhook if configured.

Out of scope for MVP:

- direct publish;
- order mutation/refunds/status changes;
- user/customer export;
- arbitrary SQL/database access;
- accepting secrets in browser JavaScript;
- unaudited background sync.

## Installation flow

1. Operator creates ActionBridge target + `backend_bridge` connector.
2. ActionBridge shows plugin install instructions and one-time pairing code.
3. Customer installs WordPress plugin from zip or repo.
4. WordPress admin enters ActionBridge base URL, target id, connector id, and one-time pairing code.
5. Plugin calls ActionBridge server-to-server to exchange pairing code for a server-owned secret reference/token.
6. Plugin stores local token encrypted/option-protected where possible.
7. Customer selects scopes in WordPress admin or ActionBridge setup UI.
8. Plugin registers capabilities with ActionBridge.
9. ActionBridge marks connector connected only after signed health check succeeds.

## Plugin files

Proposed location in this repo:

```txt
integrations/wordpress/actionbridge-wordpress/
  actionbridge-wordpress.php
  includes/
    class-actionbridge-settings.php
    class-actionbridge-client.php
    class-actionbridge-rest.php
    class-actionbridge-capabilities.php
    class-actionbridge-security.php
  readme.txt
```

## WordPress admin settings

Settings page: `Settings → ActionBridge`.

Fields:

- ActionBridge Base URL
- Target ID
- Connector ID
- Pairing Code / Connected Status
- Enabled scopes:
  - Blog draft creation
  - WooCommerce order summary read
  - Schwarzwald-Agent workflow trigger
- Disconnect/revoke button

Security:

- page requires `manage_options`;
- all admin forms use WordPress nonces;
- secrets never printed into page source after pairing;
- disconnect deletes local token and notifies ActionBridge.

## Local REST endpoints

Under WordPress REST namespace `actionbridge/v1`:

- `GET /health`
  - signed request only;
  - returns plugin version, site URL digest, enabled scopes, WooCommerce presence.

- `POST /blog/draft`
  - signed request only;
  - requires scope `backend.write_draft:blog_post`;
  - creates `post_status=draft`;
  - returns post id/status/edit link summary.

- `GET /orders/summary`
  - signed request only;
  - requires WooCommerce + scope `backend.read:orders`;
  - returns bounded summaries, not full customer export.

- `POST /workflow/trigger`
  - signed request only;
  - requires scope `workflow.trigger:<name>`;
  - triggers configured Schwarzwald-Agent workflow/webhook.

## Signing model

Every ActionBridge → plugin request must include:

- timestamp;
- nonce/idempotency digest;
- connector id;
- HMAC signature over method, path, timestamp, body digest, connector id.

Plugin rejects:

- missing/invalid signature;
- old timestamp;
- replayed nonce;
- disabled connector;
- missing scope;
- destructive actions.

## ActionBridge responsibilities

ActionBridge owns:

- tenant/connector identity;
- pairing-code issuance and exchange;
- secret manager/KMS storage;
- action approval;
- audit log;
- redaction;
- rate limits;
- quarantine/pause;
- kill switch;
- tool catalog generation.

WordPress plugin owns:

- local WordPress permission checks;
- executing only allowed local operations;
- protecting local token;
- returning minimized response summaries;
- uninstall/revoke cleanup.

## First implementation slice

Build only:

1. plugin directory scaffold;
2. admin settings page skeleton;
3. health endpoint;
4. capability constants;
5. HMAC verification helper skeleton;
6. documentation and contract tests.

Do not enable live draft creation until Sentinel reviews the signing/pairing implementation.
