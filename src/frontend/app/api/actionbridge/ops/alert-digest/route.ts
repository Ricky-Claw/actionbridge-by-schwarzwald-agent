export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createCoreServiceClient } from '@/lib/core/service-client';
import { persistActionBridgeControlAuditEvent } from '@/lib/actionbridge/persistence';
import { toActionBridgeOperatorAlertView } from '@/lib/actionbridge/error-log';

function parseUserIds(raw: string | undefined): string[] {
  return (raw || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index);
}

function parseLimit(raw: string | null): number {
  const parsed = raw ? Number.parseInt(raw, 10) : 25;
  if (!Number.isFinite(parsed) || parsed < 1) return 25;
  return Math.min(parsed, 50);
}

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.ACTIONBRIDGE_ALERT_DIGEST_SECRET;
  if (!expected) return false;
  const header = request.headers.get('authorization') || '';
  return header === `Bearer ${expected}`;
}

function redactAlertForDigest(row: any) {
  const alert = toActionBridgeOperatorAlertView(row);
  return {
    id: alert.id,
    errorLogId: alert.errorLogId,
    connectorId: alert.connectorId,
    category: alert.category,
    severity: alert.severity,
    errorCode: alert.errorCode,
    message: alert.message,
    status: alert.status,
    createdAt: alert.createdAt,
    acknowledgedAt: alert.acknowledgedAt,
    resolvedAt: alert.resolvedAt,
  };
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_ALERT_DIGEST_UNAUTHORIZED' }, { status: 401 });
  }

  const serviceSupabase = createCoreServiceClient();
  if (!serviceSupabase) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_ALERT_DIGEST_UNAVAILABLE' }, { status: 503 });
  }

  const userIds = parseUserIds(process.env.ACTIONBRIDGE_ALERT_DIGEST_USER_IDS);
  if (!userIds.length) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_ALERT_DIGEST_USERS_NOT_CONFIGURED' }, { status: 503 });
  }

  const limit = parseLimit(request.nextUrl.searchParams.get('limit'));
  const results = [];

  for (const userId of userIds) {
    const { data, error } = await (serviceSupabase as any)
      .from('actionbridge_operator_alerts')
      .select('id,error_log_id,connector_id,category,severity,error_code,message,status,created_at,acknowledged_at,resolved_at')
      .eq('user_id', userId)
      .eq('status', 'open')
      .in('severity', ['high', 'critical'])
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      results.push({ userId, error: 'ACTIONBRIDGE_ALERT_DIGEST_QUERY_FAILED', openCritical: 0, openHigh: 0, alerts: [] });
      continue;
    }

    const alerts = (data || []).map(redactAlertForDigest);
    const summary = {
      userId,
      openCritical: alerts.filter((alert) => alert.severity === 'critical').length,
      openHigh: alerts.filter((alert) => alert.severity === 'high').length,
      alerts,
    };

    await persistActionBridgeControlAuditEvent(serviceSupabase, {
      userId,
      eventName: 'operator_alert.digest_generated',
      input: { source: 'scheduled_alert_digest', limit },
      status: 'succeeded',
      resultSummary: {
        openCritical: summary.openCritical,
        openHigh: summary.openHigh,
        alertCount: alerts.length,
        redacted: true,
      },
    });

    results.push(summary);
  }

  return NextResponse.json({
    ok: true,
    usersProcessed: results.length,
    results,
  });
}
