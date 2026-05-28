export const dynamic = 'force-dynamic';

import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createCoreServiceClient } from '@/lib/core/service-client';
import { persistActionBridgeControlAuditEvent } from '@/lib/actionbridge/persistence';
import { enforceActionBridgeRateLimitAsync } from '@/lib/actionbridge/rate-limit';
import { probeActionBridgeSecretManagerLiveAccess } from '@/lib/actionbridge/webhook-signing';

const LIVE_PROBE_POLICY = 'sentinel.actionbridge.secret_manager.live_probe.v1';

function digestSecretRef(secretRef: string | null | undefined): string | null {
  if (!secretRef) return null;
  return `sha256:${crypto.createHash('sha256').update(secretRef).digest('hex').slice(0, 16)}`;
}

async function requireActionBridgeUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { supabase, user: null, response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
  }
  return { supabase, user, response: null };
}

function tryCreateServiceClient() {
  try {
    return createCoreServiceClient();
  } catch {
    return null;
  }
}

function parseConnectorId(bodyObject: Record<string, unknown>): string {
  const raw = typeof bodyObject.connectorId === 'string'
    ? bodyObject.connectorId
    : typeof bodyObject.connector_id === 'string'
      ? bodyObject.connector_id
      : '';
  return raw.trim();
}

export async function POST(request: NextRequest) {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const bodyObject = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const connectorId = parseConnectorId(bodyObject);
  const serviceSupabase = tryCreateServiceClient();

  if (!serviceSupabase) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_SECRET_MANAGER_PROBE_AUDIT_UNAVAILABLE' }, { status: 503 });
  }

  if (!connectorId) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_SECRET_MANAGER_PROBE_CONNECTOR_REQUIRED' }, { status: 400 });
  }

  const { data: connector } = await (supabase as any)
    .from('actionbridge_connectors')
    .select('id,user_id,type,webhook_signing_mode,secret_ref')
    .eq('user_id', user!.id)
    .eq('id', connectorId)
    .maybeSingle();

  if (!connector) return NextResponse.json({ error: 'ACTIONBRIDGE_CONNECTOR_NOT_FOUND' }, { status: 404 });
  if (connector.type !== 'webhook' || connector.webhook_signing_mode !== 'hmac_sha256' || !connector.secret_ref) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_SECRET_MANAGER_PROBE_REQUIRES_HMAC_WEBHOOK_CONNECTOR' }, { status: 409 });
  }

  const rateLimit = await enforceActionBridgeRateLimitAsync({
    request,
    policyName: 'secretManagerLiveProbe',
    discriminator: `${user!.id}|${connectorId}`,
  });
  if (!rateLimit.ok) return rateLimit.response || NextResponse.json({ error: 'ACTIONBRIDGE_SECRET_MANAGER_PROBE_RATE_LIMITED' }, { status: 429 });

  const probe = await probeActionBridgeSecretManagerLiveAccess({ secretRef: connector.secret_ref });
  const status = probe.ok ? 'succeeded' : 'failed';
  const resultSummary = {
    ...probe.resultSummary,
    connectorId,
    secretRefDigest: digestSecretRef(connector.secret_ref),
    sentinelPolicy: LIVE_PROBE_POLICY,
    redacted: true,
  };

  const audit = await persistActionBridgeControlAuditEvent(serviceSupabase, {
    userId: user!.id,
    connectorId,
    eventName: probe.ok ? 'secret_manager.live_probe_verified' : 'secret_manager.live_probe_failed',
    input: {
      connectorId,
      secretRefDigest: digestSecretRef(connector.secret_ref),
      sentinelPolicy: LIVE_PROBE_POLICY,
      rateLimitKeyDigest: rateLimit.keyDigest,
    },
    status,
    resultSummary: {
      ...resultSummary,
      rateLimitKeyDigest: rateLimit.keyDigest,
    },
  });

  if (audit.error) {
    return NextResponse.json({
      error: 'ACTIONBRIDGE_SECRET_MANAGER_PROBE_AUDIT_FAILED',
      resultSummary: {
        ...resultSummary,
        auditPersisted: false,
      },
    }, { status: 503 });
  }

  return NextResponse.json({
    ok: probe.ok,
    status,
    resultSummary: {
      ...resultSummary,
      auditPersisted: true,
    },
  }, { status: probe.ok ? 200 : 409 });
}
