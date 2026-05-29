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

export interface ActionBridgeSetupOriginBindingConnector {
  base_url?: unknown;
  baseUrl?: unknown;
  allowed_origins?: unknown;
  allowedOrigins?: unknown;
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

export function normalizeActionBridgeConnectorBindingOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value);
  } catch {
    return null;
  }
  if (parsedUrl.protocol !== 'https:') return null;
  if (parsedUrl.username || parsedUrl.password) return null;
  if (isPrivateActionBridgeHost(parsedUrl.hostname)) return null;
  return parsedUrl.origin;
}

export function actionBridgeConnectorAllowsSetupTargetOrigin(
  connector: ActionBridgeSetupOriginBindingConnector,
  targetOrigin: unknown,
): boolean {
  const normalizedTargetOrigin = normalizeActionBridgeSetupLinkOrigin(targetOrigin);
  if (!normalizedTargetOrigin) return false;

  const connectorOrigins = new Set<string>();
  const baseOrigin = normalizeActionBridgeConnectorBindingOrigin(connector.base_url ?? connector.baseUrl);
  if (!baseOrigin) return false;
  connectorOrigins.add(baseOrigin);

  const allowedOrigins = Array.isArray(connector.allowed_origins)
    ? connector.allowed_origins
    : Array.isArray(connector.allowedOrigins)
      ? connector.allowedOrigins
      : [];
  for (const allowedOrigin of allowedOrigins) {
    const normalizedAllowedOrigin = normalizeActionBridgeConnectorBindingOrigin(allowedOrigin);
    if (normalizedAllowedOrigin) connectorOrigins.add(normalizedAllowedOrigin);
  }

  return connectorOrigins.has(normalizedTargetOrigin);
}

type ActionBridgeSupabaseLike = { from: (table: string) => any };

export type ActionBridgeConnectorSetupTargetOriginBindingStatus = 'matched' | 'connector_not_found' | 'origin_mismatch';

export async function verifyActionBridgeConnectorSetupTargetOriginBinding(
  supabase: ActionBridgeSupabaseLike,
  input: { userId: string; connectorId: string; targetOrigin: unknown },
): Promise<ActionBridgeConnectorSetupTargetOriginBindingStatus> {
  const { data: connector } = await supabase
    .from('actionbridge_connectors')
    .select('id,base_url,allowed_origins')
    .eq('user_id', input.userId)
    .eq('id', input.connectorId)
    .maybeSingle();

  if (!connector) return 'connector_not_found';
  if (!actionBridgeConnectorAllowsSetupTargetOrigin(connector, input.targetOrigin)) return 'origin_mismatch';
  return 'matched';
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
