import 'server-only';

import crypto from 'node:crypto';
import { redactActionBridgeValue } from './redaction';

export type ActionBridgeWebhookSigningMode = 'unsigned_pilot' | 'hmac_sha256';
export type ActionBridgeSecretManagerProvider = 'pilot_env' | 'google_secret_manager_rest';

export interface ActionBridgeWebhookSigningResolution {
  ok: boolean;
  signingSecret: string | null;
  resultSummary: Record<string, unknown>;
}

export interface ActionBridgeSecretManagerProductionReadiness {
  ok: boolean;
  provider: ActionBridgeSecretManagerProvider;
  missing: string[];
  resultSummary: Record<string, unknown>;
}

function digestSecretRef(secretRef: string): string {
  return crypto.createHash('sha256').update(secretRef).digest('hex').slice(0, 16).toUpperCase();
}

function normalizeSecretRef(secretRef: unknown): string | null {
  if (typeof secretRef !== 'string') return null;
  const value = secretRef.trim();
  if (!value) return null;
  if (!/^actionbridge:webhook-signing:[a-zA-Z0-9._:-]{8,160}$/.test(value)) return null;
  return value;
}

function normalizeProvider(env: NodeJS.ProcessEnv): ActionBridgeSecretManagerProvider {
  return env.ACTIONBRIDGE_SECRET_MANAGER_PROVIDER === 'google_secret_manager_rest'
    ? 'google_secret_manager_rest'
    : 'pilot_env';
}

function providerRequired(env: NodeJS.ProcessEnv): boolean {
  return env.ACTIONBRIDGE_SECRET_MANAGER_REQUIRED === 'true' || env.NODE_ENV === 'production';
}

function validateSigningSecret(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length < 32 || value.length > 4096) return null;
  return value;
}

export function checkActionBridgeSecretManagerProductionReadiness(env: NodeJS.ProcessEnv = process.env): ActionBridgeSecretManagerProductionReadiness {
  const provider = normalizeProvider(env);
  const missing: string[] = [];

  if (provider !== 'google_secret_manager_rest') {
    missing.push('ACTIONBRIDGE_SECRET_MANAGER_PROVIDER=google_secret_manager_rest');
  }
  if (env.ACTIONBRIDGE_SECRET_MANAGER_REQUIRED !== 'true') {
    missing.push('ACTIONBRIDGE_SECRET_MANAGER_REQUIRED=true');
  }
  if (!env.ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_PROJECT_ID) {
    missing.push('ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_PROJECT_ID');
  }
  if (!env.ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_ACCESS_TOKEN) {
    missing.push('ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_ACCESS_TOKEN');
  }

  return {
    ok: missing.length === 0,
    provider,
    missing,
    resultSummary: redactActionBridgeValue({
      provider,
      readiness: missing.length === 0 ? 'managed_secret_environment_shape_configured' : 'managed_secret_environment_incomplete',
      missing,
      projectConfigured: Boolean(env.ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_PROJECT_ID),
      accessTokenConfigured: Boolean(env.ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_ACCESS_TOKEN),
    }) as Record<string, unknown>,
  };
}

export function createActionBridgeGoogleSecretManagerSecretId(secretRef: string): string {
  // Provider-safe deterministic id: Google Secret Manager secret IDs allow letters, numbers, hyphens, and underscores.
  // Do not pass user/operator labels through directly; use a digest-only mapping to avoid provider grammar drift and raw-ref exposure.
  return `actionbridge-webhook-signing-${crypto.createHash('sha256').update(secretRef).digest('hex').slice(0, 32)}`;
}

async function resolveGoogleSecretManagerRest(input: {
  secretRef: string;
  env: NodeJS.ProcessEnv;
}): Promise<{ secret: string | null; summary: Record<string, unknown> }> {
  const projectId = input.env.ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_PROJECT_ID;
  const token = input.env.ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_ACCESS_TOKEN;
  const secretId = createActionBridgeGoogleSecretManagerSecretId(input.secretRef);
  const secretRefDigest = `sha256:${digestSecretRef(input.secretRef).toLowerCase()}`;
  if (!projectId || !token) {
    return { secret: null, summary: { provider: 'google_secret_manager_rest', accessAudit: 'config_missing', secretRefDigest } };
  }

  const url = `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/secrets/${encodeURIComponent(secretId)}/versions/latest:access`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) {
    return { secret: null, summary: { provider: 'google_secret_manager_rest', accessAudit: 'access_denied_or_unavailable', httpStatus: response.status, secretRefDigest } };
  }
  const body = await response.json().catch(() => null) as { payload?: { data?: string }, name?: string } | null;
  const encoded = body?.payload?.data;
  const secret = encoded ? validateSigningSecret(Buffer.from(encoded, 'base64').toString('utf8')) : null;
  return {
    secret,
    summary: {
      provider: 'google_secret_manager_rest',
      accessAudit: secret ? 'accessed_latest_version' : 'invalid_secret_payload',
      secretRefDigest,
      versionResourceDigest: body?.name ? `sha256:${crypto.createHash('sha256').update(body.name).digest('hex').slice(0, 16)}` : undefined,
    },
  };
}

