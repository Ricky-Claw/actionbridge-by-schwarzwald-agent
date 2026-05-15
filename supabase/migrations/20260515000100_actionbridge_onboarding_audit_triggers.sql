-- ActionBridge onboarding control-plane audit triggers.
-- Keeps public setup-session route from selecting user_id while still auditing state changes.

CREATE OR REPLACE FUNCTION public.audit_actionbridge_setup_link_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.actionbridge_audit_logs (
      user_id,
      action_name,
      risk_level,
      decision,
      status,
      redacted_input,
      result_summary
    ) VALUES (
      NEW.user_id,
      'setup_link.' || NEW.status,
      'read',
      CASE WHEN NEW.status IN ('revoked', 'expired') THEN 'deny' ELSE 'allow' END,
      CASE WHEN NEW.status IN ('revoked', 'expired') THEN 'denied' ELSE 'succeeded' END,
      jsonb_build_object(
        'setupLinkId', NEW.id,
        'targetOrigin', NEW.target_origin,
        'previousStatus', OLD.status,
        'status', NEW.status
      ),
      jsonb_build_object(
        'controlPlane', true,
        'networkExecution', false,
        'eventName', 'setup_link.' || NEW.status
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_actionbridge_setup_link_status_audit ON public.actionbridge_setup_links;
CREATE TRIGGER trg_actionbridge_setup_link_status_audit
  AFTER UPDATE OF status ON public.actionbridge_setup_links
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_actionbridge_setup_link_status_change();
