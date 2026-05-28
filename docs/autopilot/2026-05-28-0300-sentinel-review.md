# Sentinel Re-Review — ActionBridge Secret Manager Live Probe

**Date:** 2026-05-28 03:08 CEST  
**Scope:** Current uncommitted ActionBridge change, focused on `src/frontend/app/api/actionbridge/ops/secret-manager-live-probe/route.ts`, `src/frontend/lib/actionbridge/rate-limit.ts`, and production-blocker wording.  
**Controlled pilot decision:** **GO**  
**Production decision:** **NO-GO remains** until the documented production Secret Manager prerequisites are complete.

## Executive assessment

The prior Sentinel **Medium** findings for this route are addressed for controlled pilot use.

No remaining **Critical** or **High** blockers were found in this re-review. The live-probe route is authenticated, owner-scoped, per-user/per-connector throttled, redacts raw secret references, and now fails closed when the audit service client is unavailable or audit persistence fails.

Production remains blocked correctly: the docs still require real managed Secret Manager provisioning, least-privilege service identity/token issuance, real live-access evidence, and Sentinel release review before production rollout.

## Re-review findings

### Resolved — Audit persistence is now fail-closed

**Evidence:** `route.ts` creates the service-role audit client before connector lookup/probing and returns `503 ACTIONBRIDGE_SECRET_MANAGER_PROBE_AUDIT_UNAVAILABLE` if unavailable. After the probe, `persistActionBridgeControlAuditEvent(...)` must succeed; otherwise the route returns `503 ACTIONBRIDGE_SECRET_MANAGER_PROBE_AUDIT_FAILED` and marks `auditPersisted: false`.

**Sentinel judgment:** Acceptable for controlled pilot. Live probe evidence is only accepted when the redacted audit row persists.

### Resolved — Route-level throttling added

**Evidence:** `rate-limit.ts` defines `secretManagerLiveProbe: { windowMs: 15 * 60_000, max: 5 }`; `route.ts` calls `enforceActionBridgeRateLimitAsync({ policyName: 'secretManagerLiveProbe', discriminator: `${user.id}|${connectorId}` })` before external Secret Manager access.

**Sentinel judgment:** Acceptable for controlled pilot. Production still depends on `ACTIONBRIDGE_RATE_LIMIT_MODE=production_distributed` with trusted proxy identity and configured distributed store, as already documented.

### No new Critical/High — Secret/ref leakage check

**Evidence:** The route selects `secret_ref` server-side only, passes it to the resolver, and exposes/audits `secretRefDigest` only. Probe summaries from `webhook-signing.ts` use digest-only secret refs and digest-only provider version resources; no raw secret payload, access token, raw `secret_ref`, or provider resource name is returned.

**Sentinel judgment:** Pass.

## Control checks

- **Authentication:** Pass — `supabase.auth.getUser()` required; unauthenticated requests return `401`.
- **Authorization / owner scope:** Pass — connector query includes `.eq('user_id', user.id)` and `.eq('id', connectorId)` before probing.
- **Input validation:** Pass for route boundary — connector ID is parsed as a trimmed string and must be present; connector must be webhook + `hmac_sha256` + `secret_ref`.
- **API security:** Pass for pilot — per-user/per-connector route throttle added; production distributed throttling remains a production gate.
- **Audit trail:** Pass for pilot — unavailable audit client or failed audit insert returns `503` and does not produce accepted evidence.
- **Secrets management:** Pass for this route — raw refs/secrets/tokens are not returned; digest-only evidence.
- **Infrastructure / production readiness:** NO-GO remains for production until managed environment provisioning and least-privilege identity/token proof exist.
- **GDPR/data minimization:** Pass — response/audit contain operational metadata and digests only.

## Verification evidence

Fresh verification run from `/data/.openclaw/workspace-breaker/actionbridge-by-schwarzwald-agent`:

```bash
node scripts/test-actionbridge-behavioral-modules.mjs && node scripts/test-actionbridge-contracts.mjs
```

Result: exit code `0`. Relevant passing checks included the new source-level assertion that the secret-manager live-probe route is owner-scoped, throttled, writes redacted audit evidence, and fails closed.

## Gate decision

**Controlled pilot:** **GO**

Conditions:
1. Treat live-probe evidence as valid only when the response has `auditPersisted: true` and the corresponding redacted audit row exists.
2. Keep the route limited to trusted pilot/operator usage; do not market it as production Secret Manager readiness.
3. Keep distributed rate limiting required for production/multi-instance rollout.

**Production:** **NO-GO remains**

No remaining Critical/High blockers in this patch, but production release remains blocked by the existing open Secret Manager/KMS gate: real provider provisioning, least-privilege service identity/token issuance, real live-access evidence, and Sentinel release review.
