-- ActionBridge domain/origin verification: human attestation, .well-known/meta, and DNS TXT.

CREATE TABLE IF NOT EXISTS public.actionbridge_connector_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connector_id UUID NOT NULL,
  origin TEXT NOT NULL,
  hostname TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('human_attestation', 'well_known', 'meta_tag', 'dns_txt')),
  token_digest TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed', 'revoked')),
  challenge_path TEXT,
  dns_record_name TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  verified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  UNIQUE (connector_id, method, origin),
  FOREIGN KEY (connector_id, user_id) REFERENCES public.actionbridge_connectors(id, user_id) ON DELETE CASCADE
);

ALTER TABLE public.actionbridge_connector_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS actionbridge_connector_verifications_owner_select ON public.actionbridge_connector_verifications;
CREATE POLICY actionbridge_connector_verifications_owner_select ON public.actionbridge_connector_verifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_actionbridge_connector_verifications_user_connector ON public.actionbridge_connector_verifications(user_id, connector_id);
CREATE INDEX IF NOT EXISTS idx_actionbridge_connector_verifications_status ON public.actionbridge_connector_verifications(user_id, status, expires_at);
