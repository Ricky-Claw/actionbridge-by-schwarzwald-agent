-- ActionBridge execution state + idempotency guards
-- Real connector/network execution remains disabled in application code.


ALTER TABLE public.actionbridge_connectors
  ADD COLUMN IF NOT EXISTS allowed_origins JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS network_execution_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS safety_status TEXT NOT NULL DEFAULT 'untested',
  ADD COLUMN IF NOT EXISTS permission_status TEXT NOT NULL DEFAULT 'draft';

ALTER TABLE public.actionbridge_connectors
  DROP CONSTRAINT IF EXISTS actionbridge_connectors_safety_status_check,
  ADD CONSTRAINT actionbridge_connectors_safety_status_check
  CHECK (safety_status IN ('untested', 'pass', 'fail'));

ALTER TABLE public.actionbridge_connectors
  DROP CONSTRAINT IF EXISTS actionbridge_connectors_permission_status_check,
  ADD CONSTRAINT actionbridge_connectors_permission_status_check
  CHECK (permission_status IN ('draft', 'active', 'paused', 'revoked'));

ALTER TABLE public.actionbridge_approvals
  DROP CONSTRAINT IF EXISTS actionbridge_approvals_status_check;

ALTER TABLE public.actionbridge_approvals
  ADD CONSTRAINT actionbridge_approvals_status_check
  CHECK (status IN ('pending', 'approved', 'executing', 'rejected', 'expired'));

CREATE TABLE IF NOT EXISTS public.actionbridge_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  approval_id UUID NOT NULL,
  action_id UUID,
  action_name TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('read', 'write', 'transactional', 'destructive')),
  idempotency_key TEXT NOT NULL,
  execution_status TEXT NOT NULL DEFAULT 'executing' CHECK (execution_status IN ('executing', 'succeeded', 'failed')),
  redacted_input JSONB NOT NULL DEFAULT '{}'::jsonb,
  safe_result JSONB,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  UNIQUE (user_id, approval_id, idempotency_key),
  FOREIGN KEY (approval_id, user_id) REFERENCES public.actionbridge_approvals(id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (action_id, user_id) REFERENCES public.actionbridge_actions(id, user_id) ON DELETE RESTRICT
);

ALTER TABLE public.actionbridge_executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS actionbridge_executions_owner_select ON public.actionbridge_executions;
CREATE POLICY actionbridge_executions_owner_select ON public.actionbridge_executions
  FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_actionbridge_executions_user_created ON public.actionbridge_executions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_actionbridge_executions_approval ON public.actionbridge_executions(user_id, approval_id);

CREATE OR REPLACE FUNCTION public.consume_actionbridge_approval_for_execution(
  p_user_id UUID,
  p_approval_id UUID,
  p_idempotency_key TEXT
)
RETURNS TABLE (
  execution_id UUID,
  approval_id UUID,
  action_id UUID,
  action_name TEXT,
  risk_level TEXT,
  execution_status TEXT,
  idempotency_key TEXT,
  safe_result JSONB,
  reused BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_approval public.actionbridge_approvals%ROWTYPE;
  v_execution public.actionbridge_executions%ROWTYPE;
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 8 OR length(p_idempotency_key) > 160 THEN
    RAISE EXCEPTION 'invalid idempotency key';
  END IF;

  SELECT * INTO v_execution
  FROM public.actionbridge_executions e
  WHERE e.user_id = p_user_id
    AND e.approval_id = p_approval_id
    AND e.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN QUERY SELECT
      v_execution.id,
      v_execution.approval_id,
      v_execution.action_id,
      v_execution.action_name,
      v_execution.risk_level,
      v_execution.execution_status,
      v_execution.idempotency_key,
      v_execution.safe_result,
      true;
    RETURN;
  END IF;

  UPDATE public.actionbridge_approvals a
    SET status = 'executing',
        decided_at = COALESCE(a.decided_at, now())
    WHERE a.id = p_approval_id
      AND a.user_id = p_user_id
      AND a.status = 'approved'
      AND a.status NOT IN ('rejected', 'expired')
    RETURNING * INTO v_approval;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval not executable';
  END IF;

  INSERT INTO public.actionbridge_executions (
    user_id,
    approval_id,
    action_id,
    action_name,
    risk_level,
    idempotency_key,
    execution_status,
    redacted_input,
    safe_result
  ) VALUES (
    v_approval.user_id,
    v_approval.id,
    v_approval.action_id,
    v_approval.action_name,
    v_approval.risk_level,
    p_idempotency_key,
    'executing',
    v_approval.redacted_input,
    jsonb_build_object('status', 'dry_run_noop', 'mode', 'policy_check_succeeded_without_execution', 'networkExecution', false)
  ) RETURNING * INTO v_execution;

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
    v_execution.user_id,
    v_execution.action_id,
    v_execution.approval_id,
    v_execution.action_name,
    v_execution.risk_level,
    'allow',
    'pending',
    v_execution.redacted_input,
    jsonb_build_object('approvalId', v_execution.approval_id, 'execution_id', v_execution.id, 'idempotencyKeyPrefix', left(p_idempotency_key, 8), 'networkExecution', false)
  );

  RETURN QUERY SELECT
    v_execution.id,
    v_execution.approval_id,
    v_execution.action_id,
    v_execution.action_name,
    v_execution.risk_level,
    v_execution.execution_status,
    v_execution.idempotency_key,
    v_execution.safe_result,
    false;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_actionbridge_approval_for_execution(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_actionbridge_approval_for_execution(UUID, UUID, TEXT) TO service_role;
