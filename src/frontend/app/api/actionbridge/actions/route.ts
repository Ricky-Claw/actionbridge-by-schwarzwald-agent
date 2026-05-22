export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { ActionBridgeRiskLevel } from '@/lib/actionbridge/types';
import { redactActionBridgeValue } from '@/lib/actionbridge/redaction';
import { createCoreServiceClient } from '@/lib/core/service-client';
import { sanitizeActionBridgeInputSchema, sanitizeActionBridgeSchemaName, sanitizeActionBridgeSchemaText } from '@/lib/actionbridge/schema-safety';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requireActionBridgeUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { supabase, user: null, response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
  }
  return { supabase, user, response: null };
}

function parseActionBridgeActionDraft(body: Record<string, unknown>) {
  const name = sanitizeActionBridgeSchemaName(body.name, 80);
  const connectorId = typeof body.connectorId === 'string'
    ? body.connectorId.trim()
    : typeof body.connector_id === 'string'
      ? body.connector_id.trim()
      : '';
  const description = sanitizeActionBridgeSchemaText(body.description, 500);
  const outputDescription = sanitizeActionBridgeSchemaText(body.outputDescription ?? body.output_description, 500);
  const inputSchema = sanitizeActionBridgeInputSchema(body.inputSchema ?? body.input_schema);
  const riskLevel: ActionBridgeRiskLevel = 'write';

  if (!name || !connectorId || !UUID_PATTERN.test(connectorId) || description === null || outputDescription === null || !inputSchema) return null;

  return {
    connector_id: connectorId,
    name,
    description: description || '',
    risk_level: riskLevel,
    input_schema: inputSchema,
    output_description: outputDescription || '',
    enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
    requires_approval: true,
  };
}

export async function GET() {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;

  const { data, error } = await (supabase as any)
    .from('actionbridge_actions')
    .select('id, user_id, connector_id, name, description, risk_level, input_schema, output_description, enabled, requires_approval, created_at, updated_at')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_ACTIONS_LIST_FAILED' }, { status: 500 });
  }

  return NextResponse.json({
    actions: (data || []).map((action: any) => ({
      id: action.id,
      tenantId: action.user_id,
      connectorId: action.connector_id,
      name: action.name,
      description: action.description,
      riskLevel: action.risk_level,
      inputSchema: action.input_schema || [],
      outputDescription: action.output_description || '',
      enabled: action.enabled,
      requiresApproval: action.requires_approval,
      createdAt: action.created_at,
      updatedAt: action.updated_at,
    })),
  });
}

export async function POST(request: NextRequest) {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const redactedBody = redactActionBridgeValue(body);
  const bodyObject = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const draft = parseActionBridgeActionDraft(bodyObject);

  if (!draft) {
    return NextResponse.json({ error: 'INVALID_ACTIONBRIDGE_ACTION', redactedInput: redactedBody }, { status: 400 });
  }

  const { data: connector } = await (supabase as any)
    .from('actionbridge_connectors')
    .select('id')
    .eq('user_id', user!.id)
    .eq('id', draft.connector_id)
    .maybeSingle();

  if (!connector) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_CONNECTOR_NOT_FOUND', redactedInput: redactedBody }, { status: 404 });
  }

  const serviceSupabase = createCoreServiceClient();
  if (!serviceSupabase) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_ACTION_CREATE_FAILED', redactedInput: redactedBody }, { status: 503 });
  }

  const { data, error } = await (serviceSupabase as any)
    .from('actionbridge_actions')
    .insert({
      user_id: user!.id,
      ...draft,
    })
    .select('id, user_id, connector_id, name, description, risk_level, input_schema, output_description, enabled, requires_approval, created_at, updated_at')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_ACTION_CREATE_FAILED', redactedInput: redactedBody }, { status: 409 });
  }

  return NextResponse.json({
    action: {
      id: data.id,
      tenantId: data.user_id,
      connectorId: data.connector_id,
      name: data.name,
      description: data.description,
      riskLevel: data.risk_level,
      inputSchema: data.input_schema || [],
      outputDescription: data.output_description || '',
      enabled: data.enabled,
      requiresApproval: data.requires_approval,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  }, { status: 201 });
}
