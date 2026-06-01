import 'server-only';

import { isPrivateActionBridgeHost } from './http-connector';
import { digestActionBridgeSetupLinkToken } from './setup-links';
import type { ActionBridgeSetupVerificationMethod } from './setup-links';

const ACTIONBRIDGE_DEFAULT_PUBLIC_BRIDGE_ORIGIN = 'https://actionbridge.schwarzwald-agent.de';

export interface ActionBridgeSetupSessionRecord {
  id: string;
  target_origin: string;
  connector_id?: string | null;
  status: 'pending' | 'opened' | 'completed' | 'revoked' | 'expired';
  allowed_methods: ActionBridgeSetupVerificationMethod[];
  expires_at: string;
}

export interface ActionBridgeSetupSessionConnectorSnapshot {
  id: string;
  type: string;
  enabled: boolean;
  safety_status: 'untested' | 'pass' | 'fail' | string;
  permission_status: 'draft' | 'active' | 'paused' | 'revoked' | string;
  network_execution_enabled: boolean;
}

export interface ActionBridgeSetupSessionBridgeSnapshot {
  status: 'connected' | 'stale' | 'revoked' | 'missing';
  last_seen_at?: string | null;
}

export interface ActionBridgeSetupSessionCapabilitySnapshot {
  name: string;
  enabled: boolean;
}

export interface ActionBridgeSetupSessionViewOptions {
  connector?: ActionBridgeSetupSessionConnectorSnapshot | null;
  bridge?: ActionBridgeSetupSessionBridgeSnapshot | null;
  capabilityRules?: ActionBridgeSetupSessionCapabilitySnapshot[];
  bridgePublicOrigin?: string | null;
}

export interface ActionBridgeSetupSessionView {
  id: string;
  targetOrigin: string;
  status: ActionBridgeSetupSessionRecord['status'];
  allowedMethods: ActionBridgeSetupVerificationMethod[];
  canIssueVerificationChallenge: boolean;
  verification: Array<{
    method: ActionBridgeSetupVerificationMethod;
    label: string;
    description: string;
  }>;
  bridgeInstall: {
    mode: 'script_pending' | 'connected_only';
    publicOrigin: string;
    snippet: string;
    status: 'script_pending' | 'connected' | 'stale' | 'revoked';
    lastSeenAt?: string | null;
  };
  connector: {
    id: string | null;
    type: string | null;
    enabled: boolean;
    safetyStatus: string;
    permissionStatus: string;
    networkExecutionEnabled: false;
  };
  capabilityChoices: Array<{
    name: string;
    label: string;
    riskLevel: 'read' | 'write';
    requiresApproval: boolean;
    enabled: boolean;
  }>;
  connectionTest: {
    status: 'waiting_for_connector' | 'waiting_for_verification' | 'waiting_for_permissions' | 'waiting_for_bridge' | 'ready_catalog_only' | 'needs_attention';
    verified: boolean;
    bridgeConnected: boolean;
    enabledCapabilities: string[];
    networkExecution: false;
  };
  expiresAt: string;
}

function isLocalActionBridgeDevHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

