-- Harden ActionBridge target tenant isolation for shared Schwarzwald-Agent workspaces.
-- Targets are tenant-scoped; membership controls tenant visibility. owner_user_id remains creator/audit metadata.

CREATE TABLE IF NOT EXISTS public.actionbridge_tenant_memberships (
  provider_id TEXT NOT NULL DEFAULT 'schwarzwald-agent',
  tenant_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('owner', 'operator', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_id, tenant_id, user_id),
  CONSTRAINT actionbridge_tenant_memberships_provider_not_blank CHECK (btrim(provider_id) <> ''),
  CONSTRAINT actionbridge_tenant_memberships_tenant_not_blank CHECK (btrim(tenant_id) <> '')
);

INSERT INTO public.actionbridge_tenant_memberships (provider_id, tenant_id, user_id, role)
SELECT DISTINCT provider_id, tenant_id, owner_user_id, 'owner'
FROM public.actionbridge_targets
WHERE owner_user_id IS NOT NULL
ON CONFLICT (provider_id, tenant_id, user_id) DO NOTHING;

ALTER TABLE public.actionbridge_tenant_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS actionbridge_tenant_memberships_owner_select ON public.actionbridge_tenant_memberships;
CREATE POLICY actionbridge_tenant_memberships_owner_select ON public.actionbridge_tenant_memberships
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS actionbridge_targets_owner_user_select ON public.actionbridge_targets;
DROP POLICY IF EXISTS actionbridge_targets_owner_user_insert ON public.actionbridge_targets;
DROP POLICY IF EXISTS actionbridge_targets_owner_user_update ON public.actionbridge_targets;

CREATE POLICY actionbridge_targets_member_select ON public.actionbridge_targets
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.actionbridge_tenant_memberships m
      WHERE m.provider_id = actionbridge_targets.provider_id
        AND m.tenant_id = actionbridge_targets.tenant_id
        AND m.user_id = auth.uid()
    )
  );

CREATE POLICY actionbridge_targets_member_insert ON public.actionbridge_targets
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.actionbridge_tenant_memberships m
      WHERE m.provider_id = actionbridge_targets.provider_id
        AND m.tenant_id = actionbridge_targets.tenant_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner', 'operator')
    )
  );

CREATE POLICY actionbridge_targets_member_update ON public.actionbridge_targets
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.actionbridge_tenant_memberships m
      WHERE m.provider_id = actionbridge_targets.provider_id
        AND m.tenant_id = actionbridge_targets.tenant_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner', 'operator')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.actionbridge_tenant_memberships m
      WHERE m.provider_id = actionbridge_targets.provider_id
        AND m.tenant_id = actionbridge_targets.tenant_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner', 'operator')
    )
  );

CREATE INDEX IF NOT EXISTS idx_actionbridge_tenant_memberships_user ON public.actionbridge_tenant_memberships(user_id, provider_id, tenant_id);
