-- One-time pairing codes for backend/admin bridge plugins.
-- Stores code digests only. Raw pairing codes are shown once to authenticated
-- operators and exchanged once by the customer-installed server-side plugin.

CREATE TABLE IF NOT EXISTS public.actionbridge_backend_bridge_pairings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connector_id UUID NOT NULL,
  code_digest TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'consumed', 'expired', 'revoked')),
  secret_ref TEXT,
  shared_secret_digest TEXT,
  redacted_plugin_info JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  UNIQUE (code_digest),
  FOREIGN KEY (connector_id, user_id) REFERENCES public.actionbridge_connectors(id, user_id) ON DELETE CASCADE
);

ALTER TABLE public.actionbridge_backend_bridge_pairings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS actionbridge_backend_bridge_pairings_owner_select ON public.actionbridge_backend_bridge_pairings;
DROP POLICY IF EXISTS actionbridge_backend_bridge_pairings_no_direct_owner_select ON public.actionbridge_backend_bridge_pairings;
-- Pairings contain sensitive digest/ref metadata. Owners interact through sanitized
-- API route projections; direct client SELECT is intentionally denied.
CREATE POLICY actionbridge_backend_bridge_pairings_no_direct_owner_select ON public.actionbridge_backend_bridge_pairings
  FOR SELECT USING (false);

CREATE INDEX IF NOT EXISTS idx_actionbridge_backend_bridge_pairings_connector_status
  ON public.actionbridge_backend_bridge_pairings(user_id, connector_id, status, expires_at DESC);

ALTER TABLE public.actionbridge_backend_bridge_pairings
  DROP CONSTRAINT IF EXISTS actionbridge_backend_bridge_pairings_code_digest_check;
ALTER TABLE public.actionbridge_backend_bridge_pairings
  ADD CONSTRAINT actionbridge_backend_bridge_pairings_code_digest_check
  CHECK (code_digest ~ '^sha256:[a-f0-9]{64}$');

ALTER TABLE public.actionbridge_backend_bridge_pairings
  DROP CONSTRAINT IF EXISTS actionbridge_backend_bridge_pairings_secret_ref_check;
ALTER TABLE public.actionbridge_backend_bridge_pairings
  ADD CONSTRAINT actionbridge_backend_bridge_pairings_secret_ref_check
  CHECK (secret_ref IS NULL OR secret_ref ~ '^actionbridge:backend-bridge:[a-f0-9]{24}$');

ALTER TABLE public.actionbridge_backend_bridge_pairings
  DROP CONSTRAINT IF EXISTS actionbridge_backend_bridge_pairings_shared_secret_digest_check;
ALTER TABLE public.actionbridge_backend_bridge_pairings
  ADD CONSTRAINT actionbridge_backend_bridge_pairings_shared_secret_digest_check
  CHECK (shared_secret_digest IS NULL OR shared_secret_digest ~ '^sha256:[a-f0-9]{64}$');
