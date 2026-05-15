# Sentinel Final Re-Review — ActionBridge Onboarding

**Date:** 2026-05-15 14:09 CEST  
**Reviewer:** Sentinel 🛡️  
**Scope:** Re-review of current local working tree after prior NO-GO fixes. Local repo only; no external/customer-system testing.

## Verdict: GO for local pilot onboarding smoke test

ActionBridge onboarding is now **GO for a controlled local/customer-pilot smoke test** under the existing constraints: read-only by default, no destructive/write execution, no customer-system testing without explicit approval, and no production network execution unless Sentinel re-approves the final deployment configuration.

The previous NO-GO items are materially addressed in the current working tree.

## Evidence

### 1. Setup replay closure — addressed

- `src/frontend/app/api/actionbridge/bridge/handshake/route.ts` only accepts setup links in `pending` or `opened` state.
- Successful bridge handshake updates the setup link to `completed`, closing token replay for repeated bridge handshakes.
- Existing revoked bridge installations are not revived.
- `src/frontend/app/api/actionbridge/setup-session/route.ts` rejects unusable/closed setup sessions and transitions first open from `pending` to `opened`.

### 2. Onboarding control-plane audit — addressed

- Setup creation is audited via `setup_link.created` in `setup-links/route.ts`.
- Setup status transitions are audited by DB trigger migration `supabase/migrations/20260515000100_actionbridge_onboarding_audit_triggers.sql` as `setup_link.<status>` events.
- Bridge success is audited as `bridge.handshake.connected`.
- Domain verification challenge/result and connector status changes are audited in `connectors/verify/route.ts`.
- Capability enable/disable is audited in `capabilities/route.ts`.

### 3. GDPR/PII redaction — addressed for current audit surfaces

- `src/frontend/lib/actionbridge/redaction.ts` now redacts secret keys plus common GDPR/PII markers: email, phone/mobile/telephone, contact, address/street, IBAN/BIC, taxId, vatId.
- String-level patterns redact email, IBAN, and phone-like values.
- Verification evidence and capability configs are passed through redaction before persistence/audit responses.

### 4. `human_attestation` disabled for pilot — addressed

- `src/frontend/app/api/actionbridge/connectors/verify/route.ts` exposes only `well_known`, `meta_tag`, and `dns_txt` in the active `METHODS` set.
- `human_attestation` remains in lower-level domain-verification types/tests, but the pilot API route does not accept it as an active customer onboarding method.

### 5. Prior bridge/read-only fixes — addressed

- Bridge handshake is connected-only: no DOM scraping, form submit, cookies, credentials, or secret exposure.
- Connector allowlists remain server-owned and origin-normalized.
- `network_execution_enabled` defaults false in migrations and connector creation.
- Execute route returns dry-run/noop when network execution controls do not allow execution.
- Read-only executor, when enabled, is constrained to GET, explicit allowlist, DNS/IP guard, manual redirects, timeout, content-type checks, byte limits, and response redaction.

## Verification run

From `/data/.openclaw/workspace-breaker/actionbridge-by-schwarzwald-agent`:

```bash
npm test
```

Result: **PASS**

Covered scripts:
- `test:contracts`
- `test:security`
- `test:dns-ip`
- `test:visibility-sanitizer`
- `test:demo-flow`

## Residual constraints before production

- This is **not** a blanket production GO for arbitrary live network execution.
- Keep pilot limited to verified origins, read-only/dry-run behavior, explicit operator/customer approval, and redacted audit review.
- Add rate limiting for public setup/session/handshake/verification endpoints before broader exposure.
- Re-run Sentinel review before enabling write/destructive/transactional actions or broad network execution.

## Final decision

**GO** for controlled local pilot onboarding smoke test.  
**NO-GO** remains for unrestricted production/live-write ActionBridge actions until the remaining production gates are reviewed and approved.
