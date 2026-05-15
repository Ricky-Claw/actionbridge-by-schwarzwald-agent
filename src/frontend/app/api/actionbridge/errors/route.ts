export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { normalizeActionBridgeErrorCategory, normalizeActionBridgeErrorSeverity, toActionBridgeErrorLogView } from '@/lib/actionbridge/error-log';

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
