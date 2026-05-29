export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createCoreServiceClient } from '@/lib/core/service-client';
import {
  createActionBridgeVerificationChallenge,
  digestActionBridgeVerificationToken,
  verifyActionBridgeDomainChallenge,
  type ActionBridgeVerificationMethod,
  type ActionBridgeVerificationStatus,
} from '@/lib/actionbridge/domain-verification';
import { persistActionBridgeControlAuditEvent } from '@/lib/actionbridge/persistence';
import { createActionBridgeRateLimitHeaders, enforceActionBridgeRateLimitAsync } from '@/lib/actionbridge/rate-limit';
import { redactActionBridgeValue } from '@/lib/actionbridge/redaction';
import { digestActionBridgeSetupSessionToken, isActionBridgeSetupSessionUsable } from '@/lib/actionbridge/setup-session';
import { verifyActionBridgeConnectorSetupTargetOriginBinding } from '@/lib/actionbridge/setup-links';
import { getActiveActionBridgeConnectorQuarantine } from '@/lib/actionbridge/webhook-quarantine';

const METHODS = new Set<ActionBridgeVerificationMethod>(['well_known', 'meta_tag', 'dns_txt']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SetupVerificationBody = Record<string, unknown>;

type SetupLinkRecord = {
  id: string;
  user_id: string;
  connector_id: string | null;
  target_origin: string;
  status: 'pending' | 'opened' | 'completed' | 'revoked' | 'expired';
  allowed_methods: string[] | null;
  expires_at: string;
};

type SetupConnectorState = {
  id: string;
  enabled: boolean;
  permission_status: 'draft' | 'active' | 'paused' | 'revoked' | string;
  safety_status: 'untested' | 'pass' | 'fail' | string;
};

function getSetupToken(body: SetupVerificationBody): string {
  const value = typeof body.setupToken === 'string'
    ? body.setupToken
    : typeof body.setup_token === 'string'
      ? body.setup_token
      : '';
  return value.trim();
}

function getVerificationToken(body: SetupVerificationBody): string {
  const value = typeof body.verificationToken === 'string'
    ? body.verificationToken
    : typeof body.verification_token === 'string'
      ? body.verification_token
      : '';
  return value.trim();
}

function getVerificationMethod(body: SetupVerificationBody, allowedMethods: string[] | null | undefined): ActionBridgeVerificationMethod | null {
  const candidate = typeof body.method === 'string' ? body.method.trim() as ActionBridgeVerificationMethod : null;
  if (!candidate || !METHODS.has(candidate)) return null;
  const allowed = Array.isArray(allowedMethods) && allowedMethods.length ? allowedMethods : ['meta_tag', 'dns_txt', 'well_known'];
  return allowed.includes(candidate) ? candidate : null;
}

function isValidSetupToken(token: string): boolean {
  return token.startsWith('absl_') && token.length >= 12 && token.length <= 160;
}

function isValidVerificationToken(token: string): boolean {
  return token.startsWith('abv_') && token.length >= 12 && token.length <= 160;
}

async function enforceSetupVerificationRateLimit(request: NextRequest, setupToken: string) {
  const clientLimit = await enforceActionBridgeRateLimitAsync({ request, policyName: 'domainVerification', discriminator: 'setup-session-verification-client' });
  if (!clientLimit.ok) return clientLimit;
  const discriminator = isValidSetupToken(setupToken)
    ? digestActionBridgeSetupSessionToken(setupToken).slice(0, 48)
    : 'invalid_setup_session_token';
  return enforceActionBridgeRateLimitAsync({ request, policyName: 'domainVerification', discriminator });
}

async function loadSetupLink(serviceSupabase: any, setupToken: string): Promise<{ setupLink: SetupLinkRecord | null; failed: boolean }> {
  const tokenDigest = digestActionBridgeSetupSessionToken(setupToken);
  const { data, error } = await serviceSupabase
    .from('actionbridge_setup_links')
    .select('id,user_id,connector_id,target_origin,status,allowed_methods,expires_at')
    .eq('token_digest', tokenDigest)
    .maybeSingle();
  if (error) return { setupLink: null, failed: true };
  return { setupLink: data as SetupLinkRecord | null, failed: false };
}

async function loadSetupConnectorState(serviceSupabase: any, setupLink: SetupLinkRecord): Promise<{ connector: SetupConnectorState | null; failed: boolean }> {
  if (!setupLink.connector_id) return { connector: null, failed: false };
  const { data, error } = await serviceSupabase
    .from('actionbridge_connectors')
    .select('id,enabled,permission_status,safety_status')
    .eq('user_id', setupLink.user_id)
    .eq('id', setupLink.connector_id)
    .maybeSingle();
  if (error) return { connector: null, failed: true };
  return { connector: data as SetupConnectorState | null, failed: false };
}

async function denyInactiveSetupConnector(serviceSupabase: any, setupLink: SetupLinkRecord, reason: string, headers?: Record<string, string>) {
  await persistActionBridgeControlAuditEvent(serviceSupabase, {
    userId: setupLink.user_id,
    connectorId: setupLink.connector_id,
    eventName: 'setup_verification.denied',
    input: { setupLinkId: setupLink.id, targetOrigin: setupLink.target_origin },
    status: 'denied',
    resultSummary: { reason },
  });
  return NextResponse.json({ error: reason }, { status: 409, headers });
}

async function validateSetupLinkBinding(serviceSupabase: any, setupLink: SetupLinkRecord, headers?: Record<string, string>) {
  if (!isActionBridgeSetupSessionUsable(setupLink)) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_SESSION_EXPIRED_OR_CLOSED' }, { status: 409, headers });
  }
  if (!setupLink.connector_id) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_VERIFICATION_CONNECTOR_REQUIRED' }, { status: 409, headers });
  }

  const bindingStatus = await verifyActionBridgeConnectorSetupTargetOriginBinding(serviceSupabase, {
    userId: setupLink.user_id,
    connectorId: setupLink.connector_id,
    targetOrigin: setupLink.target_origin,
  });
  if (bindingStatus === 'connector_not_found') {
    return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_VERIFICATION_CONNECTOR_NOT_FOUND' }, { status: 409, headers });
  }
  if (bindingStatus !== 'matched') {
    await persistActionBridgeControlAuditEvent(serviceSupabase, {
      userId: setupLink.user_id,
      connectorId: setupLink.connector_id,
      eventName: 'setup_verification.denied',
      input: { setupLinkId: setupLink.id, targetOrigin: setupLink.target_origin },
      status: 'denied',
      resultSummary: { reason: 'ACTIONBRIDGE_SETUP_VERIFICATION_CONNECTOR_ORIGIN_MISMATCH' },
    });
    return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_VERIFICATION_CONNECTOR_ORIGIN_MISMATCH' }, { status: 409, headers });
  }

  const { connector, failed } = await loadSetupConnectorState(serviceSupabase, setupLink);
  if (failed || !connector) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_VERIFICATION_CONNECTOR_NOT_FOUND' }, { status: 409, headers });
  if (!connector.enabled || connector.permission_status === 'paused' || connector.permission_status === 'revoked' || connector.safety_status === 'fail') {
    return denyInactiveSetupConnector(serviceSupabase, setupLink, 'ACTIONBRIDGE_SETUP_VERIFICATION_CONNECTOR_NOT_ACTIVATABLE', headers);
  }
  const quarantine = await getActiveActionBridgeConnectorQuarantine(serviceSupabase, { userId: setupLink.user_id, connectorId: setupLink.connector_id });
  if (quarantine.error) return NextResponse.json({ error: quarantine.error }, { status: 503, headers });
  if (quarantine.quarantined) return denyInactiveSetupConnector(serviceSupabase, setupLink, 'ACTIONBRIDGE_SETUP_VERIFICATION_CONNECTOR_QUARANTINED', headers);
  return null;
}

