export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sanitizeActionBridgeVisibilityResult } from '../visibility-sanitizer';

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

  const { data, error } = await (supabase as any)
    .from('actionbridge_audit_logs')
    .select('id, action_id, approval_id, action_name, risk_level, decision, status, redacted_input, result_summary, latency_ms, created_at')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })
    .limit(parseLimit(request));

  if (error) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_AUDIT_LIST_FAILED' }, { status: 500 });
  }

  return NextResponse.json({
    auditLogs: (data || []).map((entry: any) => ({
      id: entry.id,
      actionId: entry.action_id || null,
      approvalId: entry.approval_id || null,
      actionName: entry.action_name,
      riskLevel: entry.risk_level,
      decision: entry.decision,
      status: entry.status,
      redactedInput: entry.redacted_input || {},
      resultSummary: sanitizeActionBridgeVisibilityResult(entry.result_summary),
      latencyMs: entry.latency_ms,
      createdAt: entry.created_at,
    })),
  });
}
