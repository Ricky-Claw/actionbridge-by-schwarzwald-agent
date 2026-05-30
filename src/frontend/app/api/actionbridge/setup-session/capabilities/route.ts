export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createCoreServiceClient } from '@/lib/core/service-client';
import { normalizeActionBridgeCapabilityRuleInput } from '@/lib/actionbridge/capability-rules';
import { persistActionBridgeControlAuditEvent } from '@/lib/actionbridge/persistence';
import { createActionBridgeRateLimitHeaders, enforceActionBridgeRateLimitAsync } from '@/lib/actionbridge/rate-limit';
import { redactActionBridgeValue } from '@/lib/actionbridge/redaction';
import { digestActionBridgeSetupSessionToken, isActionBridgeSetupSessionUsable } from '@/lib/actionbridge/setup-session';
import { verifyActionBridgeConnectorSetupTargetOriginBinding } from '@/lib/actionbridge/setup-links';
import { getActiveActionBridgeConnectorQuarantine } from '@/lib/actionbridge/webhook-quarantine';

type SetupCapabilitiesBody = Record<string, unknown>;

type SetupLinkRecord = {
  id: string;
  user_id: string;
  connector_id: string | null;
  target_origin: string;
  status: 'pending' | 'opened' | 'completed' | 'revoked' | 'expired';
  expires_at: string;
};

const SETUP_CAPABILITY_NAMES = new Set(['site.knowledge.read', 'lead.prepare_draft', 'appointment.request.prepare_draft']);

function getSetupToken(body: SetupCapabilitiesBody): string {
  const value = typeof body.setupToken === 'string'
    ? body.setupToken
    : typeof body.setup_token === 'string'
      ? body.setup_token
      : '';
  return value.trim();
}

function isValidSetupToken(token: string): boolean {
  return token.startsWith('absl_') && token.length >= 12 && token.length <= 160;
}

function normalizeCapabilityNames(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > SETUP_CAPABILITY_NAMES.size) return null;
  const names = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || !SETUP_CAPABILITY_NAMES.has(entry)) return null;
    names.add(entry);
  }
  return [...names];
}

async function loadSetupLink(serviceSupabase: any, setupToken: string): Promise<{ setupLink: SetupLinkRecord | null; failed: boolean }> {
  const tokenDigest = digestActionBridgeSetupSessionToken(setupToken);
  const { data, error } = await serviceSupabase
    .from('actionbridge_setup_links')
    .select('id,user_id,connector_id,target_origin,status,expires_at')
    .eq('token_digest', tokenDigest)
    .maybeSingle();
  if (error) return { setupLink: null, failed: true };
  return { setupLink: data as SetupLinkRecord | null, failed: false };
}

