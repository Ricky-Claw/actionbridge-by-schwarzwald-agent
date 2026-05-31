export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createCoreServiceClient } from '@/lib/core/service-client';
import { createActionBridgeSetupSessionView, digestActionBridgeSetupSessionToken, isActionBridgeSetupSessionUsable, resolveActionBridgeSetupBridgePublicOrigin } from '@/lib/actionbridge/setup-session';
import { createActionBridgeRateLimitHeaders, enforceActionBridgeRateLimitAsync } from '@/lib/actionbridge/rate-limit';
import { createActionBridgeEmbeddedSetupDescriptor } from '@/lib/actionbridge/embedded-setup-ux';

function getToken(request: NextRequest): string {
  const url = new URL(request.url);
  return url.searchParams.get('token') || '';
}

export async function GET(request: NextRequest) {
  const token = getToken(request);
  const rateLimit = await enforceActionBridgeRateLimitAsync({ request, policyName: 'setupSession', discriminator: token.slice(0, 16) });
  if (!rateLimit.ok) return rateLimit.response!;
  if (!token || token.length < 12 || token.length > 160 || !token.startsWith('absl_')) {
    return NextResponse.json({ error: 'INVALID_ACTIONBRIDGE_SETUP_SESSION_TOKEN' }, { status: 400 });
  }

  const serviceSupabase = createCoreServiceClient();
  if (!serviceSupabase) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_SESSION_UNAVAILABLE' }, { status: 503 });

  const tokenDigest = digestActionBridgeSetupSessionToken(token);
  const { data: record, error } = await (serviceSupabase as any)
    .from('actionbridge_setup_links')
    .select('id,connector_id,target_origin,status,allowed_methods,expires_at')
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

  const bridgePublicOrigin = resolveActionBridgeSetupBridgePublicOrigin(new URL(request.url).origin);
  const [connectorResult, bridgeResult, capabilityRulesResult] = record.connector_id ? await Promise.all([
    (serviceSupabase as any)
      .from('actionbridge_connectors')
      .select('id,type,enabled,safety_status,permission_status,network_execution_enabled')
      .eq('id', record.connector_id)
      .maybeSingle(),
    (serviceSupabase as any)
      .from('actionbridge_bridge_installations')
      .select('status,last_seen_at')
      .eq('setup_link_id', record.id)
      .eq('target_origin', record.target_origin)
      .maybeSingle(),
    (serviceSupabase as any)
      .from('actionbridge_capability_rules')
      .select('name,enabled')
      .eq('connector_id', record.connector_id)
      .limit(20),
  ]) : [{ data: null }, { data: null }, { data: [] }];

  return NextResponse.json({
    setupSession: createActionBridgeSetupSessionView(record, {
      connector: connectorResult.data || null,
      bridge: bridgeResult.data || null,
      capabilityRules: Array.isArray(capabilityRulesResult.data) ? capabilityRulesResult.data : [],
      bridgePublicOrigin,
    }),
    embeddedSetup: createActionBridgeEmbeddedSetupDescriptor({
      connector: connectorResult.data ? {
        type: connectorResult.data.type,
        enabled: connectorResult.data.enabled,
        safetyStatus: connectorResult.data.safety_status,
        permissionStatus: connectorResult.data.permission_status,
        networkExecutionEnabled: false,
      } : undefined,
    }),
  }, {
    headers: createActionBridgeRateLimitHeaders({ policyName: 'setupSession', remaining: rateLimit.remaining, resetAt: rateLimit.resetAt }),
  });
}
