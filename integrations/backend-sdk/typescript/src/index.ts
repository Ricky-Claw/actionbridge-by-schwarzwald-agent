import crypto from 'node:crypto';

export type ActionBridgeBackendCapability =
  | `backend.read:${string}`
  | `backend.write_draft:${string}`
  | `workflow.trigger:${string}`
  | `database.read_model:${string}`;

export type ActionBridgeBackendHandler = (input: unknown, context: ActionBridgeBackendContext) => Promise<unknown> | unknown;

export interface ActionBridgeBackendContext {
  targetId: string;
  connectorId: string;
  capability: ActionBridgeBackendCapability;
  requestId?: string;
  dryRun?: boolean;
}

export interface ActionBridgeBackendRegistration {
  targetId: string;
  connectorId: string;
  sharedSecret: string;
  capabilities: ActionBridgeBackendCapability[];
  handlers: Partial<Record<ActionBridgeBackendCapability, ActionBridgeBackendHandler>>;
  platform?: string;
  version?: string;
}

export interface ActionBridgeSignedRequest {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  connectorId: string;
  body: string;
  signature: string;
}

export interface ActionBridgeReplayCache {
  /**
   * Atomically stores nonce if absent. Must return false when nonce already exists.
   * Implement with Redis SET NX EX, database unique insert, or equivalent.
   */
  setIfAbsent(nonce: string, ttlSeconds: number): boolean | Promise<boolean>;
}

const CAPABILITY_PATTERN = /^(backend\.read|backend\.write_draft|workflow\.trigger|database\.read_model):[a-zA-Z0-9_.:-]{1,80}$/;
const DESTRUCTIVE_PATTERN = /(^|\.)(delete|destroy|refund|publish|raw_sql|admin|password|secret)(:|$)/i;

export function sanitizeActionBridgeBackendCapability(value: unknown): ActionBridgeBackendCapability | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (!CAPABILITY_PATTERN.test(candidate)) return null;
  if (DESTRUCTIVE_PATTERN.test(candidate)) return null;
  return candidate as ActionBridgeBackendCapability;
}

export function normalizeActionBridgeBackendCapabilities(values: unknown): ActionBridgeBackendCapability[] {
  if (!Array.isArray(values)) return [];
  const out = new Set<ActionBridgeBackendCapability>();
  for (const value of values) {
    const capability = sanitizeActionBridgeBackendCapability(value);
    if (capability) out.add(capability);
  }
  return [...out];
}

export function createActionBridgeBodyDigest(body: string): string {
  return crypto.createHash('sha256').update(body).digest('hex');
}

export function createActionBridgeSignaturePayload(input: Omit<ActionBridgeSignedRequest, 'signature'>): string {
  return [
    input.method.toUpperCase(),
    input.path,
    input.timestamp,
    input.nonce,
    input.connectorId,
    createActionBridgeBodyDigest(input.body || ''),
  ].join('\n');
}

export function signActionBridgeBackendRequest(input: Omit<ActionBridgeSignedRequest, 'signature'> & { sharedSecret: string }): string {
  return `sha256=${crypto.createHmac('sha256', input.sharedSecret).update(createActionBridgeSignaturePayload(input)).digest('hex')}`;
}

export async function verifyActionBridgeBackendRequest(input: ActionBridgeSignedRequest & {
  sharedSecret: string;
  expectedConnectorId: string;
  replayCache: ActionBridgeReplayCache;
  now?: Date;
  maxSkewSeconds?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!input.timestamp || !input.nonce || !input.connectorId || !input.signature) return { ok: false, error: 'ACTIONBRIDGE_SIGNATURE_HEADERS_MISSING' };
  if (input.connectorId !== input.expectedConnectorId) return { ok: false, error: 'ACTIONBRIDGE_CONNECTOR_MISMATCH' };
  const nowMs = (input.now || new Date()).getTime();
  const timestampMs = Number(input.timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > (input.maxSkewSeconds || 300) * 1000) return { ok: false, error: 'ACTIONBRIDGE_SIGNATURE_EXPIRED' };
  const expected = signActionBridgeBackendRequest(input);
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(input.signature);
  if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
    return { ok: false, error: 'ACTIONBRIDGE_SIGNATURE_INVALID' };
  }
  if (!(await input.replayCache.setIfAbsent(input.nonce, 600))) return { ok: false, error: 'ACTIONBRIDGE_REPLAY_BLOCKED' };
  return { ok: true };
}

export function createActionBridgeBackendHealth(registration: ActionBridgeBackendRegistration) {
  return {
    ok: true,
    version: registration.version || '0.1.0',
    platform: registration.platform || 'custom_backend',
    targetId: registration.targetId,
    connectorId: registration.connectorId,
    enabledCapabilities: normalizeActionBridgeBackendCapabilities(registration.capabilities),
    writesEnabled: false,
  };
}

export async function dispatchActionBridgeBackendCapability(registration: ActionBridgeBackendRegistration, input: {
  capability: unknown;
  payload: unknown;
  requestId?: string;
  dryRun?: boolean;
}) {
  const capability = sanitizeActionBridgeBackendCapability(input.capability);
  if (!capability) return { ok: false, error: 'ACTIONBRIDGE_CAPABILITY_INVALID' };
  if (!normalizeActionBridgeBackendCapabilities(registration.capabilities).includes(capability)) return { ok: false, error: 'ACTIONBRIDGE_CAPABILITY_NOT_ENABLED' };
  if (capability.startsWith('backend.write_draft:') && input.dryRun !== false) return { ok: false, error: 'ACTIONBRIDGE_WRITE_REQUIRES_APPROVED_LIVE_DISPATCH' };
  const handler = registration.handlers[capability];
  if (!handler) return { ok: false, error: 'ACTIONBRIDGE_HANDLER_NOT_REGISTERED' };
  const result = await handler(input.payload, {
    targetId: registration.targetId,
    connectorId: registration.connectorId,
    capability,
    requestId: input.requestId,
    dryRun: input.dryRun,
  });
  return { ok: true, result };
}
