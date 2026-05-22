import 'server-only';

import crypto from 'node:crypto';

export type ActionBridgeBackendBridgePairingStatus = 'pending' | 'consumed' | 'expired' | 'revoked';

export function createActionBridgeBackendBridgePairingCode(): string {
  return `abbp_${crypto.randomBytes(24).toString('base64url')}`;
}

export function digestActionBridgeBackendBridgePairingCode(code: string): string {
  return `sha256:${crypto.createHash('sha256').update(code).digest('hex')}`;
}

export function createActionBridgeBackendBridgeSharedSecret(): string {
  return `abbs_${crypto.randomBytes(32).toString('base64url')}`;
}

export function digestActionBridgeBackendBridgeSharedSecret(secret: string): string {
  return `sha256:${crypto.createHash('sha256').update(secret).digest('hex')}`;
}

export function createActionBridgeBackendBridgeSecretRef(input: { connectorId: string; pairingId: string }): string {
  const digest = crypto.createHash('sha256').update(`${input.connectorId}:${input.pairingId}`).digest('hex').slice(0, 24);
  return `actionbridge:backend-bridge:${digest}`;
}

export function createActionBridgeBackendBridgePairingDraft(input: {
  connectorId: string;
  code?: string;
  now?: Date;
}) {
  const code = input.code || createActionBridgeBackendBridgePairingCode();
  const now = input.now || new Date();
  return {
    connectorId: input.connectorId,
    code,
    codeDigest: digestActionBridgeBackendBridgePairingCode(code),
    expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
  };
}

export function digestActionBridgeBackendBridgeHealthNonce(input: { connectorId: string; nonce: string }): string {
  return `sha256:${crypto.createHash('sha256').update(`${input.connectorId}:${input.nonce}`).digest('hex')}`;
}

export function createActionBridgeBackendBridgeHealthSignaturePayload(input: {
  connectorId: string;
  timestamp: string;
  nonce: string;
  health: unknown;
}): string {
  const redactedHealth = sanitizeActionBridgeBackendBridgeHealth(input.health);
  const healthDigest = crypto.createHash('sha256').update(JSON.stringify(redactedHealth)).digest('hex');
  return [input.connectorId, input.timestamp, input.nonce, healthDigest].join('\n');
}

export function verifyActionBridgeBackendBridgeHealthSignature(input: {
  sharedSecretDigest: string;
  connectorId: string;
  timestamp: string;
  nonce: string;
  health: unknown;
  signature: string;
  now?: Date;
  maxSkewSeconds?: number;
}): { ok: true; health: Record<string, unknown> } | { ok: false; error: string } {
  if (!input.connectorId || !input.timestamp || !input.nonce || !input.signature) return { ok: false, error: 'ACTIONBRIDGE_BACKEND_BRIDGE_HEALTH_SIGNATURE_MISSING' };
  if (!/^sha256:[a-f0-9]{64}$/.test(input.sharedSecretDigest)) return { ok: false, error: 'ACTIONBRIDGE_BACKEND_BRIDGE_HEALTH_SECRET_UNAVAILABLE' };
  const timestampMs = Number(input.timestamp) * 1000;
  const nowMs = (input.now || new Date()).getTime();
  if (!Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > (input.maxSkewSeconds || 300) * 1000) return { ok: false, error: 'ACTIONBRIDGE_BACKEND_BRIDGE_HEALTH_SIGNATURE_EXPIRED' };
  const expected = `sha256:${crypto.createHmac('sha256', input.sharedSecretDigest).update(createActionBridgeBackendBridgeHealthSignaturePayload(input)).digest('hex')}`;
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(input.signature);
  if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) return { ok: false, error: 'ACTIONBRIDGE_BACKEND_BRIDGE_HEALTH_SIGNATURE_INVALID' };
  return { ok: true, health: sanitizeActionBridgeBackendBridgeHealth(input.health) };
}

export function sanitizeActionBridgeBackendBridgeHealth(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  return {
    ok: input.ok === true,
    pluginVersion: typeof input.pluginVersion === 'string' ? input.pluginVersion.slice(0, 32) : undefined,
    platform: typeof input.platform === 'string' ? input.platform.slice(0, 48) : undefined,
    siteUrlDigest: typeof input.siteUrlDigest === 'string' ? input.siteUrlDigest.slice(0, 96) : undefined,
    wordpressVersion: typeof input.wordpressVersion === 'string' ? input.wordpressVersion.slice(0, 32) : undefined,
    woocommerceActive: input.woocommerceActive === true,
    writesEnabled: input.writesEnabled === true,
    enabledCapabilities: Array.isArray(input.enabledCapabilities)
      ? input.enabledCapabilities.filter((item) => typeof item === 'string').map((item) => item.slice(0, 96)).slice(0, 50)
      : [],
  };
}

export function sanitizeActionBridgeBackendBridgePluginInfo(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  return {
    pluginVersion: typeof input.pluginVersion === 'string' ? input.pluginVersion.slice(0, 32) : undefined,
    siteUrlDigest: typeof input.siteUrlDigest === 'string' ? input.siteUrlDigest.slice(0, 96) : undefined,
    wordpressVersion: typeof input.wordpressVersion === 'string' ? input.wordpressVersion.slice(0, 32) : undefined,
    woocommerceActive: input.woocommerceActive === true,
  };
}
