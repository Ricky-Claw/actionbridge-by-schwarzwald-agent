export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { ActionBridgeActionDefinition, ActionBridgeConnector } from '@/lib/actionbridge/types';
import { createActionBridgeWidgetToolCatalogs } from '@/lib/actionbridge/tool-catalog';

async function requireActionBridgeUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { supabase, user: null, response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
  }
  return { supabase, user, response: null };
}

export async function GET() {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;

  const { data: connectorRows, error: connectorError } = await (supabase as any)
    .from('actionbridge_connectors')
    .select('id, user_id, name, type, enabled, capabilities, safety_status, permission_status')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })
    .limit(100);

  if (connectorError) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_TOOL_CATALOG_CONNECTORS_FAILED' }, { status: 500 });
  }

  const { data: actionRows, error: actionError } = await (supabase as any)
    .from('actionbridge_actions')
    .select('id, user_id, connector_id, name, description, risk_level, input_schema, output_description, enabled, requires_approval')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })
    .limit(200);

  if (actionError) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_TOOL_CATALOG_ACTIONS_FAILED' }, { status: 500 });
  }

  const { data: capabilityRows, error: capabilityError } = await (supabase as any)
    .from('actionbridge_capability_rules')
    .select('id,user_id,connector_id,name,enabled')
    .eq('user_id', user!.id)
    .eq('enabled', true)
    .limit(200);

  if (capabilityError) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_TOOL_CATALOG_CAPABILITIES_FAILED' }, { status: 500 });
  }

  const connectors: Array<Pick<ActionBridgeConnector, 'id' | 'name' | 'type' | 'enabled' | 'capabilities' | 'safetyStatus' | 'permissionStatus'>> = (connectorRows || []).map((connector: any) => ({
    id: connector.id,
    name: connector.name,
    type: connector.type,
    enabled: connector.enabled,
    capabilities: connector.capabilities || [],
    safetyStatus: connector.safety_status || 'untested',
    permissionStatus: connector.permission_status || 'draft',
  }));

  const actions: ActionBridgeActionDefinition[] = (actionRows || []).map((action: any) => ({
    id: action.id,
    tenantId: action.user_id,
    connectorId: action.connector_id,
    name: action.name,
    description: action.description || '',
    riskLevel: action.risk_level,
    inputSchema: action.input_schema || [],
    outputDescription: action.output_description || '',
    enabled: action.enabled,
    requiresApproval: action.requires_approval,
  }));

  const capabilityRules = (capabilityRows || []).map((rule: any) => ({
    id: rule.id,
    tenantId: rule.user_id,
    connectorId: rule.connector_id,
    name: rule.name,
    enabled: rule.enabled,
  }));

  return NextResponse.json({
    version: 'actionbridge.catalog.v1',
    catalogs: createActionBridgeWidgetToolCatalogs({ connectors, actions, capabilityRules }),
    execution: { mode: 'dry_run_only', networkExecution: false },
  });
}
