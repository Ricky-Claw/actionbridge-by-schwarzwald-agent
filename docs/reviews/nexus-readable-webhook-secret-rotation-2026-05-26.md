# Nexus Readable Review — Webhook Secret Rotation UI/API (2026-05-26)

## Verdict
**GO for pilot.** The readable connector screen can expose webhook signing status and run dry-run/apply rotation without sending raw secrets to the browser.

**Production caveat:** still not a full enterprise rotation workflow until Sentinel step-up/role enforcement, smoke-delivery enforcement, and managed secret-manager operations are bound end-to-end.

## What changed
- Connector list API now returns `webhookSigningMode` and a short `webhookSecretRefDigest` for webhook connectors only.
- Connectors UI adds a Webhook Signing panel with:
  - current signing mode,
  - current ref digest,
  - next server-owned secret ref input,
  - dry-run by default,
  - explicit apply checkbox/header.
- UI sends only `nextSecretRef`, `expectedCurrentDigest`, and `dryRun`; no raw signing secret is exposed client-side.

## Nexus assessment
1. **Connector type:** ActionBridge webhook control-plane connector UI + rotation route.
2. **Supported actions:** read connector signing status, dry-run signing-ref rotation, apply signing-ref rotation.
3. **Required auth/session:** authenticated Supabase user; connector query is owner-scoped; mutation route uses service client only after auth, connector ownership, resolver, and confirmation gates.
4. **Risk per action:**
   - Status read: low/control-plane read; digest disclosure only.
   - Dry-run: medium control preview; resolver oracle is owner-scoped.
   - Apply: high control-plane write; changes webhook delivery signing behavior.
5. **Sentinel policy references:** `sentinel.actionbridge.webhook_signing_secret.rotate.v1` is present in route audit/result summaries.
6. **Test plan:**
   - `npm run typecheck` — pass.
   - `npm run lint` — pass.
   - Recommended next: route-level behavioral mocks for digest mismatch, unresolved ref, missing apply header, successful dry-run, successful apply, and non-webhook connector denial.
7. **Rollback/disable plan:** rerun rotation with the previous server-owned ref once receiver old secret is available; emergency stop by disabling connector/network execution or removing service/secret-manager env so apply fails closed.

## Residual concerns
- The digest shown in UI is acceptable for pilot, but ref labels should remain non-guessable enough that digest matching does not leak meaningful operator naming patterns.
- Apply confirmation is a UI checkbox + header, not true step-up approval. Keep pilot/operator-only until Sentinel binds stronger approval/role controls.
- The UI tells operators to check smoke delivery/alerts, but the route does not enforce those post-rotation checks.
