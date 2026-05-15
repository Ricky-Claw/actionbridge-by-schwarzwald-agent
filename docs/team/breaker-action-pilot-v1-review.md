# Breaker Review — Action Pilot v1 Lead Submit

## Scope checked
Local ActionBridge repo only. No external/customer systems tested.

## Goal
Allow the first real pilot action after human approval: convert chat-collected lead data into a real ActionBridge lead outbox record.

## Implemented path
1. Visitor/chat provides lead fields: `name`, `contact`, `message`, optional `company`.
2. Agent/tool requests `lead.submit`.
3. Existing policy marks it write-risk and approval-required.
4. Operator/customer approves via approval flow.
5. Execute consumes approval once with idempotency.
6. If approved action is `lead.submit`, ActionBridge persists a real row in `actionbridge_lead_submissions`.
7. Result is stored as execution safe result and audit trail remains non-networked.

## Safety boundaries
- No arbitrary third-party form POST.
- No browser/RPA/form-submit.
- No credentials used.
- No external network action.
- Lead delivery mode is `actionbridge_outbox` only.
- PII/contact values are redacted by existing redaction layer before persistence into approval/execution surfaces.
- Approval consume remains idempotent; one approval creates at most one lead submission (`UNIQUE (approval_id)`).

## Files changed
- `src/frontend/lib/actionbridge/lead-submission.ts`
- `src/frontend/lib/actionbridge/capability-rules.ts`
- `src/frontend/app/api/actionbridge/execute/route.ts`
- `supabase/migrations/20260515000200_actionbridge_lead_submissions.sql`
- `scripts/test-actionbridge-contracts.mjs`
- `scripts/test-actionbridge-security-gauntlet.mjs`

## Verification
- `npm test` ✅
- `git diff --check` ✅

## Breaker verdict
GO for controlled pilot Action v1: approved lead submission into ActionBridge outbox.

Not yet GO:
- Posting to arbitrary customer website forms.
- CRM/API delivery without connector-specific schema, allowlist, auth storage, rate limits, retry policy, and Sentinel re-review.
