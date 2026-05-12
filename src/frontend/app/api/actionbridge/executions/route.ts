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

function forceSafeResult(value: unknown): Record<string, unknown> {
  return sanitizeActionBridgeVisibilityResult(value);
}

export async function GET(request: NextRequest) {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;

  const { data, error } = await (supabase as any)
    .from('actionbridge_executions')
    .select('id, approval_id, action_id, action_name, risk_level, execution_status, safe_result, created_at, updated_at')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })
    .limit(parseLimit(request));

  if (error) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_EXECUTIONS_LIST_FAILED' }, { status: 500 });
  }

  return NextResponse.json({
    executions: (data || []).map((execution: any) => ({
      id: execution.id,
      approvalId: execution.approval_id,
      actionId: execution.action_id || null,
      actionName: execution.action_name,
      riskLevel: execution.risk_level,
      executionStatus: execution.execution_status,
      safeResult: forceSafeResult(execution.safe_result),
      createdAt: execution.created_at,
      updatedAt: execution.updated_at,
    })),
  });
}
