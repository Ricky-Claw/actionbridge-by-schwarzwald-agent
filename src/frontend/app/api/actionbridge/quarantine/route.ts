export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createCoreServiceClient } from '@/lib/core/service-client';
import { persistActionBridgeControlAuditEvent } from '@/lib/actionbridge/persistence';
import { toActionBridgeConnectorQuarantineView } from '@/lib/actionbridge/webhook-quarantine';
import { redactActionBridgeValue } from '@/lib/actionbridge/redaction';

async function requireActionBridgeUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { supabase, user: null, response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
  }
  return { supabase, user, response: null };
}

function normalizeQuarantineReason(value: unknown): 'operator_pause' | 'system_pause' {
  return value === 'system_pause' ? 'system_pause' : 'operator_pause';
}

function safeOperatorMessage(value: unknown): string {
  if (typeof value !== 'string') return 'Connector is paused by ActionBridge operator controls.';
  const trimmed = value.trim().slice(0, 240);
  return trimmed || 'Connector is paused by ActionBridge operator controls.';
}

export async function GET(request: NextRequest) {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;

  const status = request.nextUrl.searchParams.get('status');
  let query = (supabase as any)
    .from('actionbridge_connector_quarantine')
    .select('id, connector_id, status, reason_code, message, redacted_context, failure_count, created_at, updated_at, resolved_at')
    .eq('user_id', user!.id)
    .order('updated_at', { ascending: false })
    .limit(100);
  if (status === 'active' || status === 'resolved') query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'ACTIONBRIDGE_CONNECTOR_QUARANTINE_LIST_FAILED' }, { status: 500 });

  return NextResponse.json({ quarantines: (data || []).map(toActionBridgeConnectorQuarantineView) });
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireActionBridgeUser();
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const connectorId = typeof body.connectorId === 'string' ? body.connectorId.trim() : typeof body.connector_id === 'string' ? body.connector_id.trim() : '';
  if (!connectorId) return NextResponse.json({ error: 'INVALID_ACTIONBRIDGE_CONNECTOR_QUARANTINE' }, { status: 400 });

  const serviceSupabase = createCoreServiceClient();
  if (!serviceSupabase) return NextResponse.json({ error: 'ACTIONBRIDGE_CONNECTOR_QUARANTINE_UNAVAILABLE' }, { status: 503 });

  const { data: connector } = await (serviceSupabase as any)
    .from('actionbridge_connectors')
    .select('id,type')
    .eq('user_id', user!.id)
    .eq('id', connectorId)
    .maybeSingle();
  if (!connector) return NextResponse.json({ error: 'ACTIONBRIDGE_CONNECTOR_NOT_FOUND' }, { status: 404 });

  const now = new Date().toISOString();
  const { data: active } = await (serviceSupabase as any)
    .from('actionbridge_connector_quarantine')
    .select('id')
    .eq('user_id', user!.id)
    .eq('connector_id', connectorId)
    .eq('status', 'active')
    .maybeSingle();

  const mutation = active?.id
    ? (serviceSupabase as any)
      .from('actionbridge_connector_quarantine')
      .update({
        reason_code: normalizeQuarantineReason(body.reasonCode ?? body.reason_code),
        message: safeOperatorMessage(body.message),
        redacted_context: redactActionBridgeValue({ operatorReason: body.reasonCode ?? body.reason_code ?? 'operator_pause' }),
        updated_at: now,
        resolved_at: null,
      })
      .eq('user_id', user!.id)
      .eq('id', active.id)
      .eq('status', 'active')
    : (serviceSupabase as any)
      .from('actionbridge_connector_quarantine')
      .insert({
        user_id: user!.id,
        connector_id: connectorId,
        status: 'active',
        reason_code: normalizeQuarantineReason(body.reasonCode ?? body.reason_code),
        message: safeOperatorMessage(body.message),
        redacted_context: redactActionBridgeValue({ operatorReason: body.reasonCode ?? body.reason_code ?? 'operator_pause' }),
        failure_count: 0,
        updated_at: now,
        resolved_at: null,
      });

  const { data, error } = await mutation
    .select('id, connector_id, status, reason_code, message, redacted_context, failure_count, created_at, updated_at, resolved_at')
    .single();

  if (error || !data) return NextResponse.json({ error: 'ACTIONBRIDGE_CONNECTOR_QUARANTINE_CREATE_FAILED' }, { status: 409 });

  await persistActionBridgeControlAuditEvent(serviceSupabase, {
    userId: user!.id,
    connectorId,
    eventName: 'connector_quarantine.paused',
    input: { connectorId, reasonCode: normalizeQuarantineReason(body.reasonCode ?? body.reason_code) },
    status: 'succeeded',
    resultSummary: { connectorId, quarantineId: data.id, status: data.status, reasonCode: data.reason_code, redacted: true },
  });

  return NextResponse.json({ quarantine: toActionBridgeConnectorQuarantineView(data) }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const { user, response } = await requireActionBridgeUser();
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const quarantineId = typeof body.quarantineId === 'string' ? body.quarantineId.trim() : typeof body.id === 'string' ? body.id.trim() : '';
  if (!quarantineId || body.status !== 'resolved') return NextResponse.json({ error: 'INVALID_ACTIONBRIDGE_CONNECTOR_QUARANTINE_UPDATE' }, { status: 400 });

  const serviceSupabase = createCoreServiceClient();
  if (!serviceSupabase) return NextResponse.json({ error: 'ACTIONBRIDGE_CONNECTOR_QUARANTINE_UPDATE_FAILED' }, { status: 503 });

  const now = new Date().toISOString();
  const { data, error } = await (serviceSupabase as any)
    .from('actionbridge_connector_quarantine')
    .update({ status: 'resolved', resolved_at: now, updated_at: now })
    .eq('user_id', user!.id)
    .eq('id', quarantineId)
    .eq('status', 'active')
    .select('id, connector_id, status, reason_code, message, redacted_context, failure_count, created_at, updated_at, resolved_at')
    .single();

  if (error || !data) return NextResponse.json({ error: 'ACTIONBRIDGE_CONNECTOR_QUARANTINE_UPDATE_FAILED' }, { status: 409 });

  await persistActionBridgeControlAuditEvent(serviceSupabase, {
    userId: user!.id,
    connectorId: data.connector_id,
    eventName: 'connector_quarantine.resolved',
    input: { quarantineId, status: 'resolved' },
    status: 'succeeded',
    resultSummary: { quarantineId, connectorId: data.connector_id, status: data.status, reasonCode: data.reason_code, redacted: true },
  });

  return NextResponse.json({ quarantine: toActionBridgeConnectorQuarantineView(data) });
}
