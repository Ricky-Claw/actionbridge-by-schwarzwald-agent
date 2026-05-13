-- ActionBridge bridge script/plugin installation handshake state.

CREATE TABLE IF NOT EXISTS public.actionbridge_bridge_installations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  setup_link_id UUID,
  connector_id UUID,
  target_origin TEXT NOT NULL,
  bridge_version TEXT NOT NULL DEFAULT 'bridge.v1',
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'stale', 'revoked')),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  UNIQUE (setup_link_id, target_origin),
  FOREIGN KEY (setup_link_id, user_id) REFERENCES public.actionbridge_setup_links(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (connector_id, user_id) REFERENCES public.actionbridge_connectors(id, user_id) ON DELETE CASCADE
);

ALTER TABLE public.actionbridge_bridge_installations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS actionbridge_bridge_installations_owner_select ON public.actionbridge_bridge_installations;
CREATE POLICY actionbridge_bridge_installations_owner_select ON public.actionbridge_bridge_installations
  FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_actionbridge_bridge_installations_user_status ON public.actionbridge_bridge_installations(user_id, status, last_seen_at DESC);