async function validateSetupLinkForCapabilityRules(serviceSupabase: any, setupLink: SetupLinkRecord, headers?: Record<string, string>): Promise<NextResponse | null> {
  if (!isActionBridgeSetupSessionUsable(setupLink)) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_SESSION_EXPIRED_OR_CLOSED' }, { status: 409, headers });
  }
  if (!setupLink.connector_id) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_CAPABILITIES_CONNECTOR_REQUIRED' }, { status: 409, headers });
  }

  const bindingStatus = await verifyActionBridgeConnectorSetupTargetOriginBinding(serviceSupabase, {
    userId: setupLink.user_id,
    connectorId: setupLink.connector_id,
    targetOrigin: setupLink.target_origin,
  });
  if (bindingStatus === 'connector_not_found') return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_CAPABILITIES_CONNECTOR_NOT_FOUND' }, { status: 409, headers });
  if (bindingStatus !== 'matched') {
    await persistActionBridgeControlAuditEvent(serviceSupabase, {
      userId: setupLink.user_id,
      connectorId: setupLink.connector_id,
      eventName: 'setup_capabilities.denied',
      input: { setupLinkId: setupLink.id, targetOrigin: setupLink.target_origin },
      status: 'denied',
      resultSummary: { reason: 'ACTIONBRIDGE_SETUP_CAPABILITIES_CONNECTOR_ORIGIN_MISMATCH' },
    });
    return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_CAPABILITIES_CONNECTOR_ORIGIN_MISMATCH' }, { status: 409, headers });
  }

  const { data: connector, error: connectorError } = await serviceSupabase
    .from('actionbridge_connectors')
    .select('id,enabled,safety_status,permission_status')
    .eq('user_id', setupLink.user_id)
    .eq('id', setupLink.connector_id)
    .maybeSingle();
  if (connectorError || !connector) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_CAPABILITIES_CONNECTOR_NOT_FOUND' }, { status: 409, headers });
  if (!connector.enabled || connector.safety_status !== 'pass' || connector.permission_status !== 'active') {
    await persistActionBridgeControlAuditEvent(serviceSupabase, {
      userId: setupLink.user_id,
      connectorId: setupLink.connector_id,
      eventName: 'setup_capabilities.denied',
      input: { setupLinkId: setupLink.id, targetOrigin: setupLink.target_origin },
      status: 'denied',
      resultSummary: { reason: 'ACTIONBRIDGE_SETUP_CAPABILITIES_REQUIRES_VERIFIED_ACTIVE_CONNECTOR' },
    });
    return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_CAPABILITIES_REQUIRES_VERIFIED_ACTIVE_CONNECTOR' }, { status: 409, headers });
  }

  const quarantine = await getActiveActionBridgeConnectorQuarantine(serviceSupabase, { userId: setupLink.user_id, connectorId: setupLink.connector_id });
  if (quarantine.error) return NextResponse.json({ error: quarantine.error }, { status: 503, headers });
  if (quarantine.quarantined) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_CAPABILITIES_CONNECTOR_QUARANTINED' }, { status: 409, headers });

  return null;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const bodyObject = body && typeof body === 'object' && !Array.isArray(body) ? body as SetupCapabilitiesBody : {};
  const setupToken = getSetupToken(bodyObject);
  const rateLimit = await enforceActionBridgeRateLimitAsync({
    request,
    policyName: 'setupSession',
    discriminator: isValidSetupToken(setupToken) ? digestActionBridgeSetupSessionToken(setupToken).slice(0, 48) : 'invalid_setup_capabilities_token',
  });
  if (!rateLimit.ok) return rateLimit.response!;
  const responseHeaders = createActionBridgeRateLimitHeaders({ policyName: 'setupSession', remaining: rateLimit.remaining, resetAt: rateLimit.resetAt });

  if (!isValidSetupToken(setupToken)) return NextResponse.json({ error: 'INVALID_ACTIONBRIDGE_SETUP_SESSION_TOKEN' }, { status: 400, headers: responseHeaders });
  const selectedCapabilities = normalizeCapabilityNames(bodyObject.capabilities ?? bodyObject.selectedCapabilities ?? bodyObject.selected_capabilities);
  if (!selectedCapabilities) {
    return NextResponse.json({ error: 'INVALID_ACTIONBRIDGE_SETUP_CAPABILITIES', redactedInput: redactActionBridgeValue(bodyObject) }, { status: 400, headers: responseHeaders });
  }

  const serviceSupabase = createCoreServiceClient();
  if (!serviceSupabase) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_CAPABILITIES_UNAVAILABLE' }, { status: 503, headers: responseHeaders });

  const { setupLink, failed } = await loadSetupLink(serviceSupabase, setupToken);
  if (failed) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_CAPABILITIES_LOOKUP_FAILED' }, { status: 500, headers: responseHeaders });
  if (!setupLink) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_SESSION_NOT_FOUND' }, { status: 404, headers: responseHeaders });

  const validationResponse = await validateSetupLinkForCapabilityRules(serviceSupabase, setupLink, responseHeaders);
  if (validationResponse) return validationResponse;

  const now = new Date().toISOString();
  const ruleRows = [];
  for (const name of SETUP_CAPABILITY_NAMES) {
    const enabled = selectedCapabilities.includes(name);
    const rule = normalizeActionBridgeCapabilityRuleInput({ connectorId: setupLink.connector_id, name, enabled });
    if (!rule) return NextResponse.json({ error: 'INVALID_ACTIONBRIDGE_SETUP_CAPABILITY_RULE' }, { status: 400, headers: responseHeaders });
    ruleRows.push({
      user_id: setupLink.user_id,
      connector_id: setupLink.connector_id,
      name: rule.name,
      risk_level: rule.riskLevel,
      enabled: rule.enabled,
      requires_approval: rule.requiresApproval,
      config: {},
      updated_at: now,
    });
  }

  const { data: persistedRules, error: rulesError } = await serviceSupabase
    .from('actionbridge_capability_rules')
    .upsert(ruleRows, { onConflict: 'user_id,connector_id,name' })
    .select('id,name,risk_level,enabled,requires_approval');
  if (rulesError || !Array.isArray(persistedRules) || persistedRules.length !== ruleRows.length) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_CAPABILITY_RULE_SAVE_FAILED' }, { status: 409, headers: responseHeaders });
  }

  const audit = await persistActionBridgeControlAuditEvent(serviceSupabase, {
    userId: setupLink.user_id,
    connectorId: setupLink.connector_id,
    eventName: 'setup_capabilities.saved',
    input: { setupLinkId: setupLink.id, targetOrigin: setupLink.target_origin, capabilities: selectedCapabilities },
    status: 'succeeded',
    resultSummary: {
      enabledCapabilities: persistedRules.filter((rule) => rule.enabled).map((rule) => rule.name),
      disabledCapabilities: persistedRules.filter((rule) => !rule.enabled).map((rule) => rule.name),
      networkExecution: false,
    },
  });
  if (audit.error) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_CAPABILITIES_AUDIT_FAILED' }, { status: 503, headers: responseHeaders });

  if (setupLink.status === 'pending') {
    await serviceSupabase
      .from('actionbridge_setup_links')
      .update({ status: 'opened' })
      .eq('id', setupLink.id)
      .eq('status', 'pending');
  }

  return NextResponse.json({
    capabilityRules: persistedRules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      riskLevel: rule.risk_level,
      enabled: rule.enabled,
      requiresApproval: rule.requires_approval,
    })),
    execution: { mode: 'catalog_only', networkExecution: false },
  }, { status: 201, headers: responseHeaders });
}
