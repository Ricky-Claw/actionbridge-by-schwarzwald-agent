import 'server-only';

import dns from 'node:dns/promises';
import type { ActionBridgeActionDefinition, ActionBridgeConnector } from './types';
import { decideActionBridgeDnsPinning } from './dns-ip-guard';
import { enforceActionBridgeResponseByteLimit, defaultActionBridgeResponseLimitPolicy } from './response-limits';
import { redactActionBridgeValue } from './redaction';
import { validateActionBridgeTarget, type ActionBridgeTargetAllowlistEntry } from './target-validation';

export interface ExecuteActionBridgeReadOnlyInput {
  connector: Pick<ActionBridgeConnector, 'id' | 'baseUrl' | 'enabled' | 'type'>;
  action: Pick<ActionBridgeActionDefinition, 'id' | 'name' | 'riskLevel' | 'enabled'>;
  input: Record<string, unknown>;
  path: string;
  allowlist: ActionBridgeTargetAllowlistEntry[];
}

export interface ExecuteActionBridgeReadOnlyResult {
  ok: boolean;
  status: number;
  networkExecution: boolean;
  redactedInput: unknown;
  resultSummary: Record<string, unknown>;
}

function isSafeReadOnlyContentType(contentType: string | null): boolean {
  const normalized = (contentType || '').toLowerCase();
  return normalized.includes('application/json') || normalized.includes('text/plain') || normalized.includes('text/html') || normalized.includes('application/problem+json');
}

function summarizeBody(body: string, contentType: string | null): unknown {
  if ((contentType || '').toLowerCase().includes('application/json')) {
    try {
      return redactActionBridgeValue(JSON.parse(body));
    } catch {
      return { textPreview: body.slice(0, 1000) };
    }
  }
  return { textPreview: body.replace(/<script[\s\S]*?<\/script>/gi, '[redacted-script]').slice(0, 1000) };
}

export async function executeActionBridgeReadOnlyGet(
  request: ExecuteActionBridgeReadOnlyInput
): Promise<ExecuteActionBridgeReadOnlyResult> {
  const redactedInput = redactActionBridgeValue(request.input);
  if (!request.connector.enabled || !request.action.enabled) {
    return { ok: false, status: 403, networkExecution: false, redactedInput, resultSummary: { status: 'read_only_blocked', reason: 'Connector or action disabled.' } };
  }
  if (request.action.riskLevel !== 'read') {
    return { ok: false, status: 403, networkExecution: false, redactedInput, resultSummary: { status: 'read_only_blocked', reason: 'Only read-risk actions may use the read-only executor.' } };
  }

  const targetValidation = validateActionBridgeTarget({ connector: { baseUrl: request.connector.baseUrl }, path: request.path, allowlist: request.allowlist });
  if (!targetValidation.ok || !targetValidation.target) {
    return { ok: false, status: 403, networkExecution: false, redactedInput, resultSummary: { status: 'read_only_blocked', reason: targetValidation.reason, networkExecution: false } };
  }

  const addresses = await dns.lookup(targetValidation.target.hostname, { all: true, verbatim: true });
  const dnsDecision = decideActionBridgeDnsPinning({
    hostname: targetValidation.target.hostname,
    addresses: addresses.map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 })),
    networkExecution: false,
  });
  if (!dnsDecision.ok) {
    return { ok: false, status: 403, networkExecution: false, redactedInput, resultSummary: { status: 'read_only_blocked', reason: dnsDecision.reason, dns: dnsDecision, networkExecution: false } };
  }

  const response = await fetch(targetValidation.target, {
    method: 'GET',
    redirect: 'manual',
    signal: AbortSignal.timeout(5000),
    headers: { Accept: 'application/json,text/plain,text/html;q=0.8' },
  });
  const contentType = response.headers.get('content-type');
  if (!isSafeReadOnlyContentType(contentType)) {
    return { ok: false, status: 415, networkExecution: true, redactedInput, resultSummary: { status: 'read_only_blocked', reason: 'Unsupported response content type.', contentType, networkExecution: true } };
  }
  const body = await response.text();
  const limit = enforceActionBridgeResponseByteLimit(body, defaultActionBridgeResponseLimitPolicy);
  if (!limit.ok) {
    return { ok: false, status: 413, networkExecution: true, redactedInput, resultSummary: { status: 'read_only_blocked', reason: limit.reason, bytes: limit.bytes, networkExecution: true } };
  }

  return {
    ok: response.ok,
    status: response.status,
    networkExecution: true,
    redactedInput,
    resultSummary: {
      status: response.ok ? 'read_only_executed' : 'read_only_http_error',
      httpStatus: response.status,
      contentType,
      bytes: limit.bytes,
      networkExecution: true,
      data: summarizeBody(body, contentType),
    },
  };
}
