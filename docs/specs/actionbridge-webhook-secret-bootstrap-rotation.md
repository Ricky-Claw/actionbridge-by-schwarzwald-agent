# ActionBridge Webhook-v1 Secret Bootstrap + Rotation

## Status
Controlled pilot specification. This is not full production secret management; production still requires a managed secret store/KMS, access audit, rotation automation, and operator UI controls.

## Goals
- Enable HMAC-signed Webhook-v1 pilot connectors without raw secrets entering ActionBridge DB, logs, UI, setup links, tool catalog, or agent routes.
- Make every signing state explicit: `unsigned_pilot` or `hmac_sha256`.
- Fail closed when a configured signing ref is missing, malformed, or unresolved before throttle or network delivery.
- Preserve idempotency and audit continuity during rotation.

## Non-Goals
- No customer-supplied raw signing secrets through public setup/profile/connector APIs.
- No raw secret storage in Supabase connector rows.
- No browser-visible secret bootstrap.
- No automatic production rollout.

## Secret Ref Format
Pilot refs use an opaque server-owned handle:

```text
actionbridge:webhook-signing:<label>
```

Rules:
- prefix must be exactly `actionbridge:webhook-signing:`;
- label length keeps the full ref within 8..160 characters;
- label may contain only letters, numbers, dot, underscore, colon, and hyphen;
- raw secret values are never valid refs.

The DB must reject malformed non-null refs. HMAC mode must require a non-null ref. Public routes must keep rejecting `secretRef`, `secret_ref`, `secretValue`, and `secret_value` until a server-only admin path exists.

## Pilot Env Bootstrap
For pilot only, an operator provisions the receiver secret in server environment using the digest-derived variable name already used by the resolver:

```text
ACTIONBRIDGE_WEBHOOK_SIGNING_SECRET_<SHA256_REF_FIRST_16_UPPER_HEX>
```

Bootstrap steps:
1. Generate a random secret of 32..4096 bytes using an approved secret generator.
2. Choose a server-owned ref, e.g. `actionbridge:webhook-signing:pilot-webhook-0001`.
3. Store the raw secret only in the server runtime secret environment and the customer receiver secret store.
4. Update the connector row through a server-only/admin migration or backoffice operation:
   - `webhook_signing_mode = 'hmac_sha256'`
   - `secret_ref = '<server-owned ref>'`
5. Run a smoke delivery and verify receiver signature validation.
6. Verify all returned UI/agent/audit summaries expose only `secretRefDigest`, never the ref, env name, or secret value.

## Rotation Story
Rotation creates a new ref and new secret instead of mutating the old ref in place.

Safe rotation sequence:
1. Create new receiver secret and deploy receiver acceptance for both old and new signatures, or stage receiver to accept the new secret at cutover.
2. Add server runtime env for the new ref digest.
3. Update connector atomically to the new `secret_ref` while keeping `webhook_signing_mode = 'hmac_sha256'`.
4. Send a smoke delivery and confirm the receiver accepts the new signature.
5. Keep the old secret available for the agreed idempotency/retry window.
6. Retire the old receiver secret and remove old server env after the window.
7. Write a redacted audit/operator note containing connector id, old/new `secretRefDigest`, actor, timestamp, and result — never raw refs or secrets.

Idempotency/audit rule:
- Existing execution and approval records keep their original idempotency digest and audit chain.
- Signature verification is per delivery attempt timestamp/body/active connector ref.
- Rotation must not rewrite historical execution payloads or idempotency digests.

## Fail-Closed Rules
- `hmac_sha256` with missing ref: block before network.
- malformed ref: block before network.
- env secret absent or outside 32..4096 bytes: block before network.
- unresolved/malformed refs must produce redacted summaries only: `secret_ref_missing` or `secret_ref_unresolved` with optional `secretRefDigest`.

## Production Upgrade Requirements
Before broad rollout, replace the env shim with managed secret storage:
- KMS/secret-manager backed resolver;
- scoped service identity and least privilege;
- secret access audit metadata;
- rotation job or operator workflow with rollback;
- dual-secret grace window support if automatic retries are introduced;
- monitoring for unresolved refs and signature failures;
- Sentinel review and green behavioral route/import tests.
