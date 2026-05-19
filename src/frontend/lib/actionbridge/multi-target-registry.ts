import 'server-only';

import { createHash } from 'node:crypto';
import { isPrivateActionBridgeHost } from './http-connector';
import type {
  ActionBridgeConnectionStatus,
  ActionBridgeOwnershipStatus,
  ActionBridgeProviderId,
  ActionBridgeScriptStatus,
  ActionBridgeTarget,
  ActionBridgeTenantId,
} from './types';

export const ACTIONBRIDGE_DEFAULT_PROVIDER_ID = 'schwarzwald-agent' as const;
export const ACTIONBRIDGE_DEFAULT_BRIDGE_ORIGIN = 'https://bridge.schwarzwald-agent.de' as const;

export const ACTIONBRIDGE_ARCHIPEL_PILOT_URLS = [
  'https://pflasterarbeiten24.de',
  'https://briefe-beschriften.de',
  'https://porto-rechner24.de',
  'https://vorlage-quittung.de',
  'https://rechnung-ohne-mehrwertsteuer.de',
  'https://brutto-netto-rechner-teilzeit.de',
  'https://lebenslauf-vorlage-kostenlos.de',
  'https://projekt-archipel.de',
] as const;

export const ACTIONBRIDGE_TARGET_READONLY_CAPABILITIES = [
  'actionbridge.targets.list',
  'actionbridge.target.status',
  'actionbridge.target.capabilities',
  'actionbridge.target.health_check',
] as const;

export interface ActionBridgeTargetRegistryScope {
  providerId: ActionBridgeProviderId;
  tenantId: ActionBridgeTenantId;
  ownerUserId?: string;
  bridgeOrigin?: string;
}

export interface ActionBridgeTargetUrlNormalizationResult {
  ok: boolean;
  input: string;
  url?: string;
  origin?: string;
  hostname?: string;
  reason?: string;
  networkExecution: false;
}

export interface ActionBridgeTargetCheckSignals {
  ownershipStatus?: ActionBridgeOwnershipStatus;
  htmlReachable?: boolean;
  bridgeScriptFound?: boolean;
  handshakeSeen?: boolean;
  error?: string;
}

export interface ActionBridgeTargetIntakeResult {
  accepted: ActionBridgeTarget[];
  rejected: Array<{ input: string; reason: string }>;
  duplicates: Array<{ input: string; origin: string }>;
}

export interface ActionBridgeTargetToolCatalog {
  version: 'actionbridge.targets.v1';
  providerId: ActionBridgeProviderId;
  tenantId: ActionBridgeTenantId;
  bridgeOrigin: string;
  tools: Array<{
    name: typeof ACTIONBRIDGE_TARGET_READONLY_CAPABILITIES[number];
    description: string;
    riskLevel: 'read';
    requiresApproval: false;
    inputSchema: Array<{ name: string; type: 'string'; required: boolean; description: string }>;
  }>;
  targets: Array<Pick<ActionBridgeTarget, 'id' | 'tenantId' | 'url' | 'origin' | 'hostname' | 'bridgeOrigin' | 'ownershipStatus' | 'scriptStatus' | 'connectionStatus' | 'capabilities'>>;
  execution: { mode: 'read_only'; networkExecution: false };
}

function stableActionBridgeTargetId(providerId: string, tenantId: string, origin: string): string {
  const digest = createHash('sha256').update(`${providerId}:${tenantId}:${origin}`).digest('hex').slice(0, 24);
  return `abtg_${digest}`;
}

function normalizeBridgeOrigin(bridgeOrigin: string | undefined): string {
  const candidate = bridgeOrigin || ACTIONBRIDGE_DEFAULT_BRIDGE_ORIGIN;
  const parsed = new URL(candidate);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || isPrivateActionBridgeHost(parsed.hostname)) {
    throw new Error('Invalid ActionBridge bridge origin. HTTPS public origin is required.');
  }
  return parsed.origin;
}

