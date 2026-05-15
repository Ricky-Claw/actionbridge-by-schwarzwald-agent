-- ActionBridge error logs for operator-visible debugging without exposing secrets.

CREATE TABLE IF NOT EXISTS public.actionbridge_error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connector_id UUID,
  execution_id UUID,
  approval_id UUID,
  category TEXT NOT NULL CHECK (category IN ('setup', 'verification', 'approval', 'execution', 'webhook', 'rate_limit', 'system')),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
  error_code TEXT NOT NULL,
  message TEXT NOT NULL,
  redacted_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (id, user_id),
  FOREIGN KEY (connector_id, user_id) REFERENCES public.actionbridge_connectors(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (execution_id, user_id) REFERENCES public.actionbridge_executions(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (approval_id, user_id) REFERENCES public.actionbridge_approvals(id, user_id) ON DELETE CASCADE
);

ALTER TABLE public.actionbridge_error_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS actionbridge_error_logs_owner_select ON public.actionbridge_error_logs;
CREATE POLICY actionbridge_error_logs_owner_select ON public.actionbridge_error_logs
  FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_actionbridge_error_logs_user_created ON public.actionbridge_error_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_actionbridge_error_logs_user_status_severity ON public.actionbridge_error_logs(user_id, status, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_actionbridge_error_logs_connector ON public.actionbridge_error_logs(user_id, connector_id, created_at DESC);
