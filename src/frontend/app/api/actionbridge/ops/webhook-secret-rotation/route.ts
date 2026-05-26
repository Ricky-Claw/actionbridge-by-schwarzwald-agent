export const dynamic = 'force-dynamic';

import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createCoreServiceClient } from '@/lib/core/service-client';
import { persistActionBridgeControlAuditEvent } from '@/lib/actionbridge/persistence';
import { redactActionBridgeValue } from '@/lib/actionbridge/redaction';
import { resolveActionBridgeWebhookSigningSecretAsync as resolveActionBridgeWebhookSigningSecret } from '@/lib/actionbridge/webhook-signing';

const SECRET_REF_PATTERN = /^actionbridge:webhook-signing:[a-zA-Z0-9._:-]{8,160}$/;
const ROTATION_POLICY = 'sentinel.actionbridge.webhook_signing_secret.rotate.v1';

function digestSecretRef(secretRef: string | null | undefined): string | null {
  if (!secretRef) return null;
  return `sha256:${crypto.createHash('sha256').update(secretRef).digest('hex').slice(0, 16)}`;
}

function normalizeSecretRef(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (!SECRET_REF_PATTERN.test(candidate)) return null;
  return candidate;
}

function parseExpectedCurrentDigest(bodyObject: Record<string, unknown>): { digest: string | null; invalid: boolean } {
  const raw = typeof bodyObject.expectedCurrentDigest === 'string'
    ? bodyObject.expectedCurrentDigest.trim().toLowerCase()
    : typeof bodyObject.expected_current_digest === 'string'
      ? bodyObject.expected_current_digest.trim().toLowerCase()
      : '';
  if (!raw) return { digest: null, invalid: false };
  if (!/^sha256:[a-f0-9]{16}$/.test(raw)) return { digest: null, invalid: true };
  return { digest: raw, invalid: false };
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
    return { serviceSupabase: createCoreServiceClient(), error: null as string | null };
  } catch (error) {
    return { serviceSupabase: null, error: error instanceof Error ? error.message : 'service client unavailable' };
  }
}

async function auditRotationAttempt(
  serviceSupabase: ReturnType<typeof createCoreServiceClient> | null,
  input: {
    userId: string;
    connectorId?: string | null;
    eventName: string;
    status: 'pending' | 'succeeded' | 'failed' | 'denied';
    requestInput?: unknown;
    resultSummary?: Record<string, unknown> | null;
  }
) {
  if (!serviceSupabase) return;
  await persistActionBridgeControlAuditEvent(serviceSupabase, {
    userId: input.userId,
    connectorId: input.connectorId || null,
    eventName: input.eventName,
    input: input.requestInput || {},
    status: input.status,
    resultSummary: {
      ...(input.resultSummary || {}),
      sentinelPolicy: ROTATION_POLICY,
    },
  });
}