export function normalizeActionBridgeTargetUrl(input: string): ActionBridgeTargetUrlNormalizationResult {
  const raw = input.trim();
  if (!raw) return { ok: false, input, reason: 'URL is empty.', networkExecution: false };

  let parsed: URL;
  try {
    parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    return { ok: false, input, reason: 'Invalid URL.', networkExecution: false };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, input, reason: 'Only HTTPS target URLs are allowed.', networkExecution: false };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, input, reason: 'Target URL userinfo is not allowed.', networkExecution: false };
  }
  if (isPrivateActionBridgeHost(parsed.hostname)) {
    return { ok: false, input, reason: 'Private, local, or internal target hosts are not allowed.', networkExecution: false };
  }

  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = '/';

  return {
    ok: true,
    input,
    url: parsed.toString(),
    origin: parsed.origin,
    hostname: parsed.hostname.toLowerCase(),
    networkExecution: false,
  };
}

export function classifyActionBridgeTargetConnection(signals: ActionBridgeTargetCheckSignals): {
  ownershipStatus: ActionBridgeOwnershipStatus;
  scriptStatus: ActionBridgeScriptStatus;
  connectionStatus: ActionBridgeConnectionStatus;
} {
  const ownershipStatus = signals.ownershipStatus || 'pending';
  let scriptStatus: ActionBridgeScriptStatus = 'unknown';

  if (signals.error) scriptStatus = 'error';
  else if (signals.htmlReachable === false) scriptStatus = 'unreachable';
  else if (signals.bridgeScriptFound === false) scriptStatus = 'missing_script';
  else if (signals.bridgeScriptFound && signals.handshakeSeen) scriptStatus = 'connected';
  else if (signals.bridgeScriptFound && !signals.handshakeSeen) scriptStatus = 'script_found_no_handshake';

  let connectionStatus: ActionBridgeConnectionStatus = 'pending';
  if (scriptStatus === 'connected' && ownershipStatus === 'verified') connectionStatus = 'connected';
  else if (scriptStatus === 'missing_script') connectionStatus = 'missing_script';
  else if (scriptStatus === 'unreachable') connectionStatus = 'unreachable';
  else if (scriptStatus === 'error' || ownershipStatus === 'failed') connectionStatus = 'error';
  else if (ownershipStatus === 'unverified') connectionStatus = 'unverified';

  return { ownershipStatus, scriptStatus, connectionStatus };
}

export function createActionBridgeTarget(input: {
  scope: ActionBridgeTargetRegistryScope;
  url: string;
  now?: string;
  checkSignals?: ActionBridgeTargetCheckSignals;
  capabilities?: string[];
}): ActionBridgeTarget {
  const normalized = normalizeActionBridgeTargetUrl(input.url);
  if (!normalized.ok || !normalized.url || !normalized.origin || !normalized.hostname) {
    throw new Error(normalized.reason || 'Invalid ActionBridge target URL.');
  }
  const bridgeOrigin = normalizeBridgeOrigin(input.scope.bridgeOrigin);
  const status = classifyActionBridgeTargetConnection(input.checkSignals || {});
  const now = input.now || new Date().toISOString();

  return {
    id: stableActionBridgeTargetId(input.scope.providerId, input.scope.tenantId, normalized.origin),
    providerId: input.scope.providerId,
    tenantId: input.scope.tenantId,
    ownerUserId: input.scope.ownerUserId,
    url: normalized.url,
    origin: normalized.origin,
    hostname: normalized.hostname,
    bridgeOrigin,
    ownershipStatus: status.ownershipStatus,
    scriptStatus: status.scriptStatus,
    connectionStatus: status.connectionStatus,
    capabilities: input.capabilities || [...ACTIONBRIDGE_TARGET_READONLY_CAPABILITIES],
    statusMetadata: { networkExecution: false },
    createdAt: now,
    updatedAt: now,
  };
}

