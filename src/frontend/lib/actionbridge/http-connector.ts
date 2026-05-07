import 'server-only';

import type { ActionBridgeActionDefinition, ActionBridgeConnector } from './types';
import { redactActionBridgeValue } from './redaction';
import { isPrivateIpAddress } from '../security/safe-fetch';

export interface ExecuteHttpActionConnectorInput {
  connector: ActionBridgeConnector;
  action: ActionBridgeActionDefinition;
  input: Record<string, unknown>;
  method?: 'GET' | 'POST';
  path?: string;
  secretValue?: string;
}

export interface ExecuteHttpActionConnectorResult {
  ok: boolean;
  status: number;
  redactedInput: unknown;
  data?: unknown;
  error?: string;
}

const PRIVATE_HOST_PREFIXES = ['127.', '10.', '172.', '192.168', '169.254'];
const BLOCKED_HOSTS = new Set(['localhost', '0.0.0.0', '::', '::1']);

export function isPrivateActionBridgeHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTS.has(normalized)) return true;
  if (isPrivateIpAddress(normalized)) return true;
  if (PRIVATE_HOST_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true;
  return normalized.endsWith('.local') || normalized.endsWith('.internal');
}

function buildActionBridgeRequestInit(method: 'GET' | 'POST', input: Record<string, unknown>): RequestInit {
  return {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(input) : undefined,
  };
}

export async function executeHttpActionConnector(
  request: ExecuteHttpActionConnectorInput
): Promise<ExecuteHttpActionConnectorResult> {
  const redactedInput = redactActionBridgeValue(request.input);

  if (!request.connector.enabled || !request.action.enabled) {
    return { ok: false, status: 403, redactedInput, error: 'Connector or action disabled.' };
  }

  const target = new URL(request.path || '/', request.connector.baseUrl);
  if (!['http:', 'https:'].includes(target.protocol)) {
    return { ok: false, status: 400, redactedInput, error: 'Unsupported connector protocol.' };
  }

  if (isPrivateActionBridgeHost(target.hostname)) {
    return { ok: false, status: 400, redactedInput, error: 'Private connector host is not allowed.' };
  }

  const method = request.method || 'POST';
  const requestInit = buildActionBridgeRequestInit(method, request.input);
  void requestInit;

  // MVP skeleton: no network call until DNS pinning, allowlists, audit persistence and approval execution are fully reviewed.
  return {
    ok: false,
    status: 501,
    redactedInput,
    error: 'HTTP ActionBridge execution is not enabled until policy, SSRF, audit, and approval persistence are wired.',
  };
}
