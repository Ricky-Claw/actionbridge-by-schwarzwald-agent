export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createCoreServiceClient } from '@/lib/core/service-client';
import { createActionBridgeSetupSessionView, digestActionBridgeSetupSessionToken, isActionBridgeSetupSessionUsable } from '@/lib/actionbridge/setup-session';
import { createActionBridgeRateLimitHeaders, enforceActionBridgeRateLimit } from '@/lib/actionbridge/rate-limit';

function getToken(request: NextRequest): string {
  const url = new URL(request.url);
  return url.searchParams.get('token') || '';
}

export async function GET(request: NextRequest) {
  const token = getToken(request);
  const rateLimit = enforceActionBridgeRateLimit({ request, policyName: 'setupSession', discriminator: token.slice(0, 16) });
  if (!rateLimit.ok) return rateLimit.response!;
  if (!token || token.length < 12 || token.length > 160 || !token.startsWith('absl_')) {
    return NextResponse.json({ error: 'INVALID_ACTIONBRIDGE_SETUP_SESSION_TOKEN' }, { status: 400 });
  }

  const serviceSupabase = createCoreServiceClient();
  if (!serviceSupabase) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_SESSION_UNAVAILABLE' }, { status: 503 });

  const tokenDigest = digestActionBridgeSetupSessionToken(token);
  const { data: record, error } = await (serviceSupabase as any)
    .from('actionbridge_setup_links')
    .select('id,target_origin,status,allowed_methods,expires_at')
    .eq('token_digest', tokenDigest)
    .maybeSingle();

  if (error || !record) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_SESSION_NOT_FOUND' }, { status: 404 });
  if (!isActionBridgeSetupSessionUsable(record)) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_SESSION_EXPIRED_OR_CLOSED' }, { status: 409 });

  if (record.status === 'pending') {
    await (serviceSupabase as any)
      .from('actionbridge_setup_links')
      .update({ status: 'opened' })
      .eq('token_digest', tokenDigest)
      .eq('status', 'pending');
    record.status = 'opened';
  }

  return NextResponse.json({ setupSession: createActionBridgeSetupSessionView(record) }, {
    headers: createActionBridgeRateLimitHeaders({ policyName: 'setupSession', remaining: rateLimit.remaining, resetAt: rateLimit.resetAt }),
  });
}
