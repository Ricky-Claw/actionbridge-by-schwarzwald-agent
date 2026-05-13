export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createCoreServiceClient } from '@/lib/core/service-client';
import { normalizeActionBridgeCapabilityRuleInput } from '@/lib/actionbridge/capability-rules';
import { redactActionBridgeValue } from '@/lib/actionbridge/redaction';

async function requireActionBridgeUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { supabase, user: null, response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
  }
  return { supabase, user, response: null };
}

function safeCapabilityRule(row: any) {
  return {
    id: row.id,
    connectorId: row.connector_id,
    name: row.name,
    riskLevel: row.risk_level,
    enabled: row.enabled,
    requiresApproval: row.requires_approval,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: NextRequest) {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;
  const connectorId = request.nextUrl.searchParams.get('connectorId');
  let query = (supabase as any)
    .from('actionbridge_capability_rules')
    .select('id,connector_id,name,risk_level,enabled,requires_approval,created_at,updated_at')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })
    .limit(100);
  if (connectorId) query = query.eq('connector_id', connectorId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'ACTIONBRIDGE_CAPABILITY_RULES_LIST_FAILED' }, { status: 500 });
  return NextResponse.json({ capabilityRules: (data || []).map(safeCapabilityRule) });
}

export async function POST(request: NextRequest) {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  const rule = normalizeActionBridgeCapabilityRuleInput({
    connectorId: body.connectorId,
    name: body.name,
    enabled: body.enabled,
    config: body.config,
  });
  if (!rule) {
    return NextResponse.json({ error: 'INVALID_ACTIONBRIDGE_CAPABILITY_RULE', redactedInput: redactActionBridgeValue(body) }, { status: 400 });
  }

  const { data: connector } = await (supabase as any)
    .from('actionbridge_connectors')
    .select('id,user_id,safety_status,permission_status')
    .eq('user_id', user!.id)
    .eq('id', rule.connectorId)
    .maybeSingle();
  if (!connector) return NextResponse.json({ error: 'ACTIONBRIDGE_CONNECTOR_NOT_FOUND' }, { status: 404 });
  if (rule.enabled && (connector.safety_status !== 'pass' || connector.permission_status !== 'active')) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_CAPABILITY_REQUIRES_VERIFIED_ACTIVE_CONNECTOR' }, { status: 409 });
  }

  const serviceSupabase = createCoreServiceClient();
  if (!serviceSupabase) return NextResponse.json({ error: 'ACTIONBRIDGE_CAPABILITY_RULE_SAVE_FAILED' }, { status: 503 });

  const now = new Date().toISOString();
  const { data, error } = await (serviceSupabase as any)
    .from('actionbridge_capability_rules')
    .upsert({
      user_id: user!.id,
      connector_id: rule.connectorId,
      name: rule.name,
      risk_level: rule.riskLevel,
      enabled: rule.enabled,
      requires_approval: rule.requiresApproval,
      config: redactActionBridgeValue(rule.config),
      updated_at: now,
    }, { onConflict: 'user_id,connector_id,name' })
    .select('id,connector_id,name,risk_level,enabled,requires_approval,created_at,updated_at')
    .single();

  if (error || !data) return NextResponse.json({ error: 'ACTIONBRIDGE_CAPABILITY_RULE_SAVE_FAILED' }, { status: 409 });
  return NextResponse.json({ capabilityRule: safeCapabilityRule(data) }, { status: 201 });
}
