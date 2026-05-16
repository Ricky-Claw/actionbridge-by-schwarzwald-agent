-- ActionBridge WhatsApp Business Cloud API connector scaffold.
-- This adds connector type support only. Live message send remains blocked until
-- server-owned token secret_ref, Meta webhook verification, policy, approval, and Sentinel review are complete.

ALTER TABLE public.actionbridge_connectors
  DROP CONSTRAINT IF EXISTS actionbridge_connectors_type_check;

ALTER TABLE public.actionbridge_connectors
  ADD CONSTRAINT actionbridge_connectors_type_check
  CHECK (type IN ('http', 'website', 'webhook', 'whatsapp_business'));

-- WhatsApp Business connectors store only non-secret Meta IDs in capabilities:
-- whatsapp.phone_number_id:<id>, whatsapp.business_account_id:<id>, whatsapp.graph_api_version:<version>.
-- Access tokens must be server-owned secret refs and are not accepted by public connector routes.
