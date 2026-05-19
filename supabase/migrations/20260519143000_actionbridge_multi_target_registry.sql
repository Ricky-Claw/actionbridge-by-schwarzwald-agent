-- ActionBridge multi-target registry for Archipel/Schwarzwald-Agent workspaces.
-- ActionBridge remains connector-only: targets are tenant-scoped URLs with connection status and read-only capabilities.

CREATE TABLE IF NOT EXISTS public.actionbridge_targets (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL DEFAULT 'schwarzwald-agent',
  tenant_id TEXT NOT NULL,
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  origin TEXT NOT NULL,
  hostname TEXT NOT NULL,
  bridge_origin TEXT NOT NULL DEFAULT 'https://bridge.schwarzwald-agent.de',
  ownership_status TEXT NOT NULL DEFAULT 'pending' CHECK (ownership_status IN ('pending', 'verified', 'unverified', 'failed')),
  script_status TEXT NOT NULL DEFAULT 'unknown' CHECK (script_status IN ('unknown', 'connected', 'missing_script', 'script_found_no_handshake', 'unreachable', 'error')),
  connection_status TEXT NOT NULL DEFAULT 'pending' CHECK (connection_status IN ('pending', 'connected', 'unverified', 'missing_script', 'unreachable', 'error')),
  capabilities JSONB NOT NULL DEFAULT '["actionbridge.targets.list", "actionbridge.target.status", "actionbridge.target.capabilities", "actionbridge.target.health_check"]'::jsonb,
  status_metadata JSONB NOT NULL DEFAULT '{"networkExecution": false}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT actionbridge_targets_provider_not_blank CHECK (btrim(provider_id) <> ''),
  CONSTRAINT actionbridge_targets_tenant_not_blank CHECK (btrim(tenant_id) <> ''),
  CONSTRAINT actionbridge_targets_https_url CHECK (url LIKE 'https://%'),
  CONSTRAINT actionbridge_targets_https_origin CHECK (origin LIKE 'https://%'),
  CONSTRAINT actionbridge_targets_https_bridge_origin CHECK (bridge_origin LIKE 'https://%'),
  CONSTRAINT actionbridge_targets_capabilities_array CHECK (jsonb_typeof(capabilities) = 'array'),
  UNIQUE (provider_id, tenant_id, origin)
);

COMMENT ON TABLE public.actionbridge_targets IS
  'Tenant-scoped ActionBridge target registry. A target is one connected URL/island; ActionBridge exposes connector status and read-only agent tools, not business automation logic.';

COMMENT ON COLUMN public.actionbridge_targets.provider_id IS
  'Integration provider, initially schwarzwald-agent. Kept separate from tenant_id so ActionBridge can become a standalone product later.';

COMMENT ON COLUMN public.actionbridge_targets.tenant_id IS
  'Schwarzwald-Agent customer/workspace id. Every target query and tool catalog must be scoped by this value.';

COMMENT ON COLUMN public.actionbridge_targets.bridge_origin IS
  'Bridge script origin, defaulting to bridge.schwarzwald-agent.de; future product/white-label origins can be stored per target.';

ALTER TABLE public.actionbridge_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS actionbridge_targets_owner_user_select ON public.actionbridge_targets;
CREATE POLICY actionbridge_targets_owner_user_select ON public.actionbridge_targets
  FOR SELECT USING (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS actionbridge_targets_owner_user_insert ON public.actionbridge_targets;
CREATE POLICY actionbridge_targets_owner_user_insert ON public.actionbridge_targets
  FOR INSERT WITH CHECK (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS actionbridge_targets_owner_user_update ON public.actionbridge_targets;
CREATE POLICY actionbridge_targets_owner_user_update ON public.actionbridge_targets
  FOR UPDATE USING (auth.uid() = owner_user_id) WITH CHECK (auth.uid() = owner_user_id);

CREATE INDEX IF NOT EXISTS idx_actionbridge_targets_provider_tenant ON public.actionbridge_targets(provider_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_actionbridge_targets_tenant_status ON public.actionbridge_targets(provider_id, tenant_id, connection_status);
CREATE INDEX IF NOT EXISTS idx_actionbridge_targets_owner_user ON public.actionbridge_targets(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_actionbridge_targets_hostname ON public.actionbridge_targets(hostname);
