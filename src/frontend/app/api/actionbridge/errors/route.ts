export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createCoreServiceClient } from '@/lib/core/service-client';
import { persistActionBridgeControlAuditEvent } from '@/lib/actionbridge/persistence';
import { canTransitionActionBridgeErrorStatus, normalizeActionBridgeErrorCategory, normalizeActionBridgeErrorSeverity, normalizeActionBridgeErrorStatus, pruneActionBridgeResolvedErrorLogs, toActionBridgeErrorLogView } from '@/lib/actionbridge/error-log';

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

  const category = normalizeActionBridgeErrorCategory(request.nextUrl.searchParams.get('category'));
  const severity = normalizeActionBridgeErrorSeverity(request.nextUrl.searchParams.get('severity'));
  const status = request.nextUrl.searchParams.get('status');

  let query = (supabase as any)
    .from('actionbridge_error_logs')
    .select('id, connector_id, execution_id, approval_id, category, severity, error_code, message, redacted_context, status, created_at, resolved_at')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })
    .limit(parseLimit(request));

  if (category) query = query.eq('category', category);
  if (severity) query = query.eq('severity', severity);
  if (status === 'open' || status === 'acknowledged' || status === 'resolved') query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'ACTIONBRIDGE_ERROR_LOG_LIST_FAILED' }, { status: 500 });

  return NextResponse.json({
    errorLogs: (data || []).map(toActionBridgeErrorLogView),
    filters: { category, severity, status: status || null },
  });
}

export async function DELETE(request: NextRequest) {
  const { user, response } = await requireActionBridgeUser();
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const dryRun = body.dryRun !== false;
  const confirm = typeof body.confirm === 'string' ? body.confirm : '';
  if (!dryRun && confirm !== 'DELETE_EXPIRED_ACTIONBRIDGE_ERROR_LOGS') {
    return NextResponse.json({ error: 'ACTIONBRIDGE_ERROR_RETENTION_CONFIRMATION_REQUIRED' }, { status: 400 });
  }

  const serviceSupabase = createCoreServiceClient();
  if (!serviceSupabase) return NextResponse.json({ error: 'ACTIONBRIDGE_ERROR_RETENTION_UNAVAILABLE' }, { status: 503 });

  const result = await pruneActionBridgeResolvedErrorLogs({
    supabase: serviceSupabase,
    userId: user!.id,
    dryRun,
  }).catch(() => null);
  if (!result) return NextResponse.json({ error: 'ACTIONBRIDGE_ERROR_RETENTION_FAILED' }, { status: 409 });

  await persistActionBridgeControlAuditEvent(serviceSupabase, {
    userId: user!.id,
    eventName: dryRun ? 'error_log.retention_dry_run' : 'error_log.retention_deleted',
    input: { dryRun },
    status: 'succeeded',
    resultSummary: {
      dryRun: result.dryRun,
      deletedCount: result.deletedCount,
      candidates: result.candidates,
      cutoffs: result.cutoffs,
      redacted: true,
    },
  });

  return NextResponse.json({ retention: result });
}

export async function PATCH(request: NextRequest) {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const errorId = typeof body.errorId === 'string' ? body.errorId.trim() : typeof body.id === 'string' ? body.id.trim() : '';
  const nextStatus = normalizeActionBridgeErrorStatus(body.status);
  if (!errorId || !nextStatus || nextStatus === 'open') {
    return NextResponse.json({ error: 'INVALID_ACTIONBRIDGE_ERROR_STATUS_UPDATE' }, { status: 400 });
  }

  const { data: existing } = await (supabase as any)
    .from('actionbridge_error_logs')
    .select('id,status,category,severity,error_code,connector_id')
    .eq('user_id', user!.id)
    .eq('id', errorId)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'ACTIONBRIDGE_ERROR_LOG_NOT_FOUND' }, { status: 404 });

  const currentStatus = normalizeActionBridgeErrorStatus(existing.status);
  if (!currentStatus || !canTransitionActionBridgeErrorStatus(currentStatus, nextStatus)) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_ERROR_STATUS_TRANSITION_BLOCKED' }, { status: 409 });
  }

  const serviceSupabase = createCoreServiceClient();
  if (!serviceSupabase) return NextResponse.json({ error: 'ACTIONBRIDGE_ERROR_STATUS_UPDATE_FAILED' }, { status: 503 });

  const { data, error } = await (serviceSupabase as any)
    .from('actionbridge_error_logs')
    .update({
      status: nextStatus,
      resolved_at: nextStatus === 'resolved' ? new Date().toISOString() : null,
    })
    .eq('user_id', user!.id)
    .eq('id', errorId)
    .eq('status', currentStatus)
    .select('id, connector_id, execution_id, approval_id, category, severity, error_code, message, redacted_context, status, created_at, resolved_at')
    .single();

  if (error || !data) return NextResponse.json({ error: 'ACTIONBRIDGE_ERROR_STATUS_UPDATE_FAILED' }, { status: 409 });

  await persistActionBridgeControlAuditEvent(serviceSupabase, {
    userId: user!.id,
    connectorId: data.connector_id || null,
    eventName: 'error_log.status_changed',
    input: { errorId, previousStatus: currentStatus, nextStatus },
    status: 'succeeded',
    resultSummary: { errorId, category: data.category, severity: data.severity, errorCode: data.error_code, status: data.status },
  });

  return NextResponse.json({ errorLog: toActionBridgeErrorLogView(data) });
}
