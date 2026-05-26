# Sentinel Review — ActionBridge Webhook Secret Resolver

**Decision: NO-GO for production release.** Controlled pilot can continue only if `ACTIONBRIDGE_SECRET_MANAGER_REQUIRED` is not asserted as production-complete and rollout remains behind existing ActionBridge gates.

## High/Critical blockers

### High — Production secret-manager claim is ahead of the implementation
Changed docs mark the production KMS/secret-manager blocker as closed, but the implementation is only a direct Google Secret Manager REST lookup using a bearer token from process env:

- `docs/production-readiness-checklist.md` changes Gate 2 to `[x] Real secret manager/KMS integration for production`.
- `docs/sentinel-production-blockers.md` changes `production KMS/secret-manager resolver with access audit` to `[x]`.
- `src/frontend/lib/actionbridge/webhook-signing.ts` reads `ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_ACCESS_TOKEN` and calls `https://secretmanager.googleapis.com/.../versions/latest:access` directly.

This does not yet prove production-grade secret management because scoped service identity/token issuance, operator UI controls, and broader rollout provisioning remain explicitly listed as unfinished in the spec. Treating the blocker as closed creates release-risk drift.

### High — Managed-secret rotation path is not proven in changed source
The changed execute route now awaits `resolveActionBridgeWebhookSigningSecretAsync`, but the operator rotation source is not part of this diff. The existing sync compatibility resolver returns `secret_manager_async_required` whenever `ACTIONBRIDGE_SECRET_MANAGER_PROVIDER=google_secret_manager_rest`, so any unchanged caller of `resolveActionBridgeWebhookSigningSecret` will fail closed rather than validate managed refs.

Evidence:
- `src/frontend/app/api/actionbridge/execute/route.ts` imports `resolveActionBridgeWebhookSigningSecretAsync as resolveActionBridgeWebhookSigningSecret` and awaits it.
- `src/frontend/lib/actionbridge/webhook-signing.ts` keeps the sync export and blocks managed provider with `secret_manager_async_required`.

Fail-closed is safe, but production rotation/readiness cannot be marked complete until all managed-secret paths are updated and tested.

## Secret/ref/token leakage assessment

**Raw secret values:** No direct leak found in changed result summaries. `signingSecret` is returned separately to the delivery path, while summaries contain only status/provider/digests.

**Raw secret refs:** No raw `secretRef` is emitted by the changed resolver. Summaries use `secretRefDigest` only.

**Raw Google access token:** No direct token leak found in returned summaries/loggable resolver outputs. The token is used only in the `Authorization: Bearer ...` request header and not included in `resultSummary`.

**Remaining caution:** Success summaries are not passed through `redactActionBridgeValue`, but the current fields are digest/status/provider only. Keep that invariant tested so future provider summaries cannot include raw refs, resource names, env names, or tokens.

## Additional evidence from changed files

- `providerRequired()` disables pilot env lookup when `ACTIONBRIDGE_SECRET_MANAGER_REQUIRED=true` or `NODE_ENV=production`, which is a good fail-closed control.
- Google resolver uses `AbortSignal.timeout(3000)` and returns redacted failure statuses (`config_missing`, `access_denied_or_unavailable`, `invalid_secret_payload`, `provider_exception`).
- Secret validation enforces 32..4096 byte length before use.
- Docs still list unfinished production hardening, conflicting with checklist/blocker closure.

## Required fixes before GO

1. Reopen production blocker/checklist items or scope them explicitly to “managed resolver primitive implemented, production rollout still blocked.”
2. Update and test every managed-secret caller, especially rotation, to use the async resolver or an equivalent managed-provider validation path.
3. Add focused tests proving: no raw secret/ref/token/env-name in result summaries; production env lookup fails closed; Google provider success/failure summaries are digest-only; rotation works or is explicitly blocked in managed mode.
