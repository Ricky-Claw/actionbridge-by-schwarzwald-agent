-- ActionBridge customer setup links for Schwarzwald-Agent dashboard handoff.

CREATE TABLE IF NOT EXISTS public.actionbridge_setup_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connector_id UUID,
  target_origin TEXT NOT NULL,
  token_digest TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'opened', 'completed', 'revoked', 'expired')),
  allowed_methods JSONB NOT NULL DEFAULT '["meta_tag", "dns_txt", "well_known"]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  UNIQUE (id, user_id),
  UNIQUE (token_digest),
  FOREIGN KEY (connector_id, user_id) REFERENCES public.actionbridge_connectors(id, user_id) ON DELETE CASCADE
);

ALTER TABLE public.actionbridge_setup_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS actionbridge_setup_links_owner_select ON public.actionbridge_setup_links;
CREATE POLICY actionbridge_setup_links_owner_select ON public.actionbridge_setup_links
  FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_actionbridge_setup_links_user_status ON public.actionbridge_setup_links(user_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_actionbridge_setup_links_connector ON public.actionbridge_setup_links(user_id, connector_id);
