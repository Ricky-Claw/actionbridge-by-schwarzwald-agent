-- F26 ActionBridge connector hardening for already-applied environments.
-- Keep normal clients from bypassing server-side connector validation.

DROP POLICY IF EXISTS actionbridge_connectors_owner_all ON public.actionbridge_connectors;
DROP POLICY IF EXISTS actionbridge_connectors_owner_select ON public.actionbridge_connectors;
CREATE POLICY actionbridge_connectors_owner_select ON public.actionbridge_connectors
  FOR SELECT USING (auth.uid() = user_id);
