-- Durable ActionBridge connector quarantine state for repeated webhook delivery failures.
-- Pilot throttle remains process-local; this table is the durable pause primitive required
-- before production/broad rollout.

CREATE TABLE IF NOT EXISTS public.actionbridge_connector_quarantine (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connector_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  reason_code TEXT NOT NULL CHECK (reason_code IN ('webhook_repeated_failures', 'operator_pause', 'system_pause')),
  message TEXT NOT NULL,
  redacted_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (id, user_id),
  FOREIGN KEY (connector_id, user_id) REFERENCES public.actionbridge_connectors(id, user_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_actionbridge_connector_quarantine_one_active
  ON public.actionbridge_connector_quarantine(user_id, connector_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_actionbridge_connector_quarantine_user_status
  ON public.actionbridge_connector_quarantine(user_id, status, updated_at DESC);

ALTER TABLE public.actionbridge_connector_quarantine ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS actionbridge_connector_quarantine_owner_select ON public.actionbridge_connector_quarantine;
CREATE POLICY actionbridge_connector_quarantine_owner_select ON public.actionbridge_connector_quarantine
  FOR SELECT USING (auth.uid() = user_id);
