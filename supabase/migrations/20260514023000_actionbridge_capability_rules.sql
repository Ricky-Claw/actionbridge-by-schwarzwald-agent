-- ActionBridge customer/operator capability rules v1.

CREATE TABLE IF NOT EXISTS public.actionbridge_capability_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connector_id UUID NOT NULL,
  name TEXT NOT NULL CHECK (name IN ('site.knowledge.read', 'lead.prepare_draft', 'appointment.request.prepare_draft')),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('read', 'write')),
  enabled BOOLEAN NOT NULL DEFAULT false,
  requires_approval BOOLEAN NOT NULL DEFAULT true,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  UNIQUE (user_id, connector_id, name),
  FOREIGN KEY (connector_id, user_id) REFERENCES public.actionbridge_connectors(id, user_id) ON DELETE CASCADE,
  CHECK (risk_level = 'read' OR requires_approval = true),
  CHECK (name = 'site.knowledge.read' OR risk_level = 'write'),
  CHECK (name <> 'site.knowledge.read' OR risk_level = 'read')
);

ALTER TABLE public.actionbridge_capability_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS actionbridge_capability_rules_owner_select ON public.actionbridge_capability_rules;
CREATE POLICY actionbridge_capability_rules_owner_select ON public.actionbridge_capability_rules
  FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_actionbridge_capability_rules_user_connector ON public.actionbridge_capability_rules(user_id, connector_id, enabled);
