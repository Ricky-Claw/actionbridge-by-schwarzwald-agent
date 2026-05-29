export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createCoreServiceClient } from '@/lib/core/service-client';
import { parseActionBridgeBridgeHandshake } from '@/lib/actionbridge/bridge-handshake';
import { verifyActionBridgeConnectorSetupTargetOriginBinding } from '@/lib/actionbridge/setup-links';
import { persistActionBridgeControlAuditEvent } from '@/lib/actionbridge/persistence';
import { createActionBridgeRateLimitHeaders, enforceActionBridgeRateLimitAsync } from '@/lib/actionbridge/rate-limit';

export async function POST(request: NextRequest) {
  const rateLimit = await enforceActionBridgeRateLimitAsync({ request, policyName: 'bridgeHandshake' });
  if (!rateLimit.ok) return rateLimit.response!;

  const body = await request.json().catch(() => ({}));
  const originHeader = request.headers.get('origin') || '';
  const parsed = parseActionBridgeBridgeHandshake({
    token: body.token,
    origin: body.origin || originHeader,
    bridgeVersion: body.bridgeVersion,
  });
  if (!parsed || (originHeader && originHeader !== parsed.origin)) {
    return NextResponse.json({ error: 'INVALID_ACTIONBRIDGE_BRIDGE_HANDSHAKE' }, { status: 400 });
  }

  const serviceSupabase = createCoreServiceClient();
  if (!serviceSupabase) return NextResponse.json({ error: 'ACTIONBRIDGE_BRIDGE_HANDSHAKE_UNAVAILABLE' }, { status: 503 });

  const { data: setupLink } = await (serviceSupabase as any)
    .from('actionbridge_setup_links')
    .select('id,user_id,connector_id,target_origin,status,expires_at')
    .eq('token_digest', parsed.tokenDigest)
    .maybeSingle();
  if (!setupLink) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_LINK_NOT_FOUND' }, { status: 404 });
  if (setupLink.target_origin !== parsed.origin) return NextResponse.json({ error: 'ACTIONBRIDGE_BRIDGE_ORIGIN_MISMATCH' }, { status: 403 });
  if (!['pending', 'opened'].includes(setupLink.status) || new Date(setupLink.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_LINK_EXPIRED_OR_REVOKED' }, { status: 409 });
  }

  if (setupLink.connector_id) {
    const bindingStatus = await verifyActionBridgeConnectorSetupTargetOriginBinding(serviceSupabase as any, {
      userId: setupLink.user_id,
      connectorId: setupLink.connector_id,
      targetOrigin: setupLink.target_origin,
    });
    if (bindingStatus === 'connector_not_found') {
      return NextResponse.json({ error: 'ACTIONBRIDGE_BRIDGE_CONNECTOR_BINDING_NOT_FOUND' }, { status: 409 });
    }
    if (bindingStatus !== 'matched') {
      await persistActionBridgeControlAuditEvent(serviceSupabase, {
        userId: setupLink.user_id,
        connectorId: setupLink.connector_id,
        eventName: 'bridge.handshake.denied',
        input: { setupLinkId: setupLink.id, targetOrigin: parsed.origin, bridgeVersion: parsed.bridgeVersion },
        status: 'denied',
        resultSummary: { reason: 'ACTIONBRIDGE_BRIDGE_CONNECTOR_ORIGIN_MISMATCH' },
      });
      return NextResponse.json({ error: 'ACTIONBRIDGE_BRIDGE_CONNECTOR_ORIGIN_MISMATCH' }, { status: 409 });
    }
  }

  const now = new Date().toISOString();
  const { data: existingInstallation } = await (serviceSupabase as any)
    .from('actionbridge_bridge_installations')
    .select('id,status')
    .eq('setup_link_id', setupLink.id)
    .eq('target_origin', parsed.origin)
    .maybeSingle();
  if (existingInstallation?.status === 'revoked') {
    return NextResponse.json({ error: 'ACTIONBRIDGE_BRIDGE_INSTALLATION_REVOKED' }, { status: 409 });
  }

  const { data, error } = await (serviceSupabase as any)
    .from('actionbridge_bridge_installations')
    .upsert({
      user_id: setupLink.user_id,
      setup_link_id: setupLink.id,
      connector_id: setupLink.connector_id,
      target_origin: parsed.origin,
      bridge_version: parsed.bridgeVersion,
      status: 'connected',
      last_seen_at: now,
    }, { onConflict: 'setup_link_id,target_origin' })
    .select('id,target_origin,bridge_version,status,last_seen_at')
    .single();
  if (error || !data) return NextResponse.json({ error: 'ACTIONBRIDGE_BRIDGE_HANDSHAKE_FAILED' }, { status: 409 });

  await (serviceSupabase as any)
    .from('actionbridge_setup_links')
    .update({ status: 'completed' })
    .eq('id', setupLink.id)
    .in('status', ['pending', 'opened']);

  await persistActionBridgeControlAuditEvent(serviceSupabase, {
    userId: setupLink.user_id,
    connectorId: setupLink.connector_id || null,
    eventName: 'bridge.handshake.connected',
    input: { setupLinkId: setupLink.id, targetOrigin: parsed.origin, bridgeVersion: parsed.bridgeVersion },
    status: 'succeeded',
    resultSummary: { bridgeInstallationId: data.id, setupLinkStatus: 'completed', mode: 'connected_only' },
  });

  return NextResponse.json({
    bridge: {
      id: data.id,
      origin: data.target_origin,
      version: data.bridge_version,
      status: data.status,
      lastSeenAt: data.last_seen_at,
      mode: 'connected_only',
    },
  }, {
    headers: createActionBridgeRateLimitHeaders({ policyName: 'bridgeHandshake', remaining: rateLimit.remaining, resetAt: rateLimit.resetAt }),
  });
}
