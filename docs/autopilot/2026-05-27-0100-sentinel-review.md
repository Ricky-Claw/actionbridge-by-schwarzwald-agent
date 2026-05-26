# Sentinel Review — Webhook Signing Rotation Operator UI

Timestamp: 2026-05-27 01:00 Europe/Berlin
Scope: current uncommitted changes for `/actionbridge/operator` webhook signing rotation UI, including the new client component and related readiness/blocker documentation updates.

## Decision

GO for controlled pilot continuation.

No Critical or High blockers found in the inspected UI change.

## Security Findings

- Critical: none.
- High: none.
- Medium: none blocking.
- Low: Operator UX relies on training text for the receiver smoke-test step before apply. The route remains dry-run-first and requires the explicit apply confirmation header, so this is acceptable for pilot. Before broader production rollout, consider a stronger UI gate that requires the operator to acknowledge/record the smoke-test evidence before enabling apply.

## Controls Verified

- Authentication/authorization remains server-enforced by existing APIs. Connector list and rotation requests are scoped to the authenticated user.
- UI does not display stored raw secret refs. Connector state displays digest-only `webhookSecretRefDigest` from the server.
- Rotation submit path keeps dry-run as the default action and only sends `x-actionbridge-rotation-confirm: apply-webhook-signing-ref` for the explicit apply button.
- Optional CAS `expectedCurrentDigest` is passed through to the server route for stale-update protection.
- Result rendering uses React text rendering via `JSON.stringify` inside `<pre>`, not raw HTML injection.
- Documentation updates accurately keep production KMS/secret-manager provisioning and Sentinel review as remaining blockers while noting operator UI availability.

## Verification

- `npm run typecheck -- --pretty false` — passed.
- `npm run lint -- --max-warnings=0` — passed.

## Production Notes

Production release still depends on the already-documented managed secret/KMS provisioning, least-privilege service identity/token issuance, and final Sentinel release review. This UI change alone does not close those production blockers.
