# Sentinel Review — Webhook Secret Rotation Operator Route

**Date:** 2026-05-24 03:00 GMT+2  
**Scope:** Current uncommitted changes for `POST /api/actionbridge/ops/webhook-secret-rotation` and related docs/contracts.  
**Decision:** **NO-GO** 🛡️

## Executive Summary

The route adds important safety controls: authenticated access, owner-scoped connector lookup, dry-run default, explicit confirmation header for mutation, server-side secret-ref resolution, redacted response fields, and no raw secret value input.

However, production release remains blocked because the current implementation resolves `nextSecretRef` **before** proving the caller owns the connector. This creates a cross-tenant server-side secret-reference validity oracle for any authenticated user. The implementation also claims stale-console protection, rollback/monitoring, and audit coverage more strongly than the code enforces.

## Blockers

### High — Cross-tenant secret-ref validity oracle before ownership check

**Evidence:** `src/frontend/app/api/actionbridge/ops/webhook-secret-rotation/route.ts`

The route performs secret resolution before loading and authorizing the connector:

```ts
const signingResolution = resolveActionBridgeWebhookSigningSecret({
  connectorId,
  signingMode: 'hmac_sha256',
  secretRef: nextSecretRef,
});
if (!signingResolution.ok) {
  return NextResponse.json({ error: 'ACTIONBRIDGE_WEBHOOK_ROTATION_SECRET_UNRESOLVED', ... }, { status: 409 });
}

const { data: connector } = await supabase
  .from('actionbridge_connectors')
  .select(...)
  .eq('user_id', user!.id)
  .eq('id', connectorId)
  .maybeSingle();
```

An authenticated attacker can submit a connector ID they do not own, or a non-existent connector ID, and distinguish:

- unresolved/invalid server ref → `409 ACTIONBRIDGE_WEBHOOK_ROTATION_SECRET_UNRESOLVED`
- resolvable server ref + inaccessible connector → later `404 ACTIONBRIDGE_CONNECTOR_NOT_FOUND`

This leaks whether a server-owned secret reference currently resolves. Even though the raw secret is not returned, reference validity is sensitive control-plane metadata and can support targeted abuse, enumeration, and operational reconnaissance.

**Required fix:** Authorize first, resolve second.

1. Parse and validate shape only.
2. Load connector with `.eq('user_id', user.id).eq('id', connectorId)`.
3. Return generic not-found before any secret-ref resolution.
4. Verify connector type/status.
5. Then resolve `nextSecretRef`.
6. Consider returning a generic rotation failure for unresolved refs to reduce oracle value further.
7. Add regression tests proving a non-owned/non-existent connector cannot be used to probe ref resolution.

---

### High — `expectedCurrentDigest` stale-console protection is not atomic

**Evidence:** The digest check happens before the service-client update, but the update does not condition on the old `secret_ref` or digest:

```ts
if (expectedCurrentDigest && expectedCurrentDigest !== currentDigest) { ... }

await serviceSupabase
  .from('actionbridge_connectors')
  .update({ webhook_signing_mode: 'hmac_sha256', secret_ref: nextSecretRef, ... })
  .eq('user_id', user!.id)
  .eq('id', connectorId)
```

A concurrent rotation can occur after the digest check and before the update. The stale request can still overwrite the newer ref. This contradicts the spec claim that `expectedCurrentDigest` prevents stale rotation consoles from overwriting newer refs.

**Required fix:** Make the precondition part of the write.

- If `expectedCurrentDigest` is provided, update only when the current stored `secret_ref` matches the expected ref/digest.
- Prefer an RPC/transaction that compares the current digest server-side and performs the update atomically.
- If RPC is not available, include an exact old `secret_ref` match where safe, or introduce a DB-side digest/generated column for conditional update.
- Return `ACTIONBRIDGE_WEBHOOK_ROTATION_CURRENT_DIGEST_MISMATCH` when zero rows are updated due to precondition failure.
- Add a race/precondition regression test.

## Additional Findings

### Medium — Failed and denied rotation attempts are not audited

Only successful apply writes `webhook_signing_secret.rotated`. Failures such as unresolved ref, digest mismatch, missing confirmation, wrong connector type, and invalid input return without a control audit event.

For a sensitive control-plane route, denied/failed attempts should be auditable without leaking raw refs.

**Required fix:** Persist redacted denied/failed audit events for meaningful failure paths, especially unresolved ref, digest mismatch, missing confirmation on apply, and non-webhook connector attempts.

---

### Medium — Rollback and monitoring are markers, not enforced workflow

Docs/checklist now mark the operator rotation workflow with rollback and monitoring as complete. The route returns:

```ts
rollback: 'rerun_with_previous_server_owned_ref_after_receiver_old_secret_is_available',
monitoring: ['smoke_delivery_required', 'watch_unresolved_ref_and_signature_failure_alerts']
```

This is useful guidance but not an enforced job/workflow. There is no evidence in this diff of automatic smoke delivery, receiver verification, alert subscription, or rollback state capture beyond the digest summary.

**Required fix:** Adjust readiness wording to distinguish implemented markers from enforced monitoring/rollback, or add concrete workflow/job evidence.

## Positive Controls Observed

- Requires authenticated Supabase user.
- Connector update is owner-scoped by `user_id` and `id`.
- Mutations default to dry-run unless `dryRun: false` is explicitly provided.
- Apply requires `X-ActionBridge-Rotation-Confirm: apply-webhook-signing-ref`.
- Does not accept `secretValue` / `secret_value` raw secret fields.
- Response exposes digests, not raw secret refs or signing secrets.
- Success audit input contains `nextSecretRefDigest`, not `nextSecretRef`.
- Service update only changes `webhook_signing_mode`, `secret_ref`, and `updated_at`.

## Secret Leakage Assessment

- **Raw signing secret:** Not accepted or returned by the new route. Good.
- **Raw secret ref in response:** Not returned. Good.
- **Raw secret ref in audit:** Not present on success path. Good.
- **Raw secret ref in database:** Still stored as `secret_ref`; acceptable only if this remains a server-owned reference and not a secret. Protect DB visibility with RLS/service-role boundaries.
- **Ref validity leakage:** **High blocker** due to pre-authorization resolver oracle.

## GDPR / Privacy Notes

No direct personal data processing expansion observed. The main GDPR/security concern is operational metadata leakage and incomplete auditability of failed control-plane attempts.

## Required Acceptance Gates Before GO

- [ ] Move connector owner/type authorization before secret-ref resolution.
- [ ] Eliminate or materially reduce the secret-ref validity oracle.
- [ ] Make `expectedCurrentDigest` / stale-prevention atomic with the update.
- [ ] Add redacted audit events for failed/denied sensitive rotation attempts.
- [ ] Add tests for unauthorized probing, unresolved refs, digest mismatch, missing confirmation, dry-run no-op, and successful apply.
- [ ] Correct production-readiness docs if rollback/monitoring are markers rather than enforced workflow.

## Final Decision

**NO-GO** until the High findings are fixed and verified. Critical raw-secret leakage was not found, but the pre-auth secret-ref oracle and non-atomic stale protection are sufficient to block production release.
