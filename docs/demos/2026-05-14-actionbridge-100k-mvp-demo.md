# ActionBridge 100k€ MVP Demo Flow

## Demo promise

Schwarzwald-Agent denkt und spricht. ActionBridge verbindet, übersetzt und führt sicher aus.

This demo shows ActionBridge as the universal connector layer for a customer-approved website. It does not require login bypass, paywall bypass, browser/RPA stealth, destructive writes, external scans, or fake production data.

## Demo target

Use a controlled local/staging tenant and a placeholder customer origin such as:

`https://demo-customer.example`

Do not run live network execution against third-party sites during the demo unless that target is explicitly authorized and scoped.

## Storyboard

MVP click-path: Setup-Link → Domain-Verifikation → Bridge-Handshake → Tool-Catalog → Dry-run Execution → Audit/Kill switches.

### 1. Operator creates customer setup link

Ricky/operator opens the future Schwarzwald-Agent dashboard integration and creates an ActionBridge setup link for the customer origin.

Backend contract used today:

`POST /api/actionbridge/setup-links`

Input:

```json
{ "targetOrigin": "https://demo-customer.example" }
```

Expected outcome:

- setup link created;
- raw `absl_...` token shown only once;
- token digest stored server-side;
- link expires and can be revoked.

### 2. Customer opens setup session

Customer opens the setup URL. ActionBridge resolves the public token into a safe setup session.

Backend contract:

`GET /api/actionbridge/setup-session?token=absl_...`

Expected customer-visible state:

- target origin;
- verification options: meta tag, DNS TXT, `.well-known`;
- one-line bridge script snippet;
- allowed initial capability choices;
- no `user_id`, secrets, token digests, idempotency keys, or connector internals.

### 3. Customer verifies authorization

Customer chooses one verification method:

- DNS TXT: `_actionbridge.demo-customer.example`
- Meta tag in `<head>`
- `.well-known/actionbridge-verify.txt`

Backend contract:

`POST /api/actionbridge/connectors/verify` then `PATCH /api/actionbridge/connectors/verify`

Expected outcome:

- verification stores digest-only token;
- HTTP verification uses HTTPS, manual redirects, timeout, DNS/IP guard, and response byte limit;
- verification activates permission but does **not** auto-enable broad network execution;
- human attestation remains lower trust and cannot unlock broad execution.

### 4. Customer installs bridge script

Customer copies one line into their approved site:

```html
<script src="https://actionbridge.example/actionbridge/bridge.js" data-setup-token="absl_..." async></script>
```

Expected outcome:

- script only performs connected-only handshake;
- no DOM scraping;
- no form submit;
- no credentials;
- browser sends origin + setup token + bridge version.

### 5. Bridge handshake marks site connected

Backend contract:

`POST /api/actionbridge/bridge/handshake`

Expected outcome:

- exact `Origin` header must match the setup link origin;
- origin mismatch fails;
- installation status becomes `connected`;
- mode remains `connected_only`.

### 6. Customer/operator enables safe capabilities

Backend contract:

`POST /api/actionbridge/capabilities`

Initial safe capabilities:

| Capability | Risk | Approval | Demo behavior |
| --- | --- | --- | --- |
| `site.knowledge.read` | read | no | Read approved public site knowledge only |
| `lead.prepare_draft` | write | yes | Prepare draft only; no CRM write or form submit |
| `appointment.request.prepare_draft` | write | yes | Prepare draft only; no booking/event creation |

Required controls:

- connector must be verified and active;
- client cannot set risk level;
- non-read capabilities require approval;
- transactional/destructive capabilities are absent from v1;
- disabled capabilities are not active tools.

### 7. Schwarzwald-Agent fetches ActionBridge tools

Backend contract:

`GET /api/actionbridge/agent-tools?connectorId=...`

Expected response:

- version `actionbridge.agent-tools.v1`;
- only enabled, verified, active connector catalogs;
- only safe tool fields: name, description, input schema, risk, approval flag, enabled;
- no base URL, `secret_ref`, raw config, token digest, idempotency key, or service-role data;
- no network execution during listing.

### 8. Agent uses tools safely

Demo interaction:

1. Visitor asks Schwarzwald-Agent: “Was bietet diese Firma an?”
2. Schwarzwald-Agent sees `site.knowledge.read` and can answer from approved public knowledge.
3. Visitor says: “Bitte Kontaktanfrage vorbereiten.”
4. Schwarzwald-Agent prepares `lead.prepare_draft`.
5. ActionBridge marks it approval-required; nothing is submitted automatically.
6. Operator/customer approves or rejects in the existing approval flow.

### 9. Audit and kill switch proof

Show that every step has a control point:

- setup link creation;
- verification challenge;
- bridge handshake;
- capability enablement;
- tool catalog listing;
- approval-required draft action;
- redacted inputs/outputs;
- read-only network kill switch remains available.

## Demo safety checklist

- [ ] Use only controlled/local/staging data.
- [ ] No login or paywall bypass.
- [ ] No CAPTCHA/anti-abuse bypass.
- [ ] No browser/RPA/stealth execution.
- [ ] No live third-party network execution without explicit scope.
- [ ] No destructive, transactional, payment, calendar-write, email-send, or CRM-write action.
- [ ] No secrets in screen recordings, logs, or chat.
- [ ] Draft/write capabilities require approval.
- [ ] Kill switches and audit/redaction are part of the demo narrative.

## 100k€ MVP message

For an agency/customer: “You don’t need to bring a perfect API. You verify your site, install one small bridge where needed, choose what the agent may do, and Schwarzwald-Agent receives safe tools. ActionBridge keeps the permissions, audit, approval, and kill switches between the agent and your business systems.”