export function createActionBridgeTargetsFromUrls(input: {
  scope: ActionBridgeTargetRegistryScope;
  urls: string[];
  now?: string;
}): ActionBridgeTargetIntakeResult {
  const accepted: ActionBridgeTarget[] = [];
  const rejected: ActionBridgeTargetIntakeResult['rejected'] = [];
  const duplicates: ActionBridgeTargetIntakeResult['duplicates'] = [];
  const seenOrigins = new Set<string>();

  for (const url of input.urls) {
    const normalized = normalizeActionBridgeTargetUrl(url);
    if (!normalized.ok || !normalized.origin) {
      rejected.push({ input: url, reason: normalized.reason || 'Invalid URL.' });
      continue;
    }
    const dedupeKey = `${input.scope.providerId}:${input.scope.tenantId}:${normalized.origin}`;
    if (seenOrigins.has(dedupeKey)) {
      duplicates.push({ input: url, origin: normalized.origin });
      continue;
    }
    seenOrigins.add(dedupeKey);
    accepted.push(createActionBridgeTarget({ scope: input.scope, url, now: input.now }));
  }

  return { accepted, rejected, duplicates };
}

export function filterActionBridgeTargetsForTenant<T extends Pick<ActionBridgeTarget, 'providerId' | 'tenantId'>>(
  targets: T[],
  scope: Pick<ActionBridgeTargetRegistryScope, 'providerId' | 'tenantId'>
): T[] {
  return targets.filter((target) => target.providerId === scope.providerId && target.tenantId === scope.tenantId);
}

export function createActionBridgeTargetToolCatalog(input: {
  scope: ActionBridgeTargetRegistryScope;
  targets: ActionBridgeTarget[];
}): ActionBridgeTargetToolCatalog {
  const scopedTargets = filterActionBridgeTargetsForTenant(input.targets, input.scope);
  const bridgeOrigin = normalizeBridgeOrigin(input.scope.bridgeOrigin);
  const targetIdField = { name: 'target_id', type: 'string' as const, required: true, description: 'ActionBridge target id within the current tenant.' };
  const tenantIdField = { name: 'tenant_id', type: 'string' as const, required: true, description: 'Tenant/workspace id enforced by ActionBridge.' };

  return {
    version: 'actionbridge.targets.v1',
    providerId: input.scope.providerId,
    tenantId: input.scope.tenantId,
    bridgeOrigin,
    tools: [
      { name: 'actionbridge.targets.list', description: 'List connected ActionBridge targets for the current tenant only.', riskLevel: 'read', requiresApproval: false, inputSchema: [tenantIdField] },
      { name: 'actionbridge.target.status', description: 'Read ownership, script, and connection status for one tenant-scoped target.', riskLevel: 'read', requiresApproval: false, inputSchema: [tenantIdField, targetIdField] },
      { name: 'actionbridge.target.capabilities', description: 'Read safe capabilities exposed for one tenant-scoped target.', riskLevel: 'read', requiresApproval: false, inputSchema: [tenantIdField, targetIdField] },
      { name: 'actionbridge.target.health_check', description: 'Prepare a read-only health check request for one tenant-scoped target.', riskLevel: 'read', requiresApproval: false, inputSchema: [tenantIdField, targetIdField] },
    ],
    targets: scopedTargets.map((target) => ({
      id: target.id,
      tenantId: target.tenantId,
      url: target.url,
      origin: target.origin,
      hostname: target.hostname,
      bridgeOrigin: target.bridgeOrigin,
      ownershipStatus: target.ownershipStatus,
      scriptStatus: target.scriptStatus,
      connectionStatus: target.connectionStatus,
      capabilities: target.capabilities,
    })),
    execution: { mode: 'read_only', networkExecution: false },
  };
}

export function createActionBridgeArchipelPilotTargets(now = '2026-05-19T12:00:00.000Z'): ActionBridgeTarget[] {
  return createActionBridgeTargetsFromUrls({
    scope: {
      providerId: ACTIONBRIDGE_DEFAULT_PROVIDER_ID,
      tenantId: 'archipel',
      bridgeOrigin: ACTIONBRIDGE_DEFAULT_BRIDGE_ORIGIN,
    },
    urls: [...ACTIONBRIDGE_ARCHIPEL_PILOT_URLS],
    now,
  }).accepted;
}
