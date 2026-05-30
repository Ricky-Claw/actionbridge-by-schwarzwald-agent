-- ActionBridge pilot capability rule allowlist refresh.
-- Keeps 5-10 customer pilot setup aligned with application capability definitions.

ALTER TABLE public.actionbridge_capability_rules
  DROP CONSTRAINT IF EXISTS actionbridge_capability_rules_name_check;

ALTER TABLE public.actionbridge_capability_rules
  ADD CONSTRAINT actionbridge_capability_rules_name_check
  CHECK (name IN ('site.knowledge.read', 'lead.prepare_draft', 'lead.submit', 'appointment.request.prepare_draft'));
