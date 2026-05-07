-- F26 ActionBridge follow-up hardening for already-applied environments.
-- Keep normal clients from mutating action risk/approval policy directly.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'actionbridge_actions_non_read_requires_approval'
      AND conrelid = 'public.actionbridge_actions'::regclass
  ) THEN
    ALTER TABLE public.actionbridge_actions
      ADD CONSTRAINT actionbridge_actions_non_read_requires_approval
      CHECK (risk_level = 'read' OR requires_approval = true);
  END IF;
END $$;

DROP POLICY IF EXISTS actionbridge_actions_owner_all ON public.actionbridge_actions;
DROP POLICY IF EXISTS actionbridge_actions_owner_select ON public.actionbridge_actions;
CREATE POLICY actionbridge_actions_owner_select ON public.actionbridge_actions
  FOR SELECT USING (auth.uid() = user_id);
