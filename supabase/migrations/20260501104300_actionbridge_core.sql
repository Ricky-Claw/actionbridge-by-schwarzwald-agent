-- F26 ActionBridge core tables
-- Universal Agent Connector foundation: actions, connectors, approvals, redacted audit logs.

CREATE TABLE IF NOT EXISTS public.actionbridge_connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'http' CHECK (type IN ('http')),
  base_url TEXT NOT NULL,
  auth_mode TEXT NOT NULL DEFAULT 'none' CHECK (auth_mode IN ('none', 'bearer', 'api_key', 'basic')),
  secret_ref TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);

CREATE TABLE IF NOT EXISTS public.actionbridge_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connector_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  risk_level TEXT NOT NULL CHECK (risk_level IN ('read', 'write', 'transactional', 'destructive')),
  input_schema JSONB NOT NULL DEFAULT '[]'::jsonb,
  output_description TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT true,
  requires_approval BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT actionbridge_actions_non_read_requires_approval CHECK (risk_level = 'read' OR requires_approval = true),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  UNIQUE (user_id, name),
  FOREIGN KEY (connector_id, user_id) REFERENCES public.actionbridge_connectors(id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.actionbridge_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_id UUID,
  action_name TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('read', 'write', 'transactional', 'destructive')),
  redacted_input JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  decision_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  UNIQUE (id, user_id),
  FOREIGN KEY (action_id, user_id) REFERENCES public.actionbridge_actions(id, user_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.actionbridge_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_id UUID,
  approval_id UUID,
  action_name TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('read', 'write', 'transactional', 'destructive')),
  decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny', 'approval_required')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'denied')),
  redacted_input JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_summary JSONB,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (action_id, user_id) REFERENCES public.actionbridge_actions(id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (approval_id, user_id) REFERENCES public.actionbridge_approvals(id, user_id) ON DELETE RESTRICT
);

ALTER TABLE public.actionbridge_connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.actionbridge_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.actionbridge_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.actionbridge_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS actionbridge_connectors_owner_all ON public.actionbridge_connectors;
DROP POLICY IF EXISTS actionbridge_connectors_owner_select ON public.actionbridge_connectors;
CREATE POLICY actionbridge_connectors_owner_select ON public.actionbridge_connectors
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS actionbridge_actions_owner_all ON public.actionbridge_actions;
DROP POLICY IF EXISTS actionbridge_actions_owner_select ON public.actionbridge_actions;
CREATE POLICY actionbridge_actions_owner_select ON public.actionbridge_actions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS actionbridge_approvals_owner_all ON public.actionbridge_approvals;
DROP POLICY IF EXISTS actionbridge_approvals_owner_select ON public.actionbridge_approvals;
CREATE POLICY actionbridge_approvals_owner_select ON public.actionbridge_approvals
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS actionbridge_audit_logs_owner_read ON public.actionbridge_audit_logs;
CREATE POLICY actionbridge_audit_logs_owner_read ON public.actionbridge_audit_logs
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS actionbridge_audit_logs_owner_insert ON public.actionbridge_audit_logs;
CREATE POLICY actionbridge_audit_logs_owner_insert ON public.actionbridge_audit_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_actionbridge_connectors_user_id ON public.actionbridge_connectors(user_id);
CREATE INDEX IF NOT EXISTS idx_actionbridge_actions_user_id ON public.actionbridge_actions(user_id);
CREATE INDEX IF NOT EXISTS idx_actionbridge_approvals_user_status ON public.actionbridge_approvals(user_id, status);
CREATE INDEX IF NOT EXISTS idx_actionbridge_audit_logs_user_created ON public.actionbridge_audit_logs(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.decide_actionbridge_approval_atomic(
  p_user_id UUID,
  p_approval_id UUID,
  p_status TEXT
)
RETURNS TABLE (
  id UUID,
  action_id UUID,
  action_name TEXT,
  risk_level TEXT,
  status TEXT,
  decided_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_approval public.actionbridge_approvals%ROWTYPE;
  v_decided_at TIMESTAMPTZ := now();
BEGIN
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid approval status';
  END IF;

  UPDATE public.actionbridge_approvals a
    SET status = p_status,
        decided_at = v_decided_at
    WHERE a.id = p_approval_id
      AND a.user_id = p_user_id
      AND a.status = 'pending'
    RETURNING * INTO v_approval;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval decision failed';
  END IF;

  INSERT INTO public.actionbridge_audit_logs (
    user_id,
    action_id,
    approval_id,
    action_name,
    risk_level,
    decision,
    status,
    redacted_input,
    result_summary
  ) VALUES (
    v_approval.user_id,
    v_approval.action_id,
    v_approval.id,
    v_approval.action_name,
    v_approval.risk_level,
    CASE WHEN p_status = 'approved' THEN 'allow' ELSE 'deny' END,
    'succeeded',
    '{}'::jsonb,
    jsonb_build_object('approvalStatus', p_status, 'decidedAt', v_decided_at)
  );

  RETURN QUERY SELECT
    v_approval.id,
    v_approval.action_id,
    v_approval.action_name,
    v_approval.risk_level,
    p_status,
    v_decided_at;
END;
$$;

REVOKE ALL ON FUNCTION public.decide_actionbridge_approval_atomic(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_actionbridge_approval_atomic(UUID, UUID, TEXT) TO service_role;
