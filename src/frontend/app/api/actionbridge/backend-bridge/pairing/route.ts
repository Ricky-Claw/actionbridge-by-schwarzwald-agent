export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createCoreServiceClient } from '@/lib/core/service-client';
import { persistActionBridgeControlAuditEvent } from '@/lib/actionbridge/persistence';
import {
  createActionBridgeBackendBridgePairingDraft,
  createActionBridgeBackendBridgeSecretRef,
  createActionBridgeBackendBridgeSharedSecret,
  digestActionBridgeBackendBridgePairingCode,
  digestActionBridgeBackendBridgeSharedSecret,
  sanitizeActionBridgeBackendBridgePluginInfo,
} from '@/lib/actionbridge/backend-bridge-pairing';
import { redactActionBridgeValue } from '@/lib/actionbridge/redaction';
import { enforceActionBridgeRateLimit } from '@/lib/actionbridge/rate-limit';

async function requireActionBridgeUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { supabase, user: null, response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
  return { supabase, user, response: null };
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireActionBridgeUser();
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const connectorId = typeof body.connectorId === 'string' ? body.connectorId.trim() : typeof body.connector_id === 'string' ? body.connector_id.trim() : '';
  if (!connectorId) return NextResponse.json({ error: 'INVALID_ACTIONBRIDGE_BACKEND_BRIDGE_PAIRING' }, { status: 400 });

  const serviceSupabase = createCoreServiceClient();
  if (!serviceSupabase) return NextResponse.json({ error: 'ACTIONBRIDGE_BACKEND_BRIDGE_PAIRING_UNAVAILABLE' }, { status: 503 });

  const { data: connector } = await (serviceSupabase as any)
    .from('actionbridge_connectors')
    .select('id,type')
    .eq('user_id', user!.id)
    .eq('id', connectorId)
    .eq('type', 'backend_bridge')
    .maybeSingle();
  if (!connector) return NextResponse.json({ error: 'ACTIONBRIDGE_BACKEND_BRIDGE_CONNECTOR_NOT_FOUND' }, { status: 404 });

  const draft = createActionBridgeBackendBridgePairingDraft({ connectorId });
  const { data, error } = await (serviceSupabase as any)
    .from('actionbridge_backend_bridge_pairings')
    .insert({
      user_id: user!.id,
      connector_id: connectorId,
      code_digest: draft.codeDigest,
      status: 'pending',
      expires_at: draft.expiresAt,
    })
    .select('id, connector_id, status, expires_at, created_at')
    .single();

  if (error || !data) return NextResponse.json({ error: 'ACTIONBRIDGE_BACKEND_BRIDGE_PAIRING_CREATE_FAILED' }, { status: 409 });

  await persistActionBridgeControlAuditEvent(serviceSupabase, {
    userId: user!.id,
    connectorId,
    eventName: 'backend_bridge.pairing_created',
    input: { connectorId, expiresAt: draft.expiresAt },
    status: 'succeeded',
    resultSummary: { pairingId: data.id, connectorId, status: data.status, codeReturnedOnce: true, redacted: true },
  });

  return NextResponse.json({
    pairing: {
      id: data.id,
      connectorId: data.connector_id,
      status: data.status,
      expiresAt: data.expires_at,
      code: draft.code,
      warning: 'PAIRING_CODE_SHOWN_ONCE_STORE_ONLY_IN_CUSTOMER_ADMIN_PLUGIN',
    },
  }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!code) return NextResponse.json({ error: 'INVALID_ACTIONBRIDGE_BACKEND_BRIDGE_PAIRING_EXCHANGE' }, { status: 400 });

  const rateLimit = enforceActionBridgeRateLimit({ request, policyName: 'backendBridgePairing', discriminator: code.slice(0, 16) });
  if (!rateLimit.allowed) return NextResponse.json({ error: 'ACTIONBRIDGE_RATE_LIMITED' }, { status: 429, headers: rateLimit.headers });

  const serviceSupabase = createCoreServiceClient();
  if (!serviceSupabase) return NextResponse.json({ error: 'ACTIONBRIDGE_BACKEND_BRIDGE_PAIRING_UNAVAILABLE' }, { status: 503 });

  const codeDigest = digestActionBridgeBackendBridgePairingCode(code);
  const now = new Date().toISOString();
  const pluginInfo = sanitizeActionBridgeBackendBridgePluginInfo(body.pluginInfo ?? body.plugin_info);

  const { data: pairing } = await (serviceSupabase as any)
    .from('actionbridge_backend_bridge_pairings')
    .select('id,user_id,connector_id,status,expires_at')
    .eq('code_digest', codeDigest)
    .eq('status', 'pending')
    .gt('expires_at', now)
    .maybeSingle();

  if (!pairing) return NextResponse.json({ error: 'ACTIONBRIDGE_BACKEND_BRIDGE_PAIRING_NOT_FOUND' }, { status: 404 });

  const secretRef = createActionBridgeBackendBridgeSecretRef({ connectorId: pairing.connector_id, pairingId: pairing.id });
  const sharedSecret = createActionBridgeBackendBridgeSharedSecret();
  const sharedSecretDigest = digestActionBridgeBackendBridgeSharedSecret(sharedSecret);

  const { data, error } = await (serviceSupabase as any)
    .from('actionbridge_backend_bridge_pairings')
    .update({
      status: 'consumed',
      secret_ref: secretRef,
      shared_secret_digest: sharedSecretDigest,
      redacted_plugin_info: redactActionBridgeValue(pluginInfo),
      consumed_at: now,
      updated_at: now,
    })
    .eq('id', pairing.id)
    .eq('status', 'pending')
    .select('id,user_id,connector_id,status,secret_ref,consumed_at')
    .single();

  if (error || !data) return NextResponse.json({ error: 'ACTIONBRIDGE_BACKEND_BRIDGE_PAIRING_CONSUME_FAILED' }, { status: 409 });

  await (serviceSupabase as any)
    .from('actionbridge_connectors')
    .update({
      secret_ref: secretRef,
      safety_status: 'untested',
      permission_status: 'draft',
      updated_at: now,
    })
    .eq('user_id', data.user_id)
    .eq('id', data.connector_id)
    .eq('type', 'backend_bridge');

  await persistActionBridgeControlAuditEvent(serviceSupabase, {
    userId: data.user_id,
    connectorId: data.connector_id,
    eventName: 'backend_bridge.pairing_consumed',
    input: { pairingId: data.id, pluginInfo: redactActionBridgeValue(pluginInfo) },
    status: 'succeeded',
    resultSummary: { pairingId: data.id, connectorId: data.connector_id, status: data.status, secretRef, sharedSecretReturnedOnce: true, redacted: true },
  });

  return NextResponse.json({
    pairing: {
      id: data.id,
      connectorId: data.connector_id,
      status: data.status,
      secretRef,
      sharedSecret,
      warning: 'SHARED_SECRET_RETURNED_ONCE_STORE_SERVER_SIDE_ONLY',
    },
  });
}
