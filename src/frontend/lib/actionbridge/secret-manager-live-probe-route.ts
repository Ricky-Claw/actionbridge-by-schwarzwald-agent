import 'server-only';

import crypto from 'node:crypto';
import { redactActionBridgeValue } from './redaction';

export const ACTIONBRIDGE_SECRET_MANAGER_LIVE_PROBE_POLICY = 'sentinel.actionbridge.secret_manager.live_probe.v1';

export interface ActionBridgeSecretManagerLiveProbeUser {
  id: string;
}

export interface ActionBridgeSecretManagerLiveProbeUserClient {
  auth: {
    getUser: () => Promise<{
      data?: { user?: ActionBridgeSecretManagerLiveProbeUser | null } | null;
      error?: unknown;
    }>;
  };
  from: (table: string) => {
    select: (columns: string) => unknown;
  };
}

export interface ActionBridgeSecretManagerLiveProbeConnectorRow {
  id: string;
  user_id?: string | null;
  type?: string | null;
  webhook_signing_mode?: string | null;
  secret_ref?: string | null;
}

export interface ActionBridgeSecretManagerLiveProbeRateLimitResult {
  ok: boolean;
  keyDigest: string;
  responseStatus?: number;
  responseBody?: Record<string, unknown>;
  responseHeaders?: Record<string, string>;
}

export interface ActionBridgeSecretManagerLiveProbeResult {
  ok: boolean;
  resultSummary: Record<string, unknown>;
}

export interface PersistActionBridgeSecretManagerLiveProbeAuditInput {
  userId: string;
  connectorId: string;
  eventName: 'secret_manager.live_probe_verified' | 'secret_manager.live_probe_failed';
  input: Record<string, unknown>;
  status: 'succeeded' | 'failed';
  resultSummary: Record<string, unknown>;
}

export interface HandleActionBridgeSecretManagerLiveProbeInput {
  request: unknown;
  readBody: () => Promise<unknown>;
  createUserClient: () => Promise<ActionBridgeSecretManagerLiveProbeUserClient>;
  tryCreateServiceClient: () => unknown | null;
  enforceRateLimit: (input: {
    request: unknown;
    userId: string;
    connectorId: string;
  }) => Promise<ActionBridgeSecretManagerLiveProbeRateLimitResult>;
  probeLiveAccess: (input: { secretRef: string }) => Promise<ActionBridgeSecretManagerLiveProbeResult>;
  persistAudit: (
    serviceClient: unknown,
    input: PersistActionBridgeSecretManagerLiveProbeAuditInput
  ) => Promise<{ error: string | null }>;
}

export interface ActionBridgeSecretManagerLiveProbeRouteResult {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

const RAW_SECRET_REF_PATTERN = /\bactionbridge:webhook-signing:[a-zA-Z0-9._:-]{1,200}\b/g;
const GOOGLE_SECRET_MANAGER_RESOURCE_PATTERN = /\bprojects\/[^\s/]+\/secrets\/[^\s/]+\/versions\/[^\s,;"'`)}\]]+/g;

function digestSecretRef(secretRef: string | null | undefined): string | null {
  if (!secretRef) return null;
  return `sha256:${crypto.createHash('sha256').update(secretRef).digest('hex').slice(0, 16)}`;
}

function normalizeSummaryKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isAllowedDigestKey(normalizedKey: string): boolean {
  return normalizedKey.endsWith('digest');
}

function isSensitiveLiveProbeSummaryKey(key: string): boolean {
  const normalizedKey = normalizeSummaryKey(key);
  if (isAllowedDigestKey(normalizedKey)) return false;
  return normalizedKey.includes('secretref')
    || normalizedKey.includes('secretvalue')
    || normalizedKey.includes('signingsecret')
    || normalizedKey.includes('accesstoken')
    || normalizedKey.includes('providertoken')
    || normalizedKey.includes('providerresource')
    || normalizedKey.includes('resourcename')
    || normalizedKey.includes('versionresource')
    || normalizedKey.includes('versionname')
    || normalizedKey === 'secret'
    || normalizedKey === 'token';
}

function redactLiveProbeSummaryString(value: string): string {
  const redacted = redactActionBridgeValue(value);
  return String(redacted)
    .replace(RAW_SECRET_REF_PATTERN, '[REDACTED_SECRET_REF]')
    .replace(GOOGLE_SECRET_MANAGER_RESOURCE_PATTERN, '[REDACTED_PROVIDER_RESOURCE]');
}

function sanitizeLiveProbeSummaryValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeLiveProbeSummaryValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        isSensitiveLiveProbeSummaryKey(key) ? '[REDACTED]' : sanitizeLiveProbeSummaryValue(nested),
      ])
    );
  }
  if (typeof value === 'string') return redactLiveProbeSummaryString(value);
  return value;
}

