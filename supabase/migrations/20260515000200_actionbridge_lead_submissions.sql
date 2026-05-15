-- ActionBridge Pilot Action v1: approval-gated lead submissions/outbox.
-- This is a real ActionBridge-side action after approval, not an unsafe external form submit.

CREATE TABLE IF NOT EXISTS public.actionbridge_lead_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connector_id UUID,
  action_id UUID,
  approval_id UUID NOT NULL,
  execution_id UUID,
  source_origin TEXT,
  source_path TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'delivered', 'failed', 'revoked')),
  redacted_lead JSONB NOT NULL DEFAULT '{}'::jsonb,
  delivery_mode TEXT NOT NULL DEFAULT 'actionbridge_outbox' CHECK (delivery_mode IN ('actionbridge_outbox')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (approval_id),
  UNIQUE (id, user_id),
  FOREIGN KEY (connector_id, user_id) REFERENCES public.actionbridge_connectors(id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (action_id, user_id) REFERENCES public.actionbridge_actions(id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (approval_id, user_id) REFERENCES public.actionbridge_approvals(id, user_id) ON DELETE RESTRICT
);

ALTER TABLE public.actionbridge_lead_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS actionbridge_lead_submissions_owner_select ON public.actionbridge_lead_submissions;
CREATE POLICY actionbridge_lead_submissions_owner_select ON public.actionbridge_lead_submissions
  FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_actionbridge_lead_submissions_user_status ON public.actionbridge_lead_submissions(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_actionbridge_lead_submissions_connector ON public.actionbridge_lead_submissions(user_id, connector_id, created_at DESC);

-- Contract marker for pilot capability expansion; canonical constraint is added by a follow-up ALTER migration in production.
-- name IN ('site.knowledge.read', 'lead.prepare_draft', 'lead.submit', 'appointment.request.prepare_draft')
