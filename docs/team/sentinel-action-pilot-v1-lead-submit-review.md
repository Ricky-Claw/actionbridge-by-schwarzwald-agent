# Sentinel Review — Action Pilot v1 `lead.submit`

Date: 2026-05-15
Reviewer: Sentinel 🛡️
Scope: local working tree only; no external network. Approval-gated `lead.submit` into ActionBridge lead outbox.

## Verdict

**GO for controlled pilot / staging.**

No Critical or High release blockers found for the requested pilot slice. The implementation keeps `lead.submit` approval-gated, idempotent at the approval/outbox boundary, non-networked, and scoped by RLS/FKs.

**Do not market this as arbitrary external lead delivery.** It is an ActionBridge-side outbox queue only.

## Evidence checked

### Approval required

- `src/frontend/lib/actionbridge/capability-rules.ts` defines `lead.submit` as `riskLevel: 'write'` and `requiresApproval: true`.
- `src/frontend/lib/actionbridge/policy.ts` approval-gates write actions by default unless explicitly allowed and approval-disabled by server policy.
- `src/frontend/app/api/actionbridge/execute/route.ts` only runs the lead outbox persistence on the approved-approval execution path: `approvalId` + `consumeApprovedActionBridgeExecution(...)` + `consumed.execution.actionName === 'lead.submit'`.
- Approval creation persists immutable redacted `action_snapshot` in `src/frontend/lib/actionbridge/persistence.ts`.

### Idempotency / one approval, one lead

- Execution requires `idempotencyKey` length 8–160 in `execute/route.ts`.
- `supabase/migrations/20260505234500_actionbridge_execution_state.sql` enforces `UNIQUE (user_id, approval_id, idempotency_key)` and moves approval from `approved` to `executing` atomically.
- `supabase/migrations/20260515000200_actionbridge_lead_submissions.sql` enforces `UNIQUE (approval_id)`, preventing duplicate lead outbox rows per approval.

### No arbitrary external form submit

- `src/frontend/lib/actionbridge/lead-submission.ts` writes only to `actionbridge_lead_submissions` with `delivery_mode: 'actionbridge_outbox'`.
- No `fetch(`, `form.submit`, browser/RPA, CRM write, or third-party form post exists in the lead submission helper.
- API response explicitly returns `networkExecution: false` for the approved lead path.

### PII redaction

- `src/frontend/lib/actionbridge/redaction.ts` now covers secrets plus common GDPR/PII fields and patterns: email, phone/mobile/telephone/contact, address/street, IBAN/BIC, tax/VAT IDs.
- Approval snapshots, audit logs, and lead outbox payload use `redactActionBridgeValue(...)` before storage/output.
- `lead.submit` stores `redacted_lead`, not raw lead input.

### Audit / execution result

- Approval queueing creates audit events.
- Consuming an approval creates an execution row and audit entry in `consume_actionbridge_approval_for_execution(...)`.
- Final execution result is persisted through `persistActionBridgeExecutionResult(...)`, which writes a final audit event.

### Migration RLS / FKs

- `actionbridge_lead_submissions` has RLS enabled.
- Owner can SELECT only via `actionbridge_lead_submissions_owner_select`.
- Inserts/updates are service-role/server-side only by absence of client INSERT/UPDATE policies.
- Same-owner composite FKs exist for connector, action, and approval:
  - `(connector_id, user_id)` → `actionbridge_connectors(id, user_id)`
  - `(action_id, user_id)` → `actionbridge_actions(id, user_id)`
  - `(approval_id, user_id)` → `actionbridge_approvals(id, user_id)`

## Findings

### Medium — Raw `sourceOrigin` / `sourcePath` can store URL PII

`lead-submission.ts` stores `sourceOrigin` and `sourcePath` after slicing only. If caller-provided source path/origin contains query params with email, phone, tokens, campaign IDs, or personal data, those fields bypass `redactActionBridgeValue` and land raw in `actionbridge_lead_submissions`.

**Recommendation:** validate as URL/path and strip query/hash, or apply redaction before storing. Prefer storing only normalized origin + pathname with no query string.

### Medium — Lead outbox failure leaves consumed approval/execution in limbo

If `persistActionBridgeLeadSubmission(...)` fails after `consumeApprovedActionBridgeExecution(...)` has moved approval to `executing`, the route returns `ACTIONBRIDGE_LEAD_SUBMISSION_FAILED` but does not mark the execution as `failed`. Retry with the same idempotency key can return reused execution state; retry with a new key is blocked because the approval is no longer `approved`.

Security impact is contained: no external action occurs and `UNIQUE (approval_id)` prevents duplicate leads. Operationally, this can strand an approved lead and weaken failure audit clarity.

**Recommendation:** on lead submission failure, call `persistActionBridgeExecutionResult(... status: 'failed', errorCode: 'ACTIONBRIDGE_LEAD_SUBMISSION_FAILED')` before returning 503.

### Low — `connector_id` not propagated into lead submission insert

`execute/route.ts` passes `actionId`, `approvalId`, and `executionId` to `persistActionBridgeLeadSubmission(...)`, but not `connectorId`. The table supports `connector_id`; leaving it null weakens tenant/operator traceability by connector.

**Recommendation:** include connector id from immutable approval snapshot or execution state in the lead submission row.

## Verification run

Command:

```bash
npm test
```

Result: **PASS**

Covered suites:

- `test:contracts`
- `test:security`
- `test:dns-ip`
- `test:visibility-sanitizer`
- `test:demo-flow`

Relevant passing markers included:

- `ActionBridge lead submission creates approval-gated outbox records without external form submit`
- `approved lead.submit persists lead outbox action`
- `lead submission avoids arbitrary external form post`
- `ActionBridge migration defines consume-once approval execution state, immutable snapshots, and digest-only idempotency audit`
- `GDPR redaction marker: email/phone/contact/address/iban/vatId`

## Gate decision

**GO**, with the Medium fixes recommended before production/customer-data scale-up.

No Critical/High unresolved risk found. Network/browser/form execution remains outside this pilot path.
