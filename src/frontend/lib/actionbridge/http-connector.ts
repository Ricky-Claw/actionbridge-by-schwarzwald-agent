import 'server-only';

import type { ActionBridgeActionDefinition, ActionBridgeConnector } from './types';
import { isActionBridgeBlockedHost, isActionBridgePrivateIpAddress } from './dns-ip-guard';
import { redactActionBridgeValue } from './redaction';

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

// Compatibility wrappers keep existing route contracts stable while DNS/IP guard logic lives in dns-ip-guard.ts.
export function isPrivateIpAddress(hostname: string): boolean {
  return isActionBridgePrivateIpAddress(hostname);
}

export function isPrivateActionBridgeHost(hostname: string): boolean {
  return isActionBridgeBlockedHost(hostname);
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
  if (target.protocol !== 'https:') {
    return { ok: false, status: 400, redactedInput, error: 'Unsupported connector protocol. HTTPS is required.' };
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
