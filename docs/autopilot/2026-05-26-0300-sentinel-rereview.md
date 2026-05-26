# Sentinel Re-review — ActionBridge Webhook Secret Resolver Fixes

**Decision: NO-GO for commit/push of this slice.**

The main production-claim and async-resolver fixes moved in the right direction, but one remaining loggable-output leak path blocks this slice.

## High/Critical blockers

### High — Rotation route can echo/log arbitrary `expectedCurrentDigest`

`src/frontend/app/api/actionbridge/ops/webhook-secret-rotation/route.ts` accepts `expectedCurrentDigest` / `expected_current_digest` as any string, lowercases it, and then includes it in:

- `redactedRequestInput.expectedCurrentDigest` persisted to control audit events;
- digest-mismatch `resultSummary.expectedCurrentDigest` persisted to audit;
- digest-mismatch JSON response `expectedCurrentDigest`.

Because the field is not validated as a digest before being logged/returned, an operator or integration error can paste a raw secret ref, token, or secret value into `expectedCurrentDigest` and ActionBridge will preserve/expose it in loggable outputs. The key name is not matched by the current redaction-sensitive-key pattern, so relying on `redactActionBridgeValue` would not be enough here.

**Required fix before GO:** validate `expectedCurrentDigest` before use. Accept only `null` or the exact server digest format emitted by this route, e.g. `^sha256:[a-f0-9]{16}$`. For invalid values, return `400 INVALID_ACTIONBRIDGE_WEBHOOK_SECRET_ROTATION` and audit only a safe marker such as `{ expectedCurrentDigestInvalid: true }`, never the invalid raw value. Also ensure mismatch responses/audit summaries only contain validated digest strings.

## Verified fixed from previous Sentinel review

- **Docs no longer falsely close production KMS/secret-manager as complete.**
  - `docs/production-readiness-checklist.md` keeps real secret manager/KMS integration unchecked and says production rollout remains blocked on provisioning, least-privilege identity/token issuance, operator UI controls, and Sentinel release review.
  - `docs/sentinel-production-blockers.md` keeps `production KMS/secret-manager resolver with access audit` unchecked and scopes the current work to a managed resolver primitive.
- **Rotation route now uses the async managed resolver.**
  - `src/frontend/app/api/actionbridge/ops/webhook-secret-rotation/route.ts` imports `resolveActionBridgeWebhookSigningSecretAsync as resolveActionBridgeWebhookSigningSecret` and awaits it before applying rotation.
  - Execute route also awaits the async resolver.
- **Resolver summaries do not expose raw secret refs/tokens/secrets in reviewed provider paths.**
  - Google Secret Manager resolver returns `provider`, `accessAudit`, `httpStatus`, `secretRefDigest`, and `versionResourceDigest` only.
  - Raw Google access token is only used in the `Authorization` header and is not included in result summaries.
  - Provider secret ID mapping is digest-only and does not pass raw labels to Google Secret Manager secret IDs.

## Verification run

- `npm run test:behavioral-security` ✅
- `npm run typecheck` ✅
- `git diff --check` ✅

These gates pass, but they do not cover the unvalidated `expectedCurrentDigest` leakage path above.
