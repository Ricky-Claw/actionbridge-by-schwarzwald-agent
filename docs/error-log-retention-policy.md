# ActionBridge Error Log Retention / GDPR Policy

## Purpose
ActionBridge error logs exist for debugging, auditability, and safe rollout decisions. They must help operators fix bugs without becoming a long-term store of customer personal data or secrets.

## Data Minimization
Error logs may store:
- category, severity, error code, status;
- connector/execution/approval identifiers;
- redacted bounded context;
- timestamps and lifecycle status.

Error logs must not store:
- raw setup tokens;
- raw idempotency keys;
- connector secrets or signing secrets;
- raw Authorization/API keys;
- full webhook payloads when not needed for debugging;
- unredacted personal data.

## Current Controls
- `persistActionBridgeErrorEvent(...)` redacts context before insert.
- Context serializer caps depth, keys, array items, string length, and circular structures.
- `/api/actionbridge/errors` is authenticated and owner-scoped.
- Status updates are forward-only and compare-and-set guarded.
- High/Critical events must block rollout decisions until reviewed.

## Retention Targets
Recommended retention before production:
- `resolved` low/info: delete or archive after 30 days.
- `resolved` medium: delete or archive after 90 days.
- `resolved` high/critical: retain 180 days unless legal/customer policy requires shorter.
- `open` or `acknowledged`: retain until resolution, then follow severity retention.

## Deletion / Export
ActionBridge now has two retention execution paths:
- operator UI/API: `/api/actionbridge/errors` supports dry-run by default and requires `DELETE_EXPIRED_ACTIONBRIDGE_ERROR_LOGS` for deletion;
- scheduled/background API: `/api/actionbridge/ops/error-retention` is bearer-secret protected with `ACTIONBRIDGE_RETENTION_CRON_SECRET`, scopes work to `ACTIONBRIDGE_RETENTION_USER_IDS`, and remains dry-run unless `ACTIONBRIDGE_RETENTION_DELETE_ENABLED=true` plus `x-actionbridge-retention-confirm: DELETE_EXPIRED_ACTIONBRIDGE_ERROR_LOGS` are both present.

Both paths:
- delete only expired `resolved` logs by severity;
- record deletion summaries without raw context;
- respect user/account deletion through cascade behavior;
- can support redacted incident packet export for Sentinel review.

## Pilot Rule
For controlled pilot, error logs are allowed as operational security data if contexts remain redacted and bounded. Do not attach raw payloads or screenshots containing secrets to error context.
