# ActionBridge Webhook-v1 Secret Bootstrap + Rotation

## Status
Controlled pilot + production secret-resolver specification. Production webhook signing now has a managed Google Secret Manager REST resolver path with fail-closed behavior and redacted access-audit summaries; production still needs environment provisioning, rotation automation beyond the operator route, and operator UI controls before broad rollout.

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
3. Dry-run the authenticated operator route `POST /api/actionbridge/ops/webhook-secret-rotation` with `dryRun: true`, `connectorId`, `nextSecretRef`, and optionally `expectedCurrentDigest`.
4. Apply the atomic connector update only after receiver readiness and env resolution pass: send `dryRun: false` plus `X-ActionBridge-Rotation-Confirm: apply-webhook-signing-ref`. The route updates only `webhook_signing_mode = 'hmac_sha256'` and the server-owned `secret_ref`, then writes a redacted audit event.
5. Send a smoke delivery and confirm the receiver accepts the new signature.
6. Keep the old secret available for the agreed idempotency/retry window.
7. Roll back, if needed, by rerunning the same operator route with the previous server-owned ref after confirming the receiver old secret is available.
8. Retire the old receiver secret and remove old server env after the window.
9. Monitor unresolved-ref and signature-failure alerts until the rotation window closes.

Operator route safety controls:
- Authenticated owner scope; connector must belong to the operator and must be type `webhook`.
- Default dry-run; state change requires explicit confirmation header.
- `nextSecretRef` must be a server-owned ref and must resolve through the server-side resolver before any DB update.
- Optional `expectedCurrentDigest` prevents stale rotation consoles from overwriting a newer ref.
- Response and audit include only old/new `secretRefDigest`, rollback instruction, and monitoring markers — never raw refs or secrets.

Idempotency/audit rule:
- Existing execution and approval records keep their original idempotency digest and audit chain.
- Signature verification is per delivery attempt timestamp/body/active connector ref.
- Rotation must not rewrite historical execution payloads or idempotency digests.

## Fail-Closed Rules
- `hmac_sha256` with missing ref: block before network.
- malformed ref: block before network.
- env secret absent or outside 32..4096 bytes: block before network.
- unresolved/malformed refs must produce redacted summaries only: `secret_ref_missing` or `secret_ref_unresolved` with optional `secretRefDigest`.

## Production Managed Secret Resolver
Set production secret resolution to managed mode. This is the KMS/secret-manager backed resolver path for webhook signing:

```text
ACTIONBRIDGE_SECRET_MANAGER_PROVIDER=google_secret_manager_rest
ACTIONBRIDGE_SECRET_MANAGER_REQUIRED=true
ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_PROJECT_ID=<project>
ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_ACCESS_TOKEN=<scoped runtime token>
```

Behavior:
- `actionbridge:webhook-signing:<label>` maps to a provider-safe Google Secret Manager secret id using a digest-only deterministic form: `actionbridge-webhook-signing-<sha256-ref-prefix>`. Raw labels are never sent as secret IDs.
- The resolver reads `versions/latest:access` with a 3s timeout and fails closed for missing config, denied access, invalid payload, or provider errors.
- Result summaries include only `provider`, `accessAudit`, `secretRefDigest`, optional `versionResourceDigest`, and never raw refs, raw tokens, env names, or secret values.
- Pilot env lookup is disabled when managed secrets are required, including production mode.

Remaining production hardening before broad rollout:
- scoped service identity and least privilege token issuance;
- managed environment provisioning;
- operator UI controls for managed-secret rotation;
- rotation job or operator workflow with rollback;
- dual-secret grace window support if automatic retries are introduced;
- monitoring for unresolved refs and signature failures;
- Sentinel review and green behavioral route/import tests.
