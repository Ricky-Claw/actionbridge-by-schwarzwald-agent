export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createCoreServiceClient } from '@/lib/core/service-client';
import { persistActionBridgeControlAuditEvent } from '@/lib/actionbridge/persistence';
import { redactActionBridgeValue } from '@/lib/actionbridge/redaction';
import { enforceActionBridgeRateLimit } from '@/lib/actionbridge/rate-limit';
import {
  digestActionBridgeBackendBridgeHealthNonce,
  sanitizeActionBridgeBackendBridgeHealth,
  verifyActionBridgeBackendBridgeHealthSignature,
} from '@/lib/actionbridge/backend-bridge-pairing';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const connectorId = typeof body.connectorId === 'string' ? body.connectorId.trim() : typeof body.connector_id === 'string' ? body.connector_id.trim() : '';
  const timestamp = typeof body.timestamp === 'string' ? body.timestamp.trim() : '';
  const nonce = typeof body.nonce === 'string' ? body.nonce.trim() : '';
  const signature = typeof body.signature === 'string' ? body.signature.trim() : '';
  const health = sanitizeActionBridgeBackendBridgeHealth(body.health);

  if (!connectorId || !timestamp || !nonce || !signature) {
    return NextResponse.json({ error: 'INVALID_ACTIONBRIDGE_BACKEND_BRIDGE_HEALTH' }, { status: 400 });
  }

  const rateLimit = enforceActionBridgeRateLimit({ request, policyName: 'backendBridgePairing', discriminator: `${connectorId}:${nonce.slice(0, 16)}` });
  if (!rateLimit.ok) return rateLimit.response || NextResponse.json({ error: 'ACTIONBRIDGE_RATE_LIMITED' }, { status: 429 });

  const serviceSupabase = createCoreServiceClient();
  if (!serviceSupabase) return NextResponse.json({ error: 'ACTIONBRIDGE_BACKEND_BRIDGE_HEALTH_UNAVAILABLE' }, { status: 503 });

  const { data: pairing, error: pairingError } = await (serviceSupabase as any)
    .from('actionbridge_backend_bridge_pairings')
    .select('id,user_id,connector_id,status,secret_ref,shared_secret_digest')
    .eq('connector_id', connectorId)
    .eq('status', 'consumed')
    .order('consumed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pairingError || !pairing || !pairing.shared_secret_digest) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_BACKEND_BRIDGE_HEALTH_PAIRING_NOT_FOUND' }, { status: 404 });
  }

  const verification = verifyActionBridgeBackendBridgeHealthSignature({
    sharedSecretDigest: pairing.shared_secret_digest,
    connectorId,
    timestamp,
    nonce,
    health,
    signature,
  });
  if (!verification.ok) return NextResponse.json({ error: verification.error }, { status: 401 });
  if (verification.health.ok !== true || verification.health.writesEnabled === true) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_BACKEND_BRIDGE_HEALTH_UNSAFE' }, { status: 422 });
  }

  const now = new Date();
  const nonceDigest = digestActionBridgeBackendBridgeHealthNonce({ connectorId, nonce });
  const { error: nonceError } = await (serviceSupabase as any)
    .from('actionbridge_backend_bridge_health_nonces')
    .insert({
      user_id: pairing.user_id,
      connector_id: connectorId,
      nonce_digest: nonceDigest,
      expires_at: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    });
  if (nonceError) return NextResponse.json({ error: 'ACTIONBRIDGE_BACKEND_BRIDGE_HEALTH_REPLAY_BLOCKED' }, { status: 409 });

  const { data: connector, error: connectorError } = await (serviceSupabase as any)
    .from('actionbridge_connectors')
    .update({
      safety_status: 'pass',
      permission_status: 'draft',
      network_execution_enabled: false,
      updated_at: now.toISOString(),
    })
    .eq('user_id', pairing.user_id)
    .eq('id', connectorId)
    .eq('type', 'backend_bridge')
    .select('id,user_id,type,safety_status,permission_status,network_execution_enabled,updated_at')
    .single();

  if (connectorError || !connector) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_BACKEND_BRIDGE_HEALTH_CONNECTOR_UPDATE_FAILED' }, { status: 409 });
  }

  await persistActionBridgeControlAuditEvent(serviceSupabase, {
    userId: pairing.user_id,
    connectorId,
    eventName: 'backend_bridge.health_verified',
    input: { connectorId, health: redactActionBridgeValue(verification.health) },
    status: 'succeeded',
    resultSummary: {
      connectorId,
      safetyStatus: connector.safety_status,
      permissionStatus: connector.permission_status,
      networkExecutionEnabled: connector.network_execution_enabled === true,
      health: redactActionBridgeValue(verification.health),
      redacted: true,
    },
  });

  return NextResponse.json({
    connector: {
      id: connector.id,
      type: connector.type,
      safetyStatus: connector.safety_status,
      permissionStatus: connector.permission_status,
      networkExecutionEnabled: connector.network_execution_enabled === true,
      health: verification.health,
    },
  });
}
