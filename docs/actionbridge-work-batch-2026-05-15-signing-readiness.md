# ActionBridge Work Batch — Signing + Readiness

## Goal
Advance ActionBridge without user-by-user prompting by closing a coherent set of pilot hardening and production-readiness gaps.

## Tasks Covered
1. Webhook-v1 HMAC secret-ref resolver.
2. Fail-closed unresolved signing refs before network delivery.
3. Explicit `webhook_signing_mode` migration.
4. Connector response surfaces expose signing mode, not secrets.
5. Webhook spec updated for signing semantics.
6. Receiver verification guide added.
7. Production readiness checklist added.
8. Sentinel production blockers tracker added.
9. Error log retention/GDPR policy added.
10. Behavioral test roadmap added.
11. Pilot smoke test runbook added.
12. README updated with current pilot capabilities and production blockers.
13. Contract/security tests expanded for these artifacts.
14. Sentinel review requested for signing/readiness batch.

## Verification
Required before commit:
- `npm test`
- `git diff --check`
- Sentinel GO or no High/Critical blocker.

## Boundaries Preserved
- No raw secrets accepted from public routes.
- No secrets exposed to tool catalog, agent routes, logs, or UI.
- No production/broad-rollout claim.
- No customer/external action performed.
