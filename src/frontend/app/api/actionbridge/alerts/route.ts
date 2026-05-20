export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createCoreServiceClient } from '@/lib/core/service-client';
import { persistActionBridgeControlAuditEvent } from '@/lib/actionbridge/persistence';
import { canTransitionActionBridgeErrorStatus, normalizeActionBridgeErrorSeverity, normalizeActionBridgeErrorStatus, toActionBridgeOperatorAlertView } from '@/lib/actionbridge/error-log';

async function requireActionBridgeUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { supabase, user: null, response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
  }
  return { supabase, user, response: null };
}

function parseLimit(request: NextRequest): number {
  const rawLimit = request.nextUrl.searchParams.get('limit');
  const parsed = rawLimit ? Number.parseInt(rawLimit, 10) : 50;
  if (!Number.isFinite(parsed) || parsed < 1) return 50;
  return Math.min(parsed, 100);
}

export async function GET(request: NextRequest) {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;

  const severity = normalizeActionBridgeErrorSeverity(request.nextUrl.searchParams.get('severity'));
  const status = normalizeActionBridgeErrorStatus(request.nextUrl.searchParams.get('status'));

  let query = (supabase as any)
    .from('actionbridge_operator_alerts')
    .select('id, error_log_id, connector_id, category, severity, error_code, message, redacted_context, status, created_at, acknowledged_at, resolved_at')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })
    .limit(parseLimit(request));

  if (severity === 'high' || severity === 'critical') query = query.eq('severity', severity);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'ACTIONBRIDGE_OPERATOR_ALERT_LIST_FAILED' }, { status: 500 });

  return NextResponse.json({
    operatorAlerts: (data || []).map(toActionBridgeOperatorAlertView),
    filters: { severity: severity === 'high' || severity === 'critical' ? severity : null, status: status || null },
  });
}

export async function PATCH(request: NextRequest) {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const alertId = typeof body.alertId === 'string' ? body.alertId.trim() : typeof body.id === 'string' ? body.id.trim() : '';
  const nextStatus = normalizeActionBridgeErrorStatus(body.status);
  if (!alertId || !nextStatus || nextStatus === 'open') {
    return NextResponse.json({ error: 'INVALID_ACTIONBRIDGE_OPERATOR_ALERT_STATUS_UPDATE' }, { status: 400 });
  }

  const { data: existing } = await (supabase as any)
    .from('actionbridge_operator_alerts')
    .select('id,error_log_id,connector_id,status,category,severity,error_code')
    .eq('user_id', user!.id)
    .eq('id', alertId)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'ACTIONBRIDGE_OPERATOR_ALERT_NOT_FOUND' }, { status: 404 });

  const currentStatus = normalizeActionBridgeErrorStatus(existing.status);
  if (!currentStatus || !canTransitionActionBridgeErrorStatus(currentStatus, nextStatus)) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_OPERATOR_ALERT_STATUS_TRANSITION_BLOCKED' }, { status: 409 });
  }

  const serviceSupabase = createCoreServiceClient();
  if (!serviceSupabase) return NextResponse.json({ error: 'ACTIONBRIDGE_OPERATOR_ALERT_STATUS_UPDATE_FAILED' }, { status: 503 });

  const now = new Date().toISOString();
  const { data, error } = await (serviceSupabase as any)
    .rpc('update_actionbridge_operator_alert_status', {
      p_user_id: user!.id,
      p_alert_id: alertId,
      p_current_status: currentStatus,
      p_next_status: nextStatus,
      p_changed_at: now,
    });

  const updatedAlert = Array.isArray(data) ? data[0] : data;
  if (error || !updatedAlert) return NextResponse.json({ error: 'ACTIONBRIDGE_OPERATOR_ALERT_STATUS_UPDATE_FAILED' }, { status: 409 });

  await persistActionBridgeControlAuditEvent(serviceSupabase, {
    userId: user!.id,
    connectorId: updatedAlert.connector_id || null,
    eventName: 'operator_alert.status_changed',
    input: { alertId, errorLogId: updatedAlert.error_log_id, previousStatus: currentStatus, nextStatus },
    status: 'succeeded',
    resultSummary: { alertId, errorLogId: updatedAlert.error_log_id, category: updatedAlert.category, severity: updatedAlert.severity, errorCode: updatedAlert.error_code, status: updatedAlert.status },
  });

  return NextResponse.json({ operatorAlert: toActionBridgeOperatorAlertView(updatedAlert) });
}
