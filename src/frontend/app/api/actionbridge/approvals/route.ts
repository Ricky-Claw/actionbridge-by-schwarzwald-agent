export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createCoreServiceClient } from '@/lib/core/service-client';

async function requireActionBridgeUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { supabase, user: null, response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
  }
  return { supabase, user, response: null };
}

export async function GET() {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;

  const { data, error } = await (supabase as any)
    .from('actionbridge_approvals')
    .select('id, action_id, connector_id, action_name, risk_level, redacted_input, action_snapshot, status, decision_reason, created_at, decided_at')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_APPROVALS_LIST_FAILED' }, { status: 500 });
  }

  return NextResponse.json({ approvals: data || [] });
}

export async function POST(request: NextRequest) {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const approvalId = typeof body.approvalId === 'string' ? body.approvalId : '';
  const decision = body.decision === 'approved' || body.decision === 'rejected' ? body.decision : null;

  if (!approvalId || !decision) {
    return NextResponse.json({ error: 'INVALID_APPROVAL_DECISION' }, { status: 400 });
  }

  const serviceSupabase = createCoreServiceClient();
  if (!serviceSupabase) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_APPROVAL_DECISION_FAILED' }, { status: 503 });
  }

  const { data, error } = await (serviceSupabase as any)
    .rpc('decide_actionbridge_approval_atomic', {
      p_user_id: user!.id,
      p_approval_id: approvalId,
      p_status: decision,
    });

  const approval = Array.isArray(data) ? data[0] : data;
  if (error || !approval) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_APPROVAL_DECISION_FAILED' }, { status: 409 });
  }

  return NextResponse.json({ approval });
}
