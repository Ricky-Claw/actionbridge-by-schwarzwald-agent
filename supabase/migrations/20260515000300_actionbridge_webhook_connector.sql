-- ActionBridge Webhook-v1 connector support.

ALTER TABLE public.actionbridge_connectors
  DROP CONSTRAINT IF EXISTS actionbridge_connectors_type_check;

ALTER TABLE public.actionbridge_connectors
  ADD CONSTRAINT actionbridge_connectors_type_check
  CHECK (type IN ('http', 'website', 'webhook'));

-- Webhook-v1 is a connector delivery adapter, not a CRM/lead inbox product.
-- Delivery remains gated in application code by verification, approval, allowlist, DNS/IP guard, timeout, no redirects, audit, and kill switch.
