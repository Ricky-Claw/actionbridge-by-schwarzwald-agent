-- ActionBridge Website Connector type and guardrail metadata.
-- Execution remains disabled by default; this only allows website connector drafts to be modeled safely.

ALTER TABLE public.actionbridge_connectors
  DROP CONSTRAINT IF EXISTS actionbridge_connectors_type_check;

ALTER TABLE public.actionbridge_connectors
  ADD CONSTRAINT actionbridge_connectors_type_check CHECK (type IN ('http', 'website'));

COMMENT ON CONSTRAINT actionbridge_connectors_type_check ON public.actionbridge_connectors IS
  'ActionBridge connector type allowlist. Website connectors are public-read extract plans only until a guarded executor is approved.';
