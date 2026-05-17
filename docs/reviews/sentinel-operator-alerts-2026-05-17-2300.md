# Sentinel Review — ActionBridge Operator Alerts Fail-Closed Patch

**Date:** 2026-05-17 23:00 Europe/Berlin  
**Reviewer:** Sentinel 🛡️  
**Scope:** Current uncommitted patch only:
- `src/frontend/lib/actionbridge/error-log.ts`
- `src/frontend/app/api/actionbridge/alerts/route.ts`
- `supabase/migrations/20260517050000_actionbridge_operator_alerts.sql`
- `scripts/test-actionbridge-behavioral-modules.mjs`
- `docs/production-readiness-checklist.md`
- `docs/autopilot/2026-05-17-0500.md`

## Decision

**GO for this fail-closed patch.**

The previously identified High/Critical observability gaps are closed for this patch scope:
- High/Critical base error-log insert failure now throws `ACTIONBRIDGE_ERROR_LOG_INSERT_FAILED`.
- High/Critical operator alert insert failure now throws `ACTIONBRIDGE_OPERATOR_ALERT_INSERT_FAILED`.
- Alerts are owner-scoped by schema, RLS, route authentication, and route query predicate.
- Alert payloads reuse the bounded/redacted error context path.
- The production checklist correctly remains unchecked because durable pull/inbox alerts are not yet active operator escalation/notification.

**Production Gate 4 remains NO-GO until active escalation/notification exists.** This patch is a safe prerequisite, not the complete operator alerting control.

## Evidence reviewed

### Fail-closed behavior

`persistActionBridgeErrorEvent` now derives `operatorAlert.required` from severity and fails closed for High/Critical if the base log cannot be persisted:

```ts
if (error || !id) {
  const operatorAlert = { required: requiresActionBridgeOperatorAlert(input.severity), id: null, error: 'ACTIONBRIDGE_ERROR_LOG_INSERT_FAILED' };
  if (operatorAlert.required) throw new Error('ACTIONBRIDGE_ERROR_LOG_INSERT_FAILED');
  return { id: null, error: error?.message || null, operatorAlert };
}
```

It also fails closed when required alert persistence reports an error:

```ts
if (operatorAlert.required && operatorAlert.error) {
  throw new Error('ACTIONBRIDGE_OPERATOR_ALERT_INSERT_FAILED');
}
```

Behavioral verification confirms both cases:

- `operator alert behavior: high error-log insert failure fails closed`
- `operator alert behavior: high alert insert failure fails closed`
- `operator alert behavior: critical creates durable redacted alert`

### Redaction and bounded payloads

Positive controls:
- `sanitizeActionBridgeErrorMessage()` applies `sanitizeActionBridgeErrorContext()` and `redactActionBridgeValue()` before truncating to 500 chars.
- Error log and operator alert inserts use sanitized message and redacted bounded context.
- View mappers sanitize again before returning API payloads.

Residual note: free-text secret redaction is still pattern-limited to the current redaction module. This patch does not introduce a new secret leak versus the existing redaction model and improves the prior raw-message path, but Sentinel still requires expanded token/credential pattern coverage before production hardening is considered complete.

### Owner scoping / RLS

Positive controls:
- Migration creates `actionbridge_operator_alerts` with `user_id NOT NULL`.
- Composite FK enforces alert ownership alignment with `actionbridge_error_logs(id, user_id)`.
- Optional `connector_id` composite FK enforces same-owner connector linkage.
- RLS is enabled.
- Owner SELECT policy restricts reads to `auth.uid() = user_id`.
- `/api/actionbridge/alerts` requires authenticated Supabase user.
- Route query includes `.eq('user_id', user!.id)` and maps only redacted alert fields.

No auth bypass found in this route.

### No silent High/Critical alert loss

For the scoped code path, High/Critical errors cannot silently continue when either required persistence step fails. Medium/low/info remain non-blocking, which is acceptable for this control.

### Documentation/checklist

`docs/production-readiness-checklist.md` keeps operator notification unchecked and clarifies that only durable owner-scoped inbox exists. This is correct and prevents overstating readiness.

`docs/autopilot/2026-05-17-0500.md` accurately records that a final Sentinel GO was pending and that active escalation remains a blocker.

## Verification run

Command:

```bash
npm run test:behavioral-modules
```

Result: **PASS**. The added operator alert behavioral checks passed.

## Findings

### No Critical/High findings in this patch scope

The targeted High/Critical fail-closed defect is fixed.

### Medium — Free-text secret redaction remains incomplete

**Severity:** Medium  
**Status:** Existing hardening gap / required production control  
**Evidence:** `redactActionBridgeValue()` redacts sensitive object keys plus email, IBAN, and phone patterns in strings. It does not yet broadly redact common free-text credentials such as bearer tokens, JWTs, `sk_*`/`sk-` API keys, access tokens embedded in URLs, or `Authorization:` header values inside plain strings.

**Risk:** If an upstream error message contains a raw credential in free text, the message can be persisted into `actionbridge_error_logs` and `actionbridge_operator_alerts` after only partial pattern redaction.

**Required control before production:** Extend redaction tests and implementation for common secret/token patterns in free-text strings, then verify both error logs and operator alerts store and return only redacted values.

## Required Sentinel controls for next gate

1. **Active escalation:** Add an operator notification/escalation channel for High/Critical alerts beyond the durable pull inbox.
2. **Redaction hardening:** Add free-text credential/token redaction coverage with tests.
3. **RLS/route regression tests:** Add non-token/static tests or integration tests proving cross-user alert reads are blocked by both route predicate and RLS.
4. **Operational audit:** Ensure alert creation/failure and operator acknowledgement/resolution are included in audit trails before production actions.
5. **Failure runbook:** Document expected behavior when `ACTIONBRIDGE_ERROR_LOG_INSERT_FAILED` or `ACTIONBRIDGE_OPERATOR_ALERT_INSERT_FAILED` blocks execution.

## Final gate

- **Patch merge/commit:** GO.
- **Production readiness Gate 4:** NO-GO until active escalation and redaction hardening are complete.