function unresolved(input: { connectorId: string; secretRef?: string | null; signing: string; reason: string; extra?: Record<string, unknown> }): ActionBridgeWebhookSigningResolution {
  return {
    ok: false,
    signingSecret: null,
    resultSummary: redactActionBridgeValue({
      signing: input.signing,
      reason: input.reason,
      connectorId: input.connectorId,
      ...(input.secretRef ? { secretRefDigest: `sha256:${digestSecretRef(input.secretRef).toLowerCase()}` } : {}),
      ...(input.extra || {}),
    }) as Record<string, unknown>,
  };
}

export async function resolveActionBridgeWebhookSigningSecretAsync(input: {
  connectorId: string;
  signingMode?: ActionBridgeWebhookSigningMode | null;
  secretRef?: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<ActionBridgeWebhookSigningResolution> {
  const signingMode = input.signingMode === 'hmac_sha256' ? 'hmac_sha256' : 'unsigned_pilot';
  const secretRef = normalizeSecretRef(input.secretRef);
  const env = input.env || process.env;
  const provider = normalizeProvider(env);
  if (signingMode === 'unsigned_pilot') {
    return {
      ok: true,
      signingSecret: null,
      resultSummary: { signing: 'unsigned_pilot_mode', reason: 'Connector is explicitly configured for controlled unsigned pilot delivery.' },
    };
  }

  if (!secretRef) {
    return unresolved({ connectorId: input.connectorId, signing: 'secret_ref_missing', reason: 'Connector requires HMAC signing but has no valid server-owned secret reference.' });
  }

  if (provider === 'google_secret_manager_rest') {
    try {
      const resolved = await resolveGoogleSecretManagerRest({ secretRef, env });
      if (!resolved.secret) {
        return unresolved({ connectorId: input.connectorId, secretRef, signing: 'secret_ref_unresolved', reason: 'Configured webhook signing secret reference could not be resolved by the managed secret provider.', extra: resolved.summary });
      }
      return { ok: true, signingSecret: resolved.secret, resultSummary: { signing: 'hmac_sha256', secretRefDigest: resolved.summary.secretRefDigest, ...resolved.summary } };
    } catch {
      return unresolved({ connectorId: input.connectorId, secretRef, signing: 'secret_ref_unresolved', reason: 'Managed secret provider failed closed before webhook delivery.', extra: { provider, accessAudit: 'provider_exception' } });
    }
  }

  if (providerRequired(env)) {
    return unresolved({ connectorId: input.connectorId, secretRef, signing: 'secret_manager_required', reason: 'Production webhook signing requires a managed secret provider; pilot env lookup is disabled.', extra: { provider } });
  }

  const envName = `ACTIONBRIDGE_WEBHOOK_SIGNING_SECRET_${digestSecretRef(secretRef)}`;
  const signingSecret = validateSigningSecret(env[envName]);
  if (!signingSecret) {
    return unresolved({ connectorId: input.connectorId, secretRef, signing: 'secret_ref_unresolved', reason: 'Configured webhook signing secret reference could not be resolved server-side.', extra: { provider: 'pilot_env' } });
  }

  return {
    ok: true,
    signingSecret,
    resultSummary: { signing: 'hmac_sha256', secretRefDigest: `sha256:${digestSecretRef(secretRef).toLowerCase()}`, provider: 'pilot_env' },
  };
}

export function resolveActionBridgeWebhookSigningSecret(input: {
  connectorId: string;
  signingMode?: ActionBridgeWebhookSigningMode | null;
  secretRef?: string | null;
  env?: NodeJS.ProcessEnv;
}): ActionBridgeWebhookSigningResolution {
  const env = input.env || process.env;
  if (normalizeProvider(env) === 'google_secret_manager_rest') {
    return unresolved({ connectorId: input.connectorId, secretRef: normalizeSecretRef(input.secretRef), signing: 'secret_manager_async_required', reason: 'Managed secret provider resolution must use the async resolver.' });
  }
  const signingMode = input.signingMode === 'hmac_sha256' ? 'hmac_sha256' : 'unsigned_pilot';
  if (signingMode === 'unsigned_pilot') return { ok: true, signingSecret: null, resultSummary: { signing: 'unsigned_pilot_mode', reason: 'Connector is explicitly configured for controlled unsigned pilot delivery.' } };
  const secretRef = normalizeSecretRef(input.secretRef);
  if (!secretRef) return unresolved({ connectorId: input.connectorId, signing: 'secret_ref_missing', reason: 'Connector requires HMAC signing but has no valid server-owned secret reference.' });
  if (providerRequired(env)) return unresolved({ connectorId: input.connectorId, secretRef, signing: 'secret_manager_required', reason: 'Production webhook signing requires a managed secret provider; pilot env lookup is disabled.', extra: { provider: 'pilot_env' } });
  const envName = `ACTIONBRIDGE_WEBHOOK_SIGNING_SECRET_${digestSecretRef(secretRef)}`;
  const signingSecret = validateSigningSecret(env[envName]);
  if (!signingSecret) return unresolved({ connectorId: input.connectorId, secretRef, signing: 'secret_ref_unresolved', reason: 'Configured webhook signing secret reference could not be resolved server-side.', extra: { provider: 'pilot_env' } });
  return { ok: true, signingSecret, resultSummary: { signing: 'hmac_sha256', secretRefDigest: `sha256:${digestSecretRef(secretRef).toLowerCase()}`, provider: 'pilot_env' } };
}
