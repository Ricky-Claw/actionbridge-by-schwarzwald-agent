export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createCoreServiceClient } from '@/lib/core/service-client';
import { normalizeActionBridgeHandshakeOrigin, parseActionBridgeBridgeHandshake } from '@/lib/actionbridge/bridge-handshake';
import { verifyActionBridgeConnectorSetupTargetOriginBinding } from '@/lib/actionbridge/setup-links';
import { persistActionBridgeControlAuditEvent } from '@/lib/actionbridge/persistence';
import { createActionBridgeRateLimitHeaders, enforceActionBridgeRateLimitAsync } from '@/lib/actionbridge/rate-limit';

function getActionBridgeBridgeOriginHeader(request: NextRequest): string | null {
  return normalizeActionBridgeHandshakeOrigin(request.headers.get('origin') || '');
}

function createActionBridgeBridgeCorsHeaders(request: NextRequest): Record<string, string> {
  const origin = getActionBridgeBridgeOriginHeader(request);
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '300',
    Vary: 'Origin',
  };
}

function withActionBridgeBridgeCors(response: NextResponse, corsHeaders: Record<string, string>): NextResponse {
  for (const [key, value] of Object.entries(corsHeaders)) response.headers.set(key, value);
  return response;
}

function bridgeHandshakeJson(body: Record<string, unknown>, init: ResponseInit, corsHeaders: Record<string, string>) {
  return NextResponse.json(body, { ...init, headers: { ...corsHeaders, ...(init.headers || {}) } });
}

type BridgeHandshakeSetupLinkForAudit = {
  id: string;
  user_id: string;
  connector_id?: string | null;
  target_origin?: string | null;
  status?: string | null;
  expires_at?: string | null;
};

async function persistBridgeHandshakeDeniedAudit(
  serviceSupabase: any,
  setupLink: BridgeHandshakeSetupLinkForAudit,
  input: {
    reason: string;
    status?: 'denied' | 'failed';
    targetOrigin?: string;
    bridgeVersion?: string;
    connectorId?: string | null;
    resultSummary?: Record<string, unknown>;
  },
) {
  await persistActionBridgeControlAuditEvent(serviceSupabase, {
    userId: setupLink.user_id,
    connectorId: input.connectorId === undefined ? setupLink.connector_id || null : input.connectorId,
    eventName: 'bridge.handshake.denied',
    input: {
      setupLinkId: setupLink.id,
      targetOrigin: input.targetOrigin || setupLink.target_origin || null,
      bridgeVersion: input.bridgeVersion,
      setupLinkStatus: setupLink.status || null,
    },
    status: input.status || 'denied',
    resultSummary: {
      reason: input.reason,
      ...(input.resultSummary || {}),
    },
  });
}