export function sanitizeActionBridgeSecretManagerLiveProbeSummary(summary: Record<string, unknown>): Record<string, unknown> {
  return sanitizeLiveProbeSummaryValue(redactActionBridgeValue(summary)) as Record<string, unknown>;
}

export function parseActionBridgeSecretManagerLiveProbeConnectorId(body: unknown): string {
  const bodyObject = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const raw = typeof bodyObject.connectorId === 'string'
    ? bodyObject.connectorId
    : typeof bodyObject.connector_id === 'string'
      ? bodyObject.connector_id
      : '';
  return raw.trim();
}

async function getConnectorForOwner(
  supabase: ActionBridgeSecretManagerLiveProbeUserClient,
  userId: string,
  connectorId: string
): Promise<ActionBridgeSecretManagerLiveProbeConnectorRow | null> {
  const query = (supabase as any)
    .from('actionbridge_connectors')
    .select('id,user_id,type,webhook_signing_mode,secret_ref')
    .eq('user_id', userId)
    .eq('id', connectorId);
  const { data } = await query.maybeSingle();
  return data as ActionBridgeSecretManagerLiveProbeConnectorRow | null;
}

function jsonResult(
  status: number,
  body: Record<string, unknown>,
  headers?: Record<string, string>
): ActionBridgeSecretManagerLiveProbeRouteResult {
  return { status, body, ...(headers ? { headers } : {}) };
}

export async function handleActionBridgeSecretManagerLiveProbe(
  input: HandleActionBridgeSecretManagerLiveProbeInput
): Promise<ActionBridgeSecretManagerLiveProbeRouteResult> {
  const supabase = await input.createUserClient();
  const { data, error } = await supabase.auth.getUser();
  const user = data?.user;
  if (error || !user?.id) {
    return jsonResult(401, { error: 'UNAUTHORIZED' });
  }

  const body = await input.readBody().catch(() => ({}));
  const connectorId = parseActionBridgeSecretManagerLiveProbeConnectorId(body);
  if (!connectorId) {
    return jsonResult(400, { error: 'ACTIONBRIDGE_SECRET_MANAGER_PROBE_CONNECTOR_REQUIRED' });
  }

  const serviceSupabase = input.tryCreateServiceClient();
  if (!serviceSupabase) {
    return jsonResult(503, { error: 'ACTIONBRIDGE_SECRET_MANAGER_PROBE_AUDIT_UNAVAILABLE' });
  }

  const connector = await getConnectorForOwner(supabase, user.id, connectorId);
  if (!connector) return jsonResult(404, { error: 'ACTIONBRIDGE_CONNECTOR_NOT_FOUND' });
  if (connector.type !== 'webhook' || connector.webhook_signing_mode !== 'hmac_sha256' || !connector.secret_ref) {
    return jsonResult(409, { error: 'ACTIONBRIDGE_SECRET_MANAGER_PROBE_REQUIRES_HMAC_WEBHOOK_CONNECTOR' });
  }

  const rateLimit = await input.enforceRateLimit({ request: input.request, userId: user.id, connectorId });
  if (!rateLimit.ok) {
    return jsonResult(
      rateLimit.responseStatus || 429,
      rateLimit.responseBody || { error: 'ACTIONBRIDGE_SECRET_MANAGER_PROBE_RATE_LIMITED' },
      rateLimit.responseHeaders
    );
  }

  const probe = await input.probeLiveAccess({ secretRef: connector.secret_ref });
  const status = probe.ok ? 'succeeded' : 'failed';
  const resultSummary = sanitizeActionBridgeSecretManagerLiveProbeSummary({
    ...probe.resultSummary,
    connectorId,
    secretRefDigest: digestSecretRef(connector.secret_ref),
    sentinelPolicy: ACTIONBRIDGE_SECRET_MANAGER_LIVE_PROBE_POLICY,
    redacted: true,
  });

  const audit = await input.persistAudit(serviceSupabase, {
    userId: user.id,
    connectorId,
    eventName: probe.ok ? 'secret_manager.live_probe_verified' : 'secret_manager.live_probe_failed',
    input: {
      connectorId,
      secretRefDigest: digestSecretRef(connector.secret_ref),
      sentinelPolicy: ACTIONBRIDGE_SECRET_MANAGER_LIVE_PROBE_POLICY,
      rateLimitKeyDigest: rateLimit.keyDigest,
    },
    status,
    resultSummary: {
      ...resultSummary,
      rateLimitKeyDigest: rateLimit.keyDigest,
    },
  });

  if (audit.error) {
    return jsonResult(503, {
      error: 'ACTIONBRIDGE_SECRET_MANAGER_PROBE_AUDIT_FAILED',
      resultSummary: {
        ...resultSummary,
        auditPersisted: false,
      },
    });
  }

  return jsonResult(probe.ok ? 200 : 409, {
    ok: probe.ok,
    status,
    resultSummary: {
      ...resultSummary,
      auditPersisted: true,
    },
  });
}
