-- ActionBridge Webhook-v1 endpoint path support.
-- Target origin remains server-owned in base_url/allowed_origins; endpoint_path is a relative path only.

ALTER TABLE public.actionbridge_connectors
  ADD COLUMN IF NOT EXISTS endpoint_path TEXT NOT NULL DEFAULT '/';

ALTER TABLE public.actionbridge_connectors
  DROP CONSTRAINT IF EXISTS actionbridge_connectors_endpoint_path_relative;

ALTER TABLE public.actionbridge_connectors
  ADD CONSTRAINT actionbridge_connectors_endpoint_path_relative
  CHECK (
    endpoint_path LIKE '/%'
    AND endpoint_path NOT LIKE '//%'
    AND endpoint_path !~ '^[A-Za-z][A-Za-z0-9+.-]*:'
    AND endpoint_path !~ '\\\\'
    AND endpoint_path NOT LIKE '%?%'
    AND endpoint_path NOT LIKE '%#%'
  );
