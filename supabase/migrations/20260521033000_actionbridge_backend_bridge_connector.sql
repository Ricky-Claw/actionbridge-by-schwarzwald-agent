-- ActionBridge backend/admin bridge connector scaffold.
-- Enables customer-consented plugin/SDK/database-proxy connection paths without
-- exposing raw backend credentials to browser routes or agent tool catalogs.

ALTER TABLE public.actionbridge_connectors
  DROP CONSTRAINT IF EXISTS actionbridge_connectors_type_check;

ALTER TABLE public.actionbridge_connectors
  ADD CONSTRAINT actionbridge_connectors_type_check
  CHECK (type IN ('http', 'website', 'webhook', 'whatsapp_business', 'backend_bridge'));

-- Backend bridge connectors store only non-secret capability/scoping metadata in
-- actionbridge_connectors.capabilities, e.g.:
--   backend_bridge.v1
--   install_mode:admin_plugin | install_mode:server_sdk | install_mode:database_proxy
--   backend.read:orders
--   backend.write_draft:blog_post
--   workflow.trigger:new_lead
-- Raw DB credentials, API tokens, admin sessions, and plugin shared secrets must
-- live in a server-side secret manager referenced by secret_ref, never in UI/API
-- visibility routes, setup-session responses, or agent tool catalogs.
