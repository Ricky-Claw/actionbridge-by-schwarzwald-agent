-- ActionBridge operator alerts for High/Critical errors.
-- Alerts are durable, owner-scoped, redacted, and separate from raw error context.

CREATE TABLE IF NOT EXISTS public.actionbridge_operator_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  error_log_id UUID NOT NULL,
  connector_id UUID,
  severity TEXT NOT NULL CHECK (severity IN ('high', 'critical')),
  category TEXT NOT NULL CHECK (category IN ('setup', 'verification', 'approval', 'execution', 'webhook', 'rate_limit', 'system')),
  error_code TEXT NOT NULL,
  message TEXT NOT NULL,
  redacted_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  UNIQUE (id, user_id),
  UNIQUE (user_id, error_log_id),
  FOREIGN KEY (error_log_id, user_id) REFERENCES public.actionbridge_error_logs(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (connector_id, user_id) REFERENCES public.actionbridge_connectors(id, user_id) ON DELETE CASCADE
);

ALTER TABLE public.actionbridge_operator_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS actionbridge_operator_alerts_owner_select ON public.actionbridge_operator_alerts;
CREATE POLICY actionbridge_operator_alerts_owner_select ON public.actionbridge_operator_alerts
  FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_actionbridge_operator_alerts_user_status_severity ON public.actionbridge_operator_alerts(user_id, status, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_actionbridge_operator_alerts_error ON public.actionbridge_operator_alerts(user_id, error_log_id);
