import 'server-only';

import crypto from 'node:crypto';
import { isPrivateActionBridgeHost } from './http-connector';

export type ActionBridgeSetupLinkStatus = 'pending' | 'opened' | 'completed' | 'revoked' | 'expired';
export type ActionBridgeSetupVerificationMethod = 'meta_tag' | 'dns_txt' | 'well_known';

export interface ActionBridgeSetupLinkDraft {
  targetOrigin: string;
  token: string;
  tokenDigest: string;
  allowedMethods: ActionBridgeSetupVerificationMethod[];
  expiresAt: string;
  setupPath: string;
}

export function normalizeActionBridgeSetupLinkOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value);
  } catch {
    return null;
  }
  if (parsedUrl.protocol !== 'https:') return null;
  if (parsedUrl.username || parsedUrl.password) return null;
  if (parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) return null;
  if (isPrivateActionBridgeHost(parsedUrl.hostname)) return null;
  return parsedUrl.origin;
}

export function createActionBridgeSetupLinkToken(): string {
  return `absl_${crypto.randomBytes(24).toString('base64url')}`;
}

export function digestActionBridgeSetupLinkToken(token: string): string {
  return `sha256:${crypto.createHash('sha256').update(token).digest('hex')}`;
}

export function createActionBridgeSetupLinkDraft(input: {
  targetOrigin: unknown;
  token?: string;
  now?: Date;
}): ActionBridgeSetupLinkDraft | null {
  const targetOrigin = normalizeActionBridgeSetupLinkOrigin(input.targetOrigin);
  if (!targetOrigin) return null;
  const token = input.token || createActionBridgeSetupLinkToken();
  const expiresAt = new Date((input.now || new Date()).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
  return {
    targetOrigin,
    token,
    tokenDigest: digestActionBridgeSetupLinkToken(token),
    allowedMethods: ['meta_tag', 'dns_txt', 'well_known'],
    expiresAt,
    setupPath: `/actionbridge/setup?token=${encodeURIComponent(token)}`,
  };
}
