-- Atomic operator alert lifecycle transition.
-- Keeps High/Critical alert status and backing error-log status consistent.

CREATE OR REPLACE FUNCTION public.update_actionbridge_operator_alert_status(
  p_user_id UUID,
  p_alert_id UUID,
  p_current_status TEXT,
  p_next_status TEXT,
  p_changed_at TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  id UUID,
  error_log_id UUID,
  connector_id UUID,
  category TEXT,
  severity TEXT,
  error_code TEXT,
  message TEXT,
  redacted_context JSONB,
  status TEXT,
  created_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alert public.actionbridge_operator_alerts%ROWTYPE;
  v_error_updated UUID;
BEGIN
  IF p_next_status NOT IN ('acknowledged', 'resolved') OR p_current_status NOT IN ('open', 'acknowledged', 'resolved') THEN
    RAISE EXCEPTION 'INVALID_ACTIONBRIDGE_OPERATOR_ALERT_STATUS_UPDATE';
  END IF;

  UPDATE public.actionbridge_operator_alerts AS alerts
  SET
    status = p_next_status,
    acknowledged_at = CASE
      WHEN p_next_status = 'acknowledged' THEN p_changed_at
      WHEN alerts.acknowledged_at IS NULL THEN p_changed_at
      ELSE alerts.acknowledged_at
    END,
    resolved_at = CASE WHEN p_next_status = 'resolved' THEN p_changed_at ELSE NULL END
  WHERE alerts.user_id = p_user_id
    AND alerts.id = p_alert_id
    AND alerts.status = p_current_status
  RETURNING alerts.* INTO v_alert;

  IF v_alert.id IS NULL THEN
    RAISE EXCEPTION 'ACTIONBRIDGE_OPERATOR_ALERT_STATUS_UPDATE_FAILED';
  END IF;

  UPDATE public.actionbridge_error_logs AS logs
  SET
    status = p_next_status,
    resolved_at = CASE WHEN p_next_status = 'resolved' THEN p_changed_at ELSE NULL END
  WHERE logs.user_id = p_user_id
    AND logs.id = v_alert.error_log_id
    AND (
      (p_next_status = 'acknowledged' AND logs.status = 'open')
      OR (p_next_status = 'resolved' AND logs.status IN ('open', 'acknowledged'))
      OR logs.status = p_next_status
    )
  RETURNING logs.id INTO v_error_updated;

  IF v_error_updated IS NULL THEN
    RAISE EXCEPTION 'ACTIONBRIDGE_OPERATOR_ALERT_ERROR_LOG_SYNC_FAILED';
  END IF;

  RETURN QUERY SELECT
    v_alert.id,
    v_alert.error_log_id,
    v_alert.connector_id,
    v_alert.category,
    v_alert.severity,
    v_alert.error_code,
    v_alert.message,
    v_alert.redacted_context,
    v_alert.status,
    v_alert.created_at,
    v_alert.acknowledged_at,
    v_alert.resolved_at;
END;
$$;

ALTER FUNCTION public.update_actionbridge_operator_alert_status(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_actionbridge_operator_alert_status(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_actionbridge_operator_alert_status(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.update_actionbridge_operator_alert_status(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_actionbridge_operator_alert_status(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