export function normalizeActionBridgeSetupBridgePublicOrigin(value: unknown, options: { allowLocalHttp?: boolean } = {}): string | null {
  if (typeof value !== 'string') return null;
  const trimmedValue = value.trim();
  if (trimmedValue !== value || !/^https:\/\//.test(trimmedValue)) {
    if (!(options.allowLocalHttp === true && /^http:\/\//.test(trimmedValue))) return null;
  }
  let parsedUrl: URL;
  try { parsedUrl = new URL(trimmedValue); } catch { return null; }

  if (parsedUrl.username || parsedUrl.password) return null;
  if (parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) return null;

  if (parsedUrl.protocol === 'https:') {
    if (isPrivateActionBridgeHost(parsedUrl.hostname)) return null;
    return parsedUrl.origin;
  }

  if (options.allowLocalHttp === true && parsedUrl.protocol === 'http:' && isLocalActionBridgeDevHostname(parsedUrl.hostname)) {
    return parsedUrl.origin;
  }

  return null;
}

export function resolveActionBridgeSetupBridgePublicOrigin(requestOrigin?: string | null): string {
  const envOrigin = normalizeActionBridgeSetupBridgePublicOrigin(process.env.ACTIONBRIDGE_PUBLIC_BASE_URL);
  if (envOrigin) return envOrigin;

  const localRequestOrigin = normalizeActionBridgeSetupBridgePublicOrigin(requestOrigin, { allowLocalHttp: true });
  if (process.env.NODE_ENV !== 'production' && localRequestOrigin?.startsWith('http://')) return localRequestOrigin;

  return ACTIONBRIDGE_DEFAULT_PUBLIC_BRIDGE_ORIGIN;
}

export function digestActionBridgeSetupSessionToken(token: string): string {
  return digestActionBridgeSetupLinkToken(token);
}

export function createActionBridgeSetupSessionView(record: ActionBridgeSetupSessionRecord, options: ActionBridgeSetupSessionViewOptions = {}): ActionBridgeSetupSessionView {
  const allowedMethods = record.allowed_methods || ['meta_tag', 'dns_txt', 'well_known'];
  const capabilityRules = new Map((options.capabilityRules || []).map((rule) => [rule.name, rule.enabled]));
  const connector = options.connector || null;
  const bridge = options.bridge || null;
  const verified = Boolean(connector?.enabled && connector.safety_status === 'pass' && connector.permission_status === 'active');
  const bridgeConnected = bridge?.status === 'connected';
  const bridgeStatus = bridge?.status === 'connected' || bridge?.status === 'stale' || bridge?.status === 'revoked' ? bridge.status : 'script_pending';
  const bridgePublicOrigin = normalizeActionBridgeSetupBridgePublicOrigin(options.bridgePublicOrigin, { allowLocalHttp: process.env.NODE_ENV !== 'production' }) || ACTIONBRIDGE_DEFAULT_PUBLIC_BRIDGE_ORIGIN;
  const capabilityChoices = [
    { name: 'site.knowledge.read', label: 'Website-Wissen lesen', riskLevel: 'read' as const, requiresApproval: false, enabled: capabilityRules.get('site.knowledge.read') === true },
    { name: 'lead.prepare_draft', label: 'Lead/Kontaktanfrage vorbereiten', riskLevel: 'write' as const, requiresApproval: true, enabled: capabilityRules.get('lead.prepare_draft') === true },
    { name: 'appointment.request.prepare_draft', label: 'Terminwunsch vorbereiten', riskLevel: 'write' as const, requiresApproval: true, enabled: capabilityRules.get('appointment.request.prepare_draft') === true },
  ];
  const enabledCapabilities = capabilityChoices.filter((choice) => choice.enabled).map((choice) => choice.name);
  const needsAttention = Boolean(connector && (!connector.enabled || connector.safety_status === 'fail' || connector.permission_status === 'paused' || connector.permission_status === 'revoked' || bridge?.status === 'revoked'));
  const connectionStatus = !connector
    ? 'waiting_for_connector'
    : needsAttention
      ? 'needs_attention'
      : !verified
        ? 'waiting_for_verification'
        : !enabledCapabilities.length
          ? 'waiting_for_permissions'
          : !bridgeConnected
            ? 'waiting_for_bridge'
            : 'ready_catalog_only';
  return {
    id: record.id,
    targetOrigin: record.target_origin,
    status: record.status,
    allowedMethods,
    canIssueVerificationChallenge: Boolean(record.connector_id),
    verification: allowedMethods.map((method) => ({
      method,
      label: method === 'dns_txt' ? 'DNS TXT' : method === 'meta_tag' ? 'Meta Tag' : '.well-known Datei',
      description: method === 'dns_txt'
        ? 'DNS TXT Record setzen, um Domain-Kontrolle zu beweisen.'
        : method === 'meta_tag'
          ? 'Meta Tag in den HTML Head setzen, um Domain-Kontrolle zu beweisen.'
          : 'Verifikationsdatei unter /.well-known/actionbridge-verify.txt veröffentlichen.',
    })),
    bridgeInstall: {
      mode: bridgeConnected ? 'connected_only' : 'script_pending',
      publicOrigin: bridgePublicOrigin,
      snippet: `<script src="${bridgePublicOrigin}/actionbridge/bridge.js" data-endpoint="${bridgePublicOrigin}/api/actionbridge/bridge/handshake" data-setup-token="SETUP_TOKEN_SHOWN_ONCE" async></script>`,
      status: bridgeStatus,
      lastSeenAt: bridge?.last_seen_at || null,
    },
    connector: {
      id: record.connector_id || null,
      type: connector?.type || null,
      enabled: connector?.enabled === true,
      safetyStatus: connector?.safety_status || 'untested',
      permissionStatus: connector?.permission_status || 'draft',
      networkExecutionEnabled: false,
    },
    capabilityChoices,
    connectionTest: {
      status: connectionStatus,
      verified,
      bridgeConnected,
      enabledCapabilities,
      networkExecution: false,
    },
    expiresAt: record.expires_at,
  };
}

export function isActionBridgeSetupSessionUsable(record: Pick<ActionBridgeSetupSessionRecord, 'status' | 'expires_at'>): boolean {
  if (record.status !== 'pending' && record.status !== 'opened') return false;
  return new Date(record.expires_at).getTime() > Date.now();
}
