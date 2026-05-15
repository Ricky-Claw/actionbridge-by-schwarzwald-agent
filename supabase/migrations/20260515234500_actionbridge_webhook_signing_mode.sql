-- ActionBridge Webhook-v1 explicit signing mode.
-- Client-facing routes still reject raw secrets/secret refs. This field makes unsigned pilot mode explicit.

ALTER TABLE public.actionbridge_connectors
  ADD COLUMN IF NOT EXISTS webhook_signing_mode TEXT NOT NULL DEFAULT 'unsigned_pilot';

ALTER TABLE public.actionbridge_connectors
  DROP CONSTRAINT IF EXISTS actionbridge_connectors_webhook_signing_mode_check;

ALTER TABLE public.actionbridge_connectors
  ADD CONSTRAINT actionbridge_connectors_webhook_signing_mode_check
  CHECK (webhook_signing_mode IN ('unsigned_pilot', 'hmac_sha256'));

ALTER TABLE public.actionbridge_connectors
  DROP CONSTRAINT IF EXISTS actionbridge_connectors_webhook_signing_ref_required;

ALTER TABLE public.actionbridge_connectors
  ADD CONSTRAINT actionbridge_connectors_webhook_signing_ref_required
  CHECK (webhook_signing_mode <> 'hmac_sha256' OR secret_ref IS NOT NULL);
