-- Atomic replay guard for backend bridge plugin/SDK signed health proofs.
-- Raw nonces and shared secrets are never stored.

CREATE TABLE IF NOT EXISTS public.actionbridge_backend_bridge_health_nonces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connector_id UUID NOT NULL,
  nonce_digest TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (nonce_digest),
  FOREIGN KEY (connector_id, user_id) REFERENCES public.actionbridge_connectors(id, user_id) ON DELETE CASCADE
);

ALTER TABLE public.actionbridge_backend_bridge_health_nonces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS actionbridge_backend_bridge_health_nonces_no_direct_select ON public.actionbridge_backend_bridge_health_nonces;
CREATE POLICY actionbridge_backend_bridge_health_nonces_no_direct_select ON public.actionbridge_backend_bridge_health_nonces
  FOR SELECT USING (false);

CREATE INDEX IF NOT EXISTS idx_actionbridge_backend_bridge_health_nonces_expires
  ON public.actionbridge_backend_bridge_health_nonces(expires_at);

ALTER TABLE public.actionbridge_backend_bridge_health_nonces
  DROP CONSTRAINT IF EXISTS actionbridge_backend_bridge_health_nonces_digest_check;
ALTER TABLE public.actionbridge_backend_bridge_health_nonces
  ADD CONSTRAINT actionbridge_backend_bridge_health_nonces_digest_check
  CHECK (nonce_digest ~ '^sha256:[a-f0-9]{64}$');
