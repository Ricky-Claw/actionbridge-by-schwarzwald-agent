import 'server-only';

import crypto from 'node:crypto';
import { redactActionBridgeValue } from './redaction';

export interface ActionBridgeWebhookSigningResolution {
  ok: boolean;
  signingSecret: string | null;
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

export function resolveActionBridgeWebhookSigningSecret(input: {
  connectorId: string;
  secretRef?: string | null;
  env?: NodeJS.ProcessEnv;
}): ActionBridgeWebhookSigningResolution {
  const secretRef = normalizeSecretRef(input.secretRef);
  if (!secretRef) {
    return {
      ok: true,
      signingSecret: null,
      resultSummary: { signing: 'unsigned_pilot_mode', reason: 'No server-owned webhook signing secret reference is configured.' },
    };
  }

  const env = input.env || process.env;
  const envName = `ACTIONBRIDGE_WEBHOOK_SIGNING_SECRET_${digestSecretRef(secretRef)}`;
  const signingSecret = env[envName];
  if (!signingSecret || signingSecret.length < 32 || signingSecret.length > 4096) {
    return {
      ok: false,
      signingSecret: null,
      resultSummary: redactActionBridgeValue({
        signing: 'secret_ref_unresolved',
        reason: 'Configured webhook signing secret reference could not be resolved server-side.',
        connectorId: input.connectorId,
        secretRefDigest: `sha256:${digestSecretRef(secretRef).toLowerCase()}`,
      }) as Record<string, unknown>,
    };
  }

  return {
    ok: true,
    signingSecret,
    resultSummary: { signing: 'hmac_sha256', secretRefDigest: `sha256:${digestSecretRef(secretRef).toLowerCase()}` },
  };
}