function verificationExceptionResult(error: unknown): { ok: false; status: ActionBridgeVerificationStatus; evidence: Record<string, unknown>; networkExecution: true } {
  return {
    ok: false,
    status: 'failed',
    evidence: {
      reason: 'verification_probe_failed',
      errorName: error instanceof Error ? error.name : 'unknown',
    },
    networkExecution: true,
  };
}

async function ensureSetupConnectorActivation(serviceSupabase: any, input: {
  setupLink: SetupLinkRecord;
  verificationId: string;
  method: string;
  headers: Record<string, string>;
}): Promise<NextResponse | null> {
  const { setupLink, verificationId, method, headers } = input;
  const { connector, failed: connectorStateFailed } = await loadSetupConnectorState(serviceSupabase, setupLink);
  if (connectorStateFailed || !connector) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_VERIFICATION_CONNECTOR_NOT_FOUND' }, { status: 409, headers });
  if (!connector.enabled || connector.permission_status === 'paused' || connector.permission_status === 'revoked' || connector.safety_status === 'fail') {
    return denyInactiveSetupConnector(serviceSupabase, setupLink, 'ACTIONBRIDGE_SETUP_VERIFICATION_CONNECTOR_NOT_ACTIVATABLE', headers);
  }
  const quarantine = await getActiveActionBridgeConnectorQuarantine(serviceSupabase, { userId: setupLink.user_id, connectorId: setupLink.connector_id! });
  if (quarantine.error) return NextResponse.json({ error: quarantine.error }, { status: 503, headers });
  if (quarantine.quarantined) return denyInactiveSetupConnector(serviceSupabase, setupLink, 'ACTIONBRIDGE_SETUP_VERIFICATION_CONNECTOR_QUARANTINED', headers);

  if (connector.permission_status === 'active' && connector.safety_status === 'pass') {
    const noopAudit = await persistActionBridgeControlAuditEvent(serviceSupabase, {
      userId: setupLink.user_id,
      connectorId: setupLink.connector_id,
      eventName: 'connector.permission_status.verified_noop',
      input: { setupLinkId: setupLink.id, verificationId, method },
      status: 'succeeded',
      resultSummary: { safetyStatus: connector.safety_status, permissionStatus: connector.permission_status, networkExecutionChanged: false },
    });
    if (noopAudit.error) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_VERIFICATION_AUDIT_FAILED' }, { status: 503, headers });
    return null;
  }
  if (connector.permission_status !== 'draft') {
    return denyInactiveSetupConnector(serviceSupabase, setupLink, 'ACTIONBRIDGE_SETUP_VERIFICATION_CONNECTOR_NOT_ACTIVATABLE', headers);
  }

  const { data: updatedConnector, error: connectorUpdateError } = await serviceSupabase
    .from('actionbridge_connectors')
    .update({
      safety_status: 'pass',
      permission_status: 'active',
      network_execution_enabled: false,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', setupLink.user_id)
    .eq('id', setupLink.connector_id)
    .eq('enabled', true)
    .eq('permission_status', 'draft')
    .neq('safety_status', 'fail')
    .select('id')
    .maybeSingle();
  if (connectorUpdateError || !updatedConnector) {
    await persistActionBridgeControlAuditEvent(serviceSupabase, {
      userId: setupLink.user_id,
      connectorId: setupLink.connector_id,
      eventName: 'connector.permission_status.change_failed',
      input: { setupLinkId: setupLink.id, verificationId, method },
      status: 'failed',
      resultSummary: { reason: 'ACTIONBRIDGE_SETUP_VERIFICATION_CONNECTOR_UPDATE_FAILED', networkExecutionEnabled: false },
    });
    return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_VERIFICATION_CONNECTOR_UPDATE_FAILED' }, { status: 503, headers });
  }
  const connectorAudit = await persistActionBridgeControlAuditEvent(serviceSupabase, {
    userId: setupLink.user_id,
    connectorId: setupLink.connector_id,
    eventName: 'connector.permission_status.changed',
    input: { setupLinkId: setupLink.id, verificationId, method },
    status: 'succeeded',
    resultSummary: { safetyStatus: 'pass', permissionStatus: 'active', networkExecutionEnabled: false },
  });
  if (connectorAudit.error) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_VERIFICATION_AUDIT_FAILED' }, { status: 503, headers });
  return null;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const bodyObject = body && typeof body === 'object' && !Array.isArray(body) ? body as SetupVerificationBody : {};
  const setupToken = getSetupToken(bodyObject);
  const rateLimit = await enforceSetupVerificationRateLimit(request, setupToken);
  if (!rateLimit.ok) return rateLimit.response!;
  const responseHeaders = createActionBridgeRateLimitHeaders({ policyName: 'domainVerification', remaining: rateLimit.remaining, resetAt: rateLimit.resetAt });

  if (!isValidSetupToken(setupToken)) {
    return NextResponse.json({ error: 'INVALID_ACTIONBRIDGE_SETUP_SESSION_TOKEN' }, { status: 400 });
  }

  const serviceSupabase = createCoreServiceClient();
  if (!serviceSupabase) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_VERIFICATION_UNAVAILABLE' }, { status: 503 });

  const { setupLink, failed } = await loadSetupLink(serviceSupabase, setupToken);
  if (failed) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_VERIFICATION_LOOKUP_FAILED' }, { status: 500 });
  if (!setupLink) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_SESSION_NOT_FOUND' }, { status: 404 });

  const bindingResponse = await validateSetupLinkBinding(serviceSupabase, setupLink, responseHeaders);
  if (bindingResponse) return bindingResponse;

  const method = getVerificationMethod(bodyObject, setupLink.allowed_methods);
  if (!method) {
    return NextResponse.json({ error: 'INVALID_ACTIONBRIDGE_SETUP_VERIFICATION_METHOD', redactedInput: redactActionBridgeValue(bodyObject) }, { status: 400 });
  }

  const challenge = createActionBridgeVerificationChallenge({ origin: setupLink.target_origin, method });
  if (!challenge) return NextResponse.json({ error: 'INVALID_ACTIONBRIDGE_SETUP_VERIFICATION_ORIGIN' }, { status: 400 });

  const { data: existingVerification, error: existingVerificationError } = await serviceSupabase
    .from('actionbridge_connector_verifications')
    .select('id,status,origin,hostname,method,challenge_path,dns_record_name,expires_at')
    .eq('user_id', setupLink.user_id)
    .eq('connector_id', setupLink.connector_id)
    .eq('origin', challenge.origin)
    .eq('method', method)
    .maybeSingle();
  if (existingVerificationError) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_VERIFICATION_LOOKUP_FAILED' }, { status: 500 });
  if (existingVerification?.status === 'verified' && new Date(existingVerification.expires_at).getTime() > Date.now()) {
    const replayAudit = await persistActionBridgeControlAuditEvent(serviceSupabase, {
      userId: setupLink.user_id,
      connectorId: setupLink.connector_id,
      eventName: 'domain_verification.verified_replay',
      input: { setupLinkId: setupLink.id, verificationId: existingVerification.id, origin: existingVerification.origin, method: existingVerification.method },
      status: 'succeeded',
      resultSummary: { verificationId: existingVerification.id, method: existingVerification.method, resultStatus: 'verified', evidence: { alreadyVerified: true } },
    });
    if (replayAudit.error) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_VERIFICATION_AUDIT_FAILED' }, { status: 503, headers: responseHeaders });
    const activationResponse = await ensureSetupConnectorActivation(serviceSupabase, { setupLink, verificationId: existingVerification.id, method: existingVerification.method, headers: responseHeaders });
    if (activationResponse) return activationResponse;
    return NextResponse.json({
      verification: {
        id: existingVerification.id,
        status: existingVerification.status,
        origin: existingVerification.origin,
        hostname: existingVerification.hostname,
        method: existingVerification.method,
        challengePath: existingVerification.challenge_path,
        dnsRecordName: existingVerification.dns_record_name,
        token: null,
        instructions: ['Domain is already verified for this connector. No new setup challenge was issued.'],
        expiresAt: existingVerification.expires_at,
      },
    }, {
      status: 200,
      headers: responseHeaders,
    });
  }

  const { data, error } = await serviceSupabase
    .from('actionbridge_connector_verifications')
    .upsert({
      user_id: setupLink.user_id,
      connector_id: setupLink.connector_id,
      origin: challenge.origin,
      hostname: challenge.hostname,
      method,
      token_digest: challenge.tokenDigest,
      status: 'pending',
      challenge_path: challenge.challengePath || null,
      dns_record_name: challenge.dnsRecordName || null,
      evidence: { setupLinkId: setupLink.id, instructionsIssued: true },
      verified_at: null,
      expires_at: challenge.expiresAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'connector_id,method,origin' })
    .select('id,status,origin,hostname,method,challenge_path,dns_record_name,expires_at')
    .single();

  if (error || !data) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_VERIFICATION_CREATE_FAILED' }, { status: 409 });

  if (setupLink.status === 'pending') {
    await serviceSupabase
      .from('actionbridge_setup_links')
      .update({ status: 'opened' })
      .eq('id', setupLink.id)
      .eq('status', 'pending');
  }

  await persistActionBridgeControlAuditEvent(serviceSupabase, {
    userId: setupLink.user_id,
    connectorId: setupLink.connector_id,
    eventName: 'domain_verification.challenge_issued',
    input: { setupLinkId: setupLink.id, origin: challenge.origin, method },
    status: 'succeeded',
    resultSummary: { verificationId: data.id, method, status: data.status, expiresAt: data.expires_at },
  });

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
  }, {
    status: 201,
    headers: responseHeaders,
  });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const bodyObject = body && typeof body === 'object' && !Array.isArray(body) ? body as SetupVerificationBody : {};
  const setupToken = getSetupToken(bodyObject);
  const rateLimit = await enforceSetupVerificationRateLimit(request, setupToken);
  if (!rateLimit.ok) return rateLimit.response!;
  const responseHeaders = createActionBridgeRateLimitHeaders({ policyName: 'domainVerification', remaining: rateLimit.remaining, resetAt: rateLimit.resetAt });

  const verificationId = typeof bodyObject.verificationId === 'string'
    ? bodyObject.verificationId.trim()
    : typeof bodyObject.verification_id === 'string'
      ? bodyObject.verification_id.trim()
      : '';
  const verificationToken = getVerificationToken(bodyObject);

  if (!isValidSetupToken(setupToken) || !UUID_PATTERN.test(verificationId) || !isValidVerificationToken(verificationToken)) {
    return NextResponse.json({ error: 'INVALID_ACTIONBRIDGE_SETUP_VERIFICATION_CHECK', redactedInput: redactActionBridgeValue(bodyObject) }, { status: 400 });
  }

  const serviceSupabase = createCoreServiceClient();
  if (!serviceSupabase) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_VERIFICATION_UNAVAILABLE' }, { status: 503 });

  const { setupLink, failed } = await loadSetupLink(serviceSupabase, setupToken);
  if (failed) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_VERIFICATION_LOOKUP_FAILED' }, { status: 500 });
  if (!setupLink) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_SESSION_NOT_FOUND' }, { status: 404 });

  const bindingResponse = await validateSetupLinkBinding(serviceSupabase, setupLink, responseHeaders);
  if (bindingResponse) return bindingResponse;

  const { data: verification } = await serviceSupabase
    .from('actionbridge_connector_verifications')
    .select('id,user_id,connector_id,origin,method,token_digest,status,expires_at')
    .eq('user_id', setupLink.user_id)
    .eq('connector_id', setupLink.connector_id)
    .eq('id', verificationId)
    .maybeSingle();
  if (!verification) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_VERIFICATION_NOT_FOUND' }, { status: 404 });
  if (verification.origin !== setupLink.target_origin) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_VERIFICATION_ORIGIN_MISMATCH' }, { status: 403 });
  if (!METHODS.has(verification.method as ActionBridgeVerificationMethod)) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_VERIFICATION_METHOD_NOT_ALLOWED' }, { status: 409 });
  if (verification.status === 'revoked' || new Date(verification.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_VERIFICATION_EXPIRED_OR_REVOKED' }, { status: 409 });
  }
  if (digestActionBridgeVerificationToken(verificationToken) !== verification.token_digest) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_VERIFICATION_TOKEN_MISMATCH' }, { status: 403 });
  }
  if (verification.status === 'verified') {
    const replayAudit = await persistActionBridgeControlAuditEvent(serviceSupabase, {
      userId: setupLink.user_id,
      connectorId: setupLink.connector_id,
      eventName: 'domain_verification.verified_replay',
      input: { setupLinkId: setupLink.id, verificationId, origin: verification.origin, method: verification.method },
      status: 'succeeded',
      resultSummary: { verificationId, method: verification.method, resultStatus: 'verified', evidence: { alreadyVerified: true } },
    });
    if (replayAudit.error) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_VERIFICATION_AUDIT_FAILED' }, { status: 503, headers: responseHeaders });
    const activationResponse = await ensureSetupConnectorActivation(serviceSupabase, { setupLink, verificationId, method: verification.method, headers: responseHeaders });
    if (activationResponse) return activationResponse;
    return NextResponse.json({
      verification: {
        id: verificationId,
        status: 'verified',
        networkExecution: false,
        evidence: { alreadyVerified: true },
      },
    }, {
      status: 200,
      headers: responseHeaders,
    });
  }

  let result: { ok: boolean; status: ActionBridgeVerificationStatus; evidence: Record<string, unknown>; networkExecution: boolean };
  try {
    result = await verifyActionBridgeDomainChallenge({
      origin: verification.origin,
      method: verification.method as ActionBridgeVerificationMethod,
      token: verificationToken,
    });
  } catch (error) {
    result = verificationExceptionResult(error);
  }
  const redactedEvidence = redactActionBridgeValue(result.evidence) as Record<string, unknown>;
  const { error: verificationUpdateError } = await serviceSupabase
    .from('actionbridge_connector_verifications')
    .update({
      status: result.status,
      evidence: redactedEvidence,
      verified_at: result.ok ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', setupLink.user_id)
    .eq('id', verificationId)
    .eq('connector_id', setupLink.connector_id);

  if (verificationUpdateError) {
    await persistActionBridgeControlAuditEvent(serviceSupabase, {
      userId: setupLink.user_id,
      connectorId: setupLink.connector_id,
      eventName: 'domain_verification.failed',
      input: { setupLinkId: setupLink.id, verificationId, origin: verification.origin, method: verification.method },
      status: 'failed',
      resultSummary: { verificationId, method: verification.method, resultStatus: 'failed', reason: 'ACTIONBRIDGE_SETUP_VERIFICATION_UPDATE_FAILED' },
    });
    return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_VERIFICATION_UPDATE_FAILED' }, { status: 503, headers: responseHeaders });
  }

  const verificationAudit = await persistActionBridgeControlAuditEvent(serviceSupabase, {
    userId: setupLink.user_id,
    connectorId: setupLink.connector_id,
    eventName: result.ok ? 'domain_verification.verified' : 'domain_verification.failed',
    input: { setupLinkId: setupLink.id, verificationId, origin: verification.origin, method: verification.method },
    status: result.ok ? 'succeeded' : 'failed',
    networkExecution: result.networkExecution,
    resultSummary: { verificationId, method: verification.method, resultStatus: result.status, evidence: redactedEvidence },
  });
  if (verificationAudit.error) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_VERIFICATION_AUDIT_FAILED' }, { status: 503, headers: responseHeaders });

  if (result.ok) {
    const activationResponse = await ensureSetupConnectorActivation(serviceSupabase, { setupLink, verificationId, method: verification.method, headers: responseHeaders });
    if (activationResponse) return activationResponse;
  }

  return NextResponse.json({
    verification: {
      id: verificationId,
      status: result.status,
      networkExecution: result.networkExecution,
      evidence: redactedEvidence,
    },
  }, {
    status: result.ok ? 200 : 409,
    headers: responseHeaders,
  });
}
