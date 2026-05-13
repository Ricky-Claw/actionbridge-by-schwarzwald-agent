export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createCoreServiceClient } from '@/lib/core/service-client';
import { redactActionBridgeValue } from '@/lib/actionbridge/redaction';
import {
  createActionBridgeVerificationChallenge,
  digestActionBridgeVerificationToken,
  verifyActionBridgeDomainChallenge,
  type ActionBridgeVerificationMethod,
} from '@/lib/actionbridge/domain-verification';

const METHODS = new Set<ActionBridgeVerificationMethod>(['human_attestation', 'well_known', 'meta_tag', 'dns_txt']);

async function requireActionBridgeUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { supabase, user: null, response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
  }
  return { supabase, user, response: null };
}

export async function POST(request: NextRequest) {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  const connectorId = typeof body.connectorId === 'string' ? body.connectorId : '';
  const method = typeof body.method === 'string' && METHODS.has(body.method as ActionBridgeVerificationMethod)
    ? body.method as ActionBridgeVerificationMethod
    : null;
  if (!connectorId || !method) {
    return NextResponse.json({ error: 'INVALID_ACTIONBRIDGE_VERIFICATION_REQUEST', redactedInput: redactActionBridgeValue(body) }, { status: 400 });
  }

  const { data: connector } = await (supabase as any)
    .from('actionbridge_connectors')
    .select('id,user_id,base_url,allowed_origins')
    .eq('user_id', user!.id)
    .eq('id', connectorId)
    .maybeSingle();
  if (!connector) return NextResponse.json({ error: 'ACTIONBRIDGE_CONNECTOR_NOT_FOUND' }, { status: 404 });

  const origin = Array.isArray(connector.allowed_origins) && connector.allowed_origins[0]
    ? connector.allowed_origins[0]
    : new URL(connector.base_url).origin;
  const challenge = createActionBridgeVerificationChallenge({ origin, method });
  if (!challenge) return NextResponse.json({ error: 'INVALID_ACTIONBRIDGE_VERIFICATION_ORIGIN' }, { status: 400 });

  const serviceSupabase = createCoreServiceClient();
  if (!serviceSupabase) return NextResponse.json({ error: 'ACTIONBRIDGE_VERIFICATION_CREATE_FAILED' }, { status: 503 });

  const { data, error } = await (serviceSupabase as any)
    .from('actionbridge_connector_verifications')
    .upsert({
      user_id: user!.id,
      connector_id: connectorId,
      origin: challenge.origin,
      hostname: challenge.hostname,
      method,
      token_digest: challenge.tokenDigest,
      status: 'pending',
      challenge_path: challenge.challengePath || null,
      dns_record_name: challenge.dnsRecordName || null,
      evidence: { instructionsIssued: true },
      expires_at: challenge.expiresAt,
    }, { onConflict: 'connector_id,method,origin' })
    .select('id,status,origin,hostname,method,challenge_path,dns_record_name,expires_at')
    .single();

  if (error || !data) return NextResponse.json({ error: 'ACTIONBRIDGE_VERIFICATION_CREATE_FAILED' }, { status: 409 });

  return NextResponse.json({
    verification: {
      id: data.id,
      status: data.status,
      origin: data.origin,
      hostname: data.hostname,
      method: data.method,
      challengePath: data.challenge_path,
      dnsRecordName: data.dns_record_name,
      token: challenge.token,
      instructions: challenge.instructions,
      expiresAt: data.expires_at,
    },
  }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  const verificationId = typeof body.verificationId === 'string' ? body.verificationId : '';
  const token = typeof body.token === 'string' ? body.token : '';
  if (!verificationId || !token) return NextResponse.json({ error: 'INVALID_ACTIONBRIDGE_VERIFICATION_CHECK' }, { status: 400 });

  const { data: verification } = await (supabase as any)
    .from('actionbridge_connector_verifications')
    .select('id,user_id,connector_id,origin,method,token_digest,status,expires_at')
    .eq('user_id', user!.id)
    .eq('id', verificationId)
    .maybeSingle();
  if (!verification) return NextResponse.json({ error: 'ACTIONBRIDGE_VERIFICATION_NOT_FOUND' }, { status: 404 });
  if (verification.status === 'revoked' || new Date(verification.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_VERIFICATION_EXPIRED_OR_REVOKED' }, { status: 409 });
  }
  if (digestActionBridgeVerificationToken(token) !== verification.token_digest) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_VERIFICATION_TOKEN_MISMATCH' }, { status: 403 });
  }

  const result = await verifyActionBridgeDomainChallenge({ origin: verification.origin, method: verification.method, token });
  const serviceSupabase = createCoreServiceClient();
  if (!serviceSupabase) return NextResponse.json({ error: 'ACTIONBRIDGE_VERIFICATION_UPDATE_FAILED' }, { status: 503 });

  await (serviceSupabase as any)
    .from('actionbridge_connector_verifications')
    .update({
      status: result.status,
      evidence: redactActionBridgeValue(result.evidence),
      verified_at: result.ok ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user!.id)
    .eq('id', verificationId);

  if (result.ok) {
    const strongVerification = verification.method === 'well_known' || verification.method === 'meta_tag' || verification.method === 'dns_txt';
    await (serviceSupabase as any)
      .from('actionbridge_connectors')
      .update({
        safety_status: strongVerification ? 'pass' : 'untested',
        permission_status: 'active',
        network_execution_enabled: false,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user!.id)
      .eq('id', verification.connector_id);
  }

  return NextResponse.json({ verification: { id: verificationId, status: result.status, networkExecution: result.networkExecution, evidence: redactActionBridgeValue(result.evidence) } }, { status: result.ok ? 200 : 409 });
}
