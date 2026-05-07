import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActionBridgeRiskLevel } from './types';

export interface ServerActionBridgePolicy {
  actionId: string | null;
  actionName: string;
  riskLevel: ActionBridgeRiskLevel;
  explicitAllow: boolean;
  approvalConfigured: boolean;
}

function normalizeRiskLevel(value: unknown): ActionBridgeRiskLevel {
  if (value === 'read' || value === 'write' || value === 'transactional' || value === 'destructive') return value;
  return 'write';
}

export async function getServerActionBridgePolicy(
  supabase: SupabaseClient,
  userId: string,
  requestedActionName: string
): Promise<ServerActionBridgePolicy> {
  const actionName = requestedActionName.trim() || 'unknown_action';

  const { data } = await supabase
    .from('actionbridge_actions')
    .select('id,name,risk_level,requires_approval,enabled')
    .eq('user_id', userId)
    .eq('name', actionName)
    .maybeSingle();

  const action = data as {
    id?: string;
    name?: string;
    risk_level?: unknown;
    requires_approval?: boolean | null;
    enabled?: boolean | null;
  } | null;

  if (!action || action.enabled !== true) {
    return {
      actionId: action?.id || null,
      actionName,
      riskLevel: 'write',
      explicitAllow: false,
      approvalConfigured: true,
    };
  }

  const riskLevel = normalizeRiskLevel(action.risk_level);
  const approvalConfigured = action.requires_approval !== false;

  return {
    actionId: action.id || null,
    actionName: action.name || actionName,
    riskLevel,
    explicitAllow: riskLevel === 'read' || approvalConfigured === false,
    approvalConfigured,
  };
}