export async function OPTIONS(request: NextRequest) {
  const corsHeaders = createActionBridgeBridgeCorsHeaders(request);
  if (!corsHeaders['Access-Control-Allow-Origin']) {
    return NextResponse.json({ error: 'INVALID_ACTIONBRIDGE_BRIDGE_ORIGIN' }, { status: 403 });
  }
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  const corsHeaders = createActionBridgeBridgeCorsHeaders(request);
  const originHeader = getActionBridgeBridgeOriginHeader(request);
  const rateLimit = await enforceActionBridgeRateLimitAsync({ request, policyName: 'bridgeHandshake' });
  if (!rateLimit.ok) return withActionBridgeBridgeCors(rateLimit.response!, corsHeaders);
  if (!originHeader) {
    return bridgeHandshakeJson({ error: 'INVALID_ACTIONBRIDGE_BRIDGE_ORIGIN' }, { status: 403 }, corsHeaders);
  }

  const body = await request.json().catch(() => ({}));
  const parsed = parseActionBridgeBridgeHandshake({
    token: body.token,
    origin: body.origin || originHeader,
    bridgeVersion: body.bridgeVersion,
  });
  if (!parsed || parsed.origin !== originHeader) {
    return bridgeHandshakeJson({ error: 'INVALID_ACTIONBRIDGE_BRIDGE_HANDSHAKE' }, { status: 400 }, corsHeaders);
  }

  const serviceSupabase = createCoreServiceClient();
  if (!serviceSupabase) return bridgeHandshakeJson({ error: 'ACTIONBRIDGE_BRIDGE_HANDSHAKE_UNAVAILABLE' }, { status: 503 }, corsHeaders);

  const { data: setupLink } = await (serviceSupabase as any)
    .from('actionbridge_setup_links')
    .select('id,user_id,connector_id,target_origin,status,expires_at')
    .eq('token_digest', parsed.tokenDigest)
    .maybeSingle();
  if (!setupLink) return bridgeHandshakeJson({ error: 'ACTIONBRIDGE_SETUP_LINK_NOT_FOUND' }, { status: 404 }, corsHeaders);
  if (setupLink.target_origin !== parsed.origin) {
    await persistBridgeHandshakeDeniedAudit(serviceSupabase, setupLink, {
      reason: 'ACTIONBRIDGE_BRIDGE_ORIGIN_MISMATCH',
      targetOrigin: parsed.origin,
      bridgeVersion: parsed.bridgeVersion,
      resultSummary: { expectedOrigin: setupLink.target_origin },
    });
    return bridgeHandshakeJson({ error: 'ACTIONBRIDGE_BRIDGE_ORIGIN_MISMATCH' }, { status: 403 }, corsHeaders);
  }
  if (!['pending', 'opened'].includes(setupLink.status) || new Date(setupLink.expires_at).getTime() < Date.now()) {
    await persistBridgeHandshakeDeniedAudit(serviceSupabase, setupLink, {
      reason: 'ACTIONBRIDGE_SETUP_LINK_EXPIRED_OR_REVOKED',
      targetOrigin: parsed.origin,
      bridgeVersion: parsed.bridgeVersion,
      resultSummary: { setupLinkStatus: setupLink.status, expiresAt: setupLink.expires_at },
    });
    return bridgeHandshakeJson({ error: 'ACTIONBRIDGE_SETUP_LINK_EXPIRED_OR_REVOKED' }, { status: 409 }, corsHeaders);
  }

  if (!setupLink.connector_id) {
    await persistBridgeHandshakeDeniedAudit(serviceSupabase, setupLink, {
      reason: 'ACTIONBRIDGE_BRIDGE_CONNECTOR_REQUIRED',
      targetOrigin: parsed.origin,
      bridgeVersion: parsed.bridgeVersion,
      connectorId: null,
    });
    return bridgeHandshakeJson({ error: 'ACTIONBRIDGE_BRIDGE_CONNECTOR_REQUIRED' }, { status: 409 }, corsHeaders);
  }

  const bindingStatus = await verifyActionBridgeConnectorSetupTargetOriginBinding(serviceSupabase as any, {
    userId: setupLink.user_id,
    connectorId: setupLink.connector_id,
    targetOrigin: setupLink.target_origin,
  });
  if (bindingStatus === 'connector_not_found') {
    await persistBridgeHandshakeDeniedAudit(serviceSupabase, setupLink, {
      reason: 'ACTIONBRIDGE_BRIDGE_CONNECTOR_BINDING_NOT_FOUND',
      targetOrigin: parsed.origin,
      bridgeVersion: parsed.bridgeVersion,
    });
    return bridgeHandshakeJson({ error: 'ACTIONBRIDGE_BRIDGE_CONNECTOR_BINDING_NOT_FOUND' }, { status: 409 }, corsHeaders);
  }
  if (bindingStatus !== 'matched') {
    await persistBridgeHandshakeDeniedAudit(serviceSupabase, setupLink, {
      reason: 'ACTIONBRIDGE_BRIDGE_CONNECTOR_ORIGIN_MISMATCH',
      targetOrigin: parsed.origin,
      bridgeVersion: parsed.bridgeVersion,
    });
    return bridgeHandshakeJson({ error: 'ACTIONBRIDGE_BRIDGE_CONNECTOR_ORIGIN_MISMATCH' }, { status: 409 }, corsHeaders);
  }

  const { data: connector, error: connectorError } = await (serviceSupabase as any)
    .from('actionbridge_connectors')
    .select('id,enabled,safety_status,permission_status')
    .eq('user_id', setupLink.user_id)
    .eq('id', setupLink.connector_id)
    .maybeSingle();
  if (connectorError || !connector) {
    await persistBridgeHandshakeDeniedAudit(serviceSupabase, setupLink, {
      reason: 'ACTIONBRIDGE_BRIDGE_CONNECTOR_BINDING_NOT_FOUND',
      status: connectorError ? 'failed' : 'denied',
      targetOrigin: parsed.origin,
      bridgeVersion: parsed.bridgeVersion,
      resultSummary: { lookupError: connectorError?.message || null },
    });
    return bridgeHandshakeJson({ error: 'ACTIONBRIDGE_BRIDGE_CONNECTOR_BINDING_NOT_FOUND' }, { status: 409 }, corsHeaders);
  }
  if (!connector.enabled || connector.safety_status !== 'pass' || connector.permission_status !== 'active') {
    await persistBridgeHandshakeDeniedAudit(serviceSupabase, setupLink, {
      reason: 'ACTIONBRIDGE_BRIDGE_REQUIRES_VERIFIED_ACTIVE_CONNECTOR',
      targetOrigin: parsed.origin,
      bridgeVersion: parsed.bridgeVersion,
    });
    return bridgeHandshakeJson({ error: 'ACTIONBRIDGE_BRIDGE_REQUIRES_VERIFIED_ACTIVE_CONNECTOR' }, { status: 409 }, corsHeaders);
  }

  const { data: enabledCapabilityRules, error: capabilityRulesError } = await (serviceSupabase as any)
    .from('actionbridge_capability_rules')
    .select('name,enabled')
    .eq('user_id', setupLink.user_id)
    .eq('connector_id', setupLink.connector_id)
    .eq('enabled', true)
    .limit(20);
  if (capabilityRulesError) return bridgeHandshakeJson({ error: 'ACTIONBRIDGE_BRIDGE_CAPABILITY_LOOKUP_FAILED' }, { status: 503 }, corsHeaders);
  if (!Array.isArray(enabledCapabilityRules) || enabledCapabilityRules.length < 1) {
    await persistBridgeHandshakeDeniedAudit(serviceSupabase, setupLink, {
      reason: 'ACTIONBRIDGE_BRIDGE_REQUIRES_SAVED_CAPABILITIES',
      targetOrigin: parsed.origin,
      bridgeVersion: parsed.bridgeVersion,
    });
    return bridgeHandshakeJson({ error: 'ACTIONBRIDGE_BRIDGE_REQUIRES_SAVED_CAPABILITIES' }, { status: 409 }, corsHeaders);
  }

  const now = new Date().toISOString();
  const { data: existingInstallation } = await (serviceSupabase as any)
    .from('actionbridge_bridge_installations')
    .select('id,status')
    .eq('setup_link_id', setupLink.id)
    .eq('target_origin', parsed.origin)
    .maybeSingle();
  if (existingInstallation?.status === 'revoked') {
    await persistBridgeHandshakeDeniedAudit(serviceSupabase, setupLink, {
      reason: 'ACTIONBRIDGE_BRIDGE_INSTALLATION_REVOKED',
      targetOrigin: parsed.origin,
      bridgeVersion: parsed.bridgeVersion,
      resultSummary: { bridgeInstallationId: existingInstallation.id },
    });
    return bridgeHandshakeJson({ error: 'ACTIONBRIDGE_BRIDGE_INSTALLATION_REVOKED' }, { status: 409 }, corsHeaders);
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
  if (error || !data) return bridgeHandshakeJson({ error: 'ACTIONBRIDGE_BRIDGE_HANDSHAKE_FAILED' }, { status: 409 }, corsHeaders);

  const { data: completedSetupLink, error: closeError } = await (serviceSupabase as any)
    .from('actionbridge_setup_links')
    .update({ status: 'completed' })
    .eq('id', setupLink.id)
    .eq('user_id', setupLink.user_id)
    .in('status', ['pending', 'opened'])
    .select('id,status')
    .maybeSingle();
  if (closeError || completedSetupLink?.status !== 'completed') {
    await (serviceSupabase as any)
      .from('actionbridge_bridge_installations')
      .update({ status: 'stale', last_seen_at: now })
      .eq('id', data.id)
      .eq('user_id', setupLink.user_id);
    await persistBridgeHandshakeDeniedAudit(serviceSupabase, setupLink, {
      reason: 'ACTIONBRIDGE_SETUP_LINK_CLOSE_FAILED',
      status: closeError ? 'failed' : 'denied',
      targetOrigin: parsed.origin,
      bridgeVersion: parsed.bridgeVersion,
      resultSummary: {
        bridgeInstallationId: data.id,
        closeError: closeError?.message || null,
        closeReturnedStatus: completedSetupLink?.status || null,
      },
    });
    return bridgeHandshakeJson({ error: 'ACTIONBRIDGE_SETUP_LINK_CLOSE_FAILED' }, { status: 409 }, corsHeaders);
  }

  await persistActionBridgeControlAuditEvent(serviceSupabase, {
    userId: setupLink.user_id,
    connectorId: setupLink.connector_id || null,
    eventName: 'bridge.handshake.connected',
    input: { setupLinkId: setupLink.id, targetOrigin: parsed.origin, bridgeVersion: parsed.bridgeVersion },
    status: 'succeeded',
    resultSummary: { bridgeInstallationId: data.id, setupLinkStatus: 'completed', mode: 'connected_only' },
  });

  return bridgeHandshakeJson({
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
  }, corsHeaders);
}
