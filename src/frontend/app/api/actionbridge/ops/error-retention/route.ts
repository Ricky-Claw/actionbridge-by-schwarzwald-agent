export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createCoreServiceClient } from '@/lib/core/service-client';
import { persistActionBridgeControlAuditEvent } from '@/lib/actionbridge/persistence';
import { pruneActionBridgeResolvedErrorLogs } from '@/lib/actionbridge/error-log';

function parseUserIds(raw: string | undefined): string[] {
  return (raw || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index);
}

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.ACTIONBRIDGE_RETENTION_CRON_SECRET;
  if (!expected) return false;
  const header = request.headers.get('authorization') || '';
  return header === `Bearer ${expected}`;
}

function shouldDelete(request: NextRequest): boolean {
  return process.env.ACTIONBRIDGE_RETENTION_DELETE_ENABLED === 'true'
    && request.headers.get('x-actionbridge-retention-confirm') === 'DELETE_EXPIRED_ACTIONBRIDGE_ERROR_LOGS';
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_RETENTION_CRON_UNAUTHORIZED' }, { status: 401 });
  }

  const serviceSupabase = createCoreServiceClient();
  if (!serviceSupabase) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_RETENTION_CRON_UNAVAILABLE' }, { status: 503 });
  }

  const userIds = parseUserIds(process.env.ACTIONBRIDGE_RETENTION_USER_IDS);
  if (!userIds.length) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_RETENTION_USERS_NOT_CONFIGURED' }, { status: 503 });
  }

  const dryRun = !shouldDelete(request);
  const results = [];

  for (const userId of userIds) {
    const retention = await pruneActionBridgeResolvedErrorLogs({
      supabase: serviceSupabase,
      userId,
      dryRun,
    });

    await persistActionBridgeControlAuditEvent(serviceSupabase, {
      userId,
      eventName: dryRun ? 'error_log.retention_cron_dry_run' : 'error_log.retention_cron_deleted',
      input: { dryRun, source: 'scheduled_retention' },
      status: 'succeeded',
      resultSummary: {
        dryRun: retention.dryRun,
        deletedCount: retention.deletedCount,
        candidates: retention.candidates,
        cutoffs: retention.cutoffs,
        redacted: true,
      },
    });

    results.push({
      dryRun: retention.dryRun,
      deletedCount: retention.deletedCount,
      candidates: retention.candidates,
      cutoffs: retention.cutoffs,
    });
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    usersProcessed: results.length,
    results,
  });
}
