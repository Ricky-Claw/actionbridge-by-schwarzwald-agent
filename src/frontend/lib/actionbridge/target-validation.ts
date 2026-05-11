import type { ActionBridgeConnector } from './types';
import { isPrivateActionBridgeHost } from './http-connector';

export interface ActionBridgeTargetAllowlistEntry {
  protocol: 'https:';
  hostname: string;
  port?: string;
}

export interface ValidateActionBridgeTargetInput {
  connector: Pick<ActionBridgeConnector, 'baseUrl'>;
  path?: string;
  allowlist?: ActionBridgeTargetAllowlistEntry[];
}

export interface ActionBridgeTargetValidationResult {
  ok: boolean;
  url?: string;
  protocol?: string;
  hostname?: string;
  reason?: string;
  networkExecution: false;
}

// Empty allowlist is intentional: connector execution must be explicitly enabled per target.
export const defaultDenyActionBridgeAllowlist: ActionBridgeTargetAllowlistEntry[] = [];

function matchesAllowlist(target: URL, allowlist: ActionBridgeTargetAllowlistEntry[]): boolean {
  return allowlist.some((entry) => {
    const hostnameMatches = entry.hostname.toLowerCase() === target.hostname.toLowerCase();
    const protocolMatches = entry.protocol === target.protocol;
    const portMatches = entry.port === undefined || entry.port === target.port;
    return hostnameMatches && protocolMatches && portMatches;
  });
}

function isAbsoluteUrlPath(path: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(path.trim()) || path.trim().startsWith('//');
}

export function validateActionBridgeTarget(
  input: ValidateActionBridgeTargetInput
): ActionBridgeTargetValidationResult {
  if (input.path && isAbsoluteUrlPath(input.path)) {
    return { ok: false, reason: 'Absolute connector paths are not allowed.', networkExecution: false };
  }

  let target: URL;
  try {
    target = new URL(input.path || '/', input.connector.baseUrl);
  } catch {
    return { ok: false, reason: 'Invalid connector target URL.', networkExecution: false };
  }

  if (target.protocol !== 'https:') {
    return {
      ok: false,
      protocol: target.protocol,
      hostname: target.hostname,
      reason: 'Unsupported connector protocol. HTTPS is required.',
      networkExecution: false,
    };
  }

  if (target.username || target.password) {
    return {
      ok: false,
      protocol: target.protocol,
      hostname: target.hostname,
      reason: 'Connector target userinfo is not allowed.',
      networkExecution: false,
    };
  }

  if (isPrivateActionBridgeHost(target.hostname)) {
    return {
      ok: false,
      protocol: target.protocol,
      hostname: target.hostname,
      reason: 'Private connector host is not allowed.',
      networkExecution: false,
    };
  }

  const allowlist = input.allowlist || defaultDenyActionBridgeAllowlist;
  if (!matchesAllowlist(target, allowlist)) {
    return {
      ok: false,
      url: target.toString(),
      protocol: target.protocol,
      hostname: target.hostname,
      reason: 'Connector target is not in the explicit allowlist.',
      networkExecution: false,
    };
  }

  return {
    ok: true,
    url: target.toString(),
    protocol: target.protocol,
    hostname: target.hostname,
    networkExecution: false,
  };
}