export async function POST(request: NextRequest) {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const bodyObject = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const connectorId = typeof bodyObject.connectorId === 'string'
    ? bodyObject.connectorId.trim()
    : typeof bodyObject.connector_id === 'string'
      ? bodyObject.connector_id.trim()
      : '';
  const nextSecretRef = normalizeSecretRef(bodyObject.nextSecretRef ?? bodyObject.next_secret_ref);
  const expectedDigestInput = parseExpectedCurrentDigest(bodyObject);
  const expectedCurrentDigest = expectedDigestInput.digest;
  const dryRun = bodyObject.dryRun !== false && bodyObject.dry_run !== false;
  const applyConfirmed = request.headers.get('x-actionbridge-rotation-confirm') === 'apply-webhook-signing-ref';
  const { serviceSupabase, error: serviceClientError } = tryCreateServiceClient();

  const redactedRequestInput = {
    connectorId: connectorId || null,
    nextSecretRefDigest: nextSecretRef ? digestSecretRef(nextSecretRef) : null,
    expectedCurrentDigest,
    dryRun,
    sentinelPolicy: ROTATION_POLICY,
  };

  if (!connectorId || !nextSecretRef || expectedDigestInput.invalid) {
    await auditRotationAttempt(serviceSupabase, {
      userId: user!.id,
      connectorId: connectorId || null,
      eventName: 'webhook_signing_secret.rotation_denied',
      status: 'denied',
      requestInput: { ...redactedRequestInput, expectedCurrentDigest: null, expectedCurrentDigestInvalid: expectedDigestInput.invalid },
      resultSummary: { error: 'INVALID_ACTIONBRIDGE_WEBHOOK_SECRET_ROTATION', expectedCurrentDigestInvalid: expectedDigestInput.invalid, serviceAuditAvailable: Boolean(serviceSupabase) },
    });
    return NextResponse.json({
      error: 'INVALID_ACTIONBRIDGE_WEBHOOK_SECRET_ROTATION',
      expectedCurrentDigestInvalid: expectedDigestInput.invalid || undefined,
      redactedInput: redactActionBridgeValue({ ...bodyObject, expectedCurrentDigest: undefined, expected_current_digest: undefined }),
    }, { status: 400 });
  }

  const { data: connector } = await (supabase as any)
    .from('actionbridge_connectors')
    .select('id,user_id,type,webhook_signing_mode,secret_ref,network_execution_enabled,safety_status,permission_status')
    .eq('user_id', user!.id)
    .eq('id', connectorId)
    .maybeSingle();

  if (!connector) return NextResponse.json({ error: 'ACTIONBRIDGE_CONNECTOR_NOT_FOUND' }, { status: 404 });
  if (connector.type !== 'webhook') {
    await auditRotationAttempt(serviceSupabase, {
      userId: user!.id,
      connectorId,
      eventName: 'webhook_signing_secret.rotation_denied',
      status: 'denied',
      requestInput: redactedRequestInput,
      resultSummary: { error: 'ACTIONBRIDGE_ROTATION_REQUIRES_WEBHOOK_CONNECTOR' },
    });
    return NextResponse.json({ error: 'ACTIONBRIDGE_ROTATION_REQUIRES_WEBHOOK_CONNECTOR' }, { status: 409 });
  }

  const currentDigest = digestSecretRef(connector.secret_ref);
  const nextDigest = digestSecretRef(nextSecretRef);
  if (expectedCurrentDigest && expectedCurrentDigest !== currentDigest) {
    const resultSummary = { connectorId, currentSecretRefDigest: currentDigest, expectedCurrentDigest, sentinelPolicy: ROTATION_POLICY };
    await auditRotationAttempt(serviceSupabase, {
      userId: user!.id,
      connectorId,
      eventName: 'webhook_signing_secret.rotation_denied',
      status: 'denied',
      requestInput: redactedRequestInput,
      resultSummary,
    });
    return NextResponse.json({
      error: 'ACTIONBRIDGE_WEBHOOK_ROTATION_CURRENT_DIGEST_MISMATCH',
      currentSecretRefDigest: currentDigest,
      expectedCurrentDigest,
    }, { status: 409 });
  }

  const signingResolution = await resolveActionBridgeWebhookSigningSecret({
    connectorId,
    signingMode: 'hmac_sha256',
    secretRef: nextSecretRef,
  });
  if (!signingResolution.ok) {
    await auditRotationAttempt(serviceSupabase, {
      userId: user!.id,
      connectorId,
      eventName: 'webhook_signing_secret.rotation_failed',
      status: 'failed',
      requestInput: redactedRequestInput,
      resultSummary: { error: 'ACTIONBRIDGE_WEBHOOK_ROTATION_SECRET_UNRESOLVED', resultSummary: signingResolution.resultSummary },
    });
    return NextResponse.json({
      error: 'ACTIONBRIDGE_WEBHOOK_ROTATION_SECRET_UNRESOLVED',
      resultSummary: signingResolution.resultSummary,
    }, { status: 409 });
  }

  const resultSummary = {
    connectorId,
    dryRun,
    currentSecretRefDigest: currentDigest,
    nextSecretRefDigest: nextDigest,
    signingMode: 'hmac_sha256',
    sentinelPolicy: ROTATION_POLICY,
    rollback: 'rerun_with_previous_server_owned_ref_after_receiver_old_secret_is_available',
    monitoring: ['smoke_delivery_required', 'watch_unresolved_ref_and_signature_failure_alerts'],
  };

  if (dryRun) {
    await auditRotationAttempt(serviceSupabase, {
      userId: user!.id,
      connectorId,
      eventName: 'webhook_signing_secret.rotation_dry_run',
      status: 'succeeded',
      requestInput: redactedRequestInput,
      resultSummary,
    });
    return NextResponse.json({ status: 'dry_run', resultSummary });
  }
  if (!applyConfirmed) {
    await auditRotationAttempt(serviceSupabase, {
      userId: user!.id,
      connectorId,
      eventName: 'webhook_signing_secret.rotation_denied',
      status: 'denied',
      requestInput: redactedRequestInput,
      resultSummary: { ...resultSummary, error: 'ACTIONBRIDGE_WEBHOOK_ROTATION_CONFIRMATION_REQUIRED' },
    });
    return NextResponse.json({ error: 'ACTIONBRIDGE_WEBHOOK_ROTATION_CONFIRMATION_REQUIRED', resultSummary }, { status: 428 });
  }

  if (!serviceSupabase) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_WEBHOOK_ROTATION_FAILED', detail: 'service_client_unavailable', auditAvailable: false, serviceClientError: serviceClientError ? 'redacted' : undefined }, { status: 503 });
  }

  let updateQuery = (serviceSupabase as any)
    .from('actionbridge_connectors')
    .update({
      webhook_signing_mode: 'hmac_sha256',
      secret_ref: nextSecretRef,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user!.id)
    .eq('id', connectorId);

  if (expectedCurrentDigest) {
    updateQuery = connector.secret_ref === null || connector.secret_ref === undefined
      ? updateQuery.is('secret_ref', null)
      : updateQuery.eq('secret_ref', connector.secret_ref);
  }

  const { data, error } = await updateQuery
    .select('id,user_id,type,webhook_signing_mode,updated_at')
    .maybeSingle();

  if (error || !data) {
    const failedBecauseStalePrecondition = Boolean(expectedCurrentDigest && !data);
    await auditRotationAttempt(serviceSupabase, {
      userId: user!.id,
      connectorId,
      eventName: failedBecauseStalePrecondition ? 'webhook_signing_secret.rotation_denied' : 'webhook_signing_secret.rotation_failed',
      status: failedBecauseStalePrecondition ? 'denied' : 'failed',
      requestInput: redactedRequestInput,
      resultSummary: {
        ...resultSummary,
        error: failedBecauseStalePrecondition ? 'ACTIONBRIDGE_WEBHOOK_ROTATION_CURRENT_DIGEST_MISMATCH' : 'ACTIONBRIDGE_WEBHOOK_ROTATION_FAILED',
      },
    });
    return NextResponse.json({ error: failedBecauseStalePrecondition ? 'ACTIONBRIDGE_WEBHOOK_ROTATION_CURRENT_DIGEST_MISMATCH' : 'ACTIONBRIDGE_WEBHOOK_ROTATION_FAILED' }, { status: 409 });
  }

  await auditRotationAttempt(serviceSupabase, {
    userId: user!.id,
    connectorId,
    eventName: 'webhook_signing_secret.rotated',
    status: 'succeeded',
    requestInput: { connectorId, expectedCurrentDigest, nextSecretRefDigest: nextDigest, dryRun: false, sentinelPolicy: ROTATION_POLICY },
    resultSummary,
  });

  return NextResponse.json({
    status: 'applied',
    connector: {
      id: data.id,
      tenantId: data.user_id,
      type: data.type,
      webhookSigningMode: data.webhook_signing_mode,
      updatedAt: data.updated_at,
    },
    resultSummary,
  });
}
