export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createCoreServiceClient } from '@/lib/core/service-client';
import { parseActionBridgeBridgeHandshake } from '@/lib/actionbridge/bridge-handshake';

export async function POST(request: NextRequest) {
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
  if (setupLink.status === 'revoked' || setupLink.status === 'expired' || new Date(setupLink.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_LINK_EXPIRED_OR_REVOKED' }, { status: 409 });
  }

  const now = new Date().toISOString();
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
    .update({ status: 'opened' })
    .eq('id', setupLink.id)
    .in('status', ['pending', 'opened']);

  return NextResponse.json({
    bridge: {
      id: data.id,
      origin: data.target_origin,
      version: data.bridge_version,
      status: data.status,
      lastSeenAt: data.last_seen_at,
      mode: 'connected_only',
    },
  });
}
