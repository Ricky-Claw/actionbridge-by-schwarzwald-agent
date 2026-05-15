# Sentinel Review — Webhook-v1 Signing Secret-Ref Wiring

Date: 2026-05-15  
Reviewer: Sentinel 🛡️  
Scope:
- `src/frontend/lib/actionbridge/webhook-signing.ts`
- `src/frontend/app/api/actionbridge/execute/route.ts`
- `src/frontend/lib/actionbridge/webhook-delivery.ts`
- `docs/specs/actionbridge-webhook-v1-adapter.md`
- `scripts/test-actionbridge-contracts.mjs`
- `scripts/test-actionbridge-security-gauntlet.mjs`

## Verdict

**GO for controlled pilot only.**

The Webhook-v1 signing secret-ref wiring satisfies the Sentinel pilot gate: raw signing secrets are not accepted from client requests, not stored in connector rows by this implementation path, not returned to UI/tool/agent surfaces, and unresolved configured `secret_ref` fails closed before network delivery.

Production remains **NO-GO** until a real secret manager / KMS-backed resolver replaces the digest-derived environment variable shim, unsigned mode is represented by an explicit server-owned connector policy flag, and executable tests cover the HMAC and fail-closed behavior directly.

## Reviewed Control Findings

### 1. No raw secrets in DB / logs / UI / agent routes — PASS

Evidence:
- Connector creation rejects `secretRef`, `secret_ref`, `secretValue`, and `secret_value` in `src/frontend/app/api/actionbridge/connectors/route.ts`.
- Setup profile rejects the same secret fields in `src/frontend/app/api/actionbridge/setup-profile/route.ts`.
- Connector list responses omit `secret_ref`.
- Execute response includes only `signingResolution.resultSummary`, which contains either `unsigned_pilot_mode`, `secret_ref_unresolved`, or `hmac_sha256` plus `secretRefDigest`; it does not include `signingSecret` or raw `secret_ref`.
- `webhook-signing.ts` has no logging path and redacts unresolved summaries.

Residual note: `execute/route.ts` must select `secret_ref` server-side to resolve signing, but it does not serialize it to user/agent output.

### 2. No client-supplied secret values accepted — PASS

Evidence:
- Client-facing connector/profile endpoints explicitly reject secret reference/value fields.
- Webhook delivery uses `webhookConnector.secret_ref` loaded from server-owned connector storage, not request body input.
- The execute request body can still supply normal action input/path for existing execution planning, but not signing material.

### 3. Unresolved configured `secret_ref` fails closed before network — PASS

Evidence:
- `resolveActionBridgeWebhookSigningSecret()` returns `ok: false` when a syntactically valid `secret_ref` has no matching server env value or the value length is outside 32..4096 bytes.
- `execute/route.ts` branches on `!signingResolution.ok` before calling `deliverActionBridgeWebhook()`.
- The unresolved result sets `networkExecution: false` and persists the execution as failed.

### 4. Signed deliveries pass `signingSecret` only server-side — PASS

Evidence:
- `signingSecret` is returned only inside the server-only resolver and passed directly into server-only `deliverActionBridgeWebhook()`.
- `webhook-delivery.ts` uses it only to compute `X-ActionBridge-Signature = sha256=<hmac>` over `timestamp.body`.
- Result summaries include digest metadata only, not the raw secret or raw ref.

### 5. Unsigned pilot mode remains explicit — PASS WITH CONDITION

Evidence:
- Absence or invalid format of `secret_ref` yields result summary `signing: unsigned_pilot_mode`.
- The spec now states unsigned mode is allowed only for controlled pilot connectors with compensating controls.

Condition:
- This is acceptable for the controlled pilot because webhook delivery is still gated by connector type, approval consumption, network execution controls, exact-origin allowlist, DNS/IP guard, rate limit, and failure quarantine.
- Before production, unsigned mode should require an explicit server-owned connector field such as `webhook_signing_mode = 'unsigned_pilot' | 'hmac_sha256'`, not implicit null/invalid `secret_ref`.

### 6. No env secret leaks beyond digest metadata — PASS

Evidence:
- Env lookup name is derived as `ACTIONBRIDGE_WEBHOOK_SIGNING_SECRET_<16-hex-digest>` from the normalized ref.
- Responses/audit summaries expose only `secretRefDigest: sha256:<16-hex-digest>`.
- Raw env variable names and raw env secret values are not returned.

Residual note: the 16-hex digest is suitable metadata for pilot correlation but should be treated as semi-sensitive operational metadata in production logs.

## Test / Spec Coverage

Observed coverage added:
- Contract test requires `webhook-signing.ts` and markers for resolver, env prefix, secret-ref digest, unresolved fail-closed, and unsigned pilot mode.
- Security gauntlet checks signing resolver markers and execute-route wiring markers.
- Spec now requires HMAC when server-owned `secret_ref` exists and fail-closed behavior when unresolved.

Coverage gap:
- Current tests are mostly static marker tests. Add executable unit/integration tests before production for:
  - valid `secret_ref` + env secret creates expected HMAC header;
  - unresolved valid `secret_ref` makes no outbound request;
  - invalid/missing `secret_ref` is reported as explicit unsigned pilot mode;
  - result/audit payloads never contain raw `secret_ref`, env name, or secret value.

## Vulnerabilities / Risks

| Severity | Finding | Impact | Required Fix |
| --- | --- | --- | --- |
| Medium | Unsigned mode is implicit when `secret_ref` is absent/invalid. | Misconfiguration could silently run unsigned in pilot. | Add explicit server-owned signing mode before production. |
| Medium | Secret resolver is env-var shim, not managed secret storage. | Operational rotation/audit/access control are weak for production. | Replace with KMS/secret-manager resolver and audit secret access metadata. |
| Low | Static tests can miss behavioral regressions. | Marker presence may pass while runtime behavior breaks. | Add executable signing/fail-closed tests. |

## Pilot Acceptance Gates

Approved for controlled pilot only if all remain true:
- Connector is customer-authorized and verified.
- `network_execution_enabled`, `safety_status`, and `permission_status` gates remain active.
- Webhook delivery stays approval-consumed and exactly-once idempotency-bound.
- Unsigned pilot connectors are explicitly tracked operationally and limited to known pilot endpoints.
- No production customer broad rollout until the production fixes above are complete.

## Final Decision

**Sentinel decision: GO for controlled pilot.**  
**Production decision: NO-GO until explicit signing mode, managed secret storage, and executable HMAC/fail-closed tests are in place.**
