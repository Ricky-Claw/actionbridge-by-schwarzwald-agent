# ActionBridge Universal Backend Bridge SDK Contract

## Goal

Define the universal backend-side contract that all deep integrations use. WordPress, Shopify, Webflow, custom backends, database proxies, and Schwarzwald-Agent workflows become adapters on top of the same contract.

## Core idea

ActionBridge Core owns policy, tenant identity, pairing, approval, audit, redaction, quarantine, rate limits, and kill switches.

Customer systems install one of:

- generic server SDK;
- platform plugin using the SDK contract;
- thin database/read-model proxy;
- workflow endpoint adapter.

All adapters expose the same safe surface:

```ts
ActionBridgeBackend.register({
  targetId,
  connectorId,
  sharedSecret,
  capabilities: ['backend.read:orders', 'backend.write_draft:blog_post'],
  handlers: {
    'backend.read:orders': async (input, ctx) => ({ orders: [] }),
    'backend.write_draft:blog_post': async (input, ctx) => ({ draftId: '...' }),
  },
});
```

## Mandatory adapter endpoints

Every backend bridge adapter should expose:

- `GET /actionbridge/health`
  - signed request;
  - returns version, target/connector id, enabled capabilities, platform, health.

- `POST /actionbridge/execute`
  - signed request;
  - accepts one capability/action name and redacted input;
  - verifies scope locally;
  - executes only registered handler;
  - returns minimized result summary.

Optional:

- `POST /actionbridge/revoke`
  - signed request;
  - disconnects local adapter and clears local secret.

## Signing contract

ActionBridge signs every backend request with:

- `X-ActionBridge-Timestamp`
- `X-ActionBridge-Nonce`
- `X-ActionBridge-Connector-Id`
- `X-ActionBridge-Signature`

Signature payload:

```txt
METHOD\nPATH\nTIMESTAMP\nNONCE\nCONNECTOR_ID\nSHA256_BODY
```

Signature:

```txt
sha256=<hmac_sha256(payload, sharedSecret)>
```

Adapter must reject:

- missing headers;
- invalid signature;
- expired timestamp;
- replayed nonce;
- connector id mismatch;
- unknown capability;
- disabled capability;
- destructive action in MVP.

## Capability naming

Allowed MVP prefixes:

- `backend.read:<resource>`
- `backend.write_draft:<resource>`
- `workflow.trigger:<name>`
- `database.read_model:<view>`

Disallowed MVP:

- `backend.delete:*`
- `backend.publish:*`
- `backend.refund:*`
- `database.raw_sql:*`
- arbitrary browser/RPA actions

## Adapter responsibility

Adapters must:

- keep secrets server-side;
- minimize returned data;
- map platform permissions locally;
- avoid raw customer exports;
- log local action id/result summary;
- support disconnect/revoke;
- never trust client/browser-provided scopes.

## ActionBridge responsibility

ActionBridge must:

- issue short-lived pairing codes;
- store only code digests;
- store real secrets in server-side secret manager/KMS;
- create typed tool catalog from approved capabilities;
- require approval for writes;
- audit every request/result;
- pause/quarantine connector on repeated failures;
- enforce kill switches.

## First build slice

Build a local TypeScript SDK scaffold under `integrations/backend-sdk/typescript`:

- capability sanitizer;
- registration object validator;
- signature creation/verification;
- replay-cache interface;
- handler registry;
- health response builder;
- execute dispatcher that blocks unknown/destructive capabilities.

This SDK should be dependency-light and framework-neutral so adapters can use it in Express, Next, Fastify, serverless functions, or platform plugins.
