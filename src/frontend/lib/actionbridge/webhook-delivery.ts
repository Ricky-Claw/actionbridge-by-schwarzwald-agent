import 'server-only';

import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import https from 'node:https';
import type { ActionBridgeRiskLevel } from './types';
import { decideActionBridgeDnsPinning } from './dns-ip-guard';
import { enforceActionBridgeResponseByteLimit } from './response-limits';
import { redactActionBridgeValue } from './redaction';
import { validateActionBridgeTarget, type ActionBridgeTargetAllowlistEntry } from './target-validation';

export interface ActionBridgeWebhookDeliveryInput {
  connector: {
    id: string;
    baseUrl: string;
    enabled: boolean;
  };
  action: {
    id?: string | null;
    name: string;
    riskLevel: ActionBridgeRiskLevel;
  };
  approval: {
    id: string;
    idempotencyKeyDigest: string;
    approvedAt?: string | null;
  };
  tenantId: string;
  executionId: string;
  payload: Record<string, unknown>;
  path?: string;
  allowlist: ActionBridgeTargetAllowlistEntry[];
  signingSecret?: string | null;
}

export interface ActionBridgeWebhookDeliveryResult {
  ok: boolean;
  status: number;
  networkExecution: boolean;
  resultSummary: Record<string, unknown>;
}

interface PinnedWebhookResponse {
  ok: boolean;
  status: number;
  text: string;
}

function safeWebhookPath(path: string | undefined): string {
  const candidate = typeof path === 'string' && path.trim() ? path.trim() : '/';
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate) || candidate.startsWith('//')) return '/';
  const noHash = candidate.split('#', 1)[0] || '/';
  const noQuery = noHash.split('?', 1)[0] || '/';
  return noQuery.startsWith('/') ? noQuery : `/${noQuery}`;
}

function createSignature(secret: string, timestamp: string, body: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

function postPinnedHttpsJson(input: {
  target: URL;
  pinnedAddress: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  maxBytes: number;
}): Promise<PinnedWebhookResponse> {
  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: 'https:',
      host: input.pinnedAddress,
      servername: input.target.hostname,
      port: input.target.port ? Number(input.target.port) : 443,
      method: 'POST',
      path: `${input.target.pathname}${input.target.search}`,
      timeout: input.timeoutMs,
      headers: {
        ...input.headers,
        Host: input.target.host,
        'Content-Length': Buffer.byteLength(input.body).toString(),
      },
    }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        resolve({ ok: false, status, text: 'ActionBridge webhook redirect blocked.' });
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes <= input.maxBytes) chunks.push(buffer);
      });
      response.on('end', () => {
        resolve({ ok: status >= 200 && status < 300, status, text: Buffer.concat(chunks).toString('utf8') });
      });
    });
    request.on('timeout', () => request.destroy(new Error('ACTIONBRIDGE_WEBHOOK_TIMEOUT')));
    request.on('error', reject);
    request.write(input.body);
    request.end();
  });
}

export function createActionBridgeWebhookPayload(input: ActionBridgeWebhookDeliveryInput): Record<string, unknown> {
  return redactActionBridgeValue({
    version: 'actionbridge.webhook.v1',
    eventId: input.executionId,
    tenantId: input.tenantId,
    connectorId: input.connector.id,
    actionName: input.action.name,
    riskLevel: input.action.riskLevel,
    approvalId: input.approval.id,
    idempotencyKeyDigest: input.approval.idempotencyKeyDigest,
    approvedAt: input.approval.approvedAt || null,
    payload: input.payload,
  }) as Record<string, unknown>;
}

export async function deliverActionBridgeWebhook(
  input: ActionBridgeWebhookDeliveryInput
): Promise<ActionBridgeWebhookDeliveryResult> {
  if (!input.connector.enabled) {
    return { ok: false, status: 403, networkExecution: false, resultSummary: { status: 'webhook_blocked', reason: 'Connector disabled.', networkExecution: false } };
  }
  if (input.action.riskLevel === 'destructive' || input.action.riskLevel === 'transactional') {
    return { ok: false, status: 403, networkExecution: false, resultSummary: { status: 'webhook_blocked', reason: 'Webhook-v1 does not support transactional/destructive actions.', networkExecution: false } };
  }

  const path = safeWebhookPath(input.path);
  const targetValidation = validateActionBridgeTarget({ connector: { baseUrl: input.connector.baseUrl }, path, allowlist: input.allowlist });
  if (!targetValidation.ok || !targetValidation.url) {
    return { ok: false, status: 403, networkExecution: false, resultSummary: { status: 'webhook_blocked', reason: targetValidation.reason || 'Webhook target is not allowed.', networkExecution: false } };
  }

  const target = new URL(targetValidation.url);
  const addresses = await dns.lookup(target.hostname, { all: true, verbatim: true });
  const dnsDecision = decideActionBridgeDnsPinning({
    hostname: target.hostname,
    addresses: addresses.map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 })),
    networkExecution: false,
  });
  if (!dnsDecision.ok) {
    return { ok: false, status: 403, networkExecution: false, resultSummary: { status: 'webhook_blocked', reason: dnsDecision.reason, dns: dnsDecision, networkExecution: false } };
  }
  const pinnedAddress = addresses[0]?.address;
  if (!pinnedAddress) {
    return { ok: false, status: 403, networkExecution: false, resultSummary: { status: 'webhook_blocked', reason: 'DNS resolution returned no addresses.', networkExecution: false } };
  }

  const body = JSON.stringify(createActionBridgeWebhookPayload(input));
  const timestamp = new Date().toISOString();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'ActionBridge-Webhook/1.0',
    'X-ActionBridge-Version': 'actionbridge.webhook.v1',
    'X-ActionBridge-Timestamp': timestamp,
    'X-ActionBridge-Event-Id': input.executionId,
    'X-ActionBridge-Idempotency-Digest': input.approval.idempotencyKeyDigest,
  };
  if (input.signingSecret) headers['X-ActionBridge-Signature'] = createSignature(input.signingSecret, timestamp, body);

  // Connection-pinned HTTPS: resolve once, validate every returned address, then connect to the
  // selected validated IP while preserving the original Host/SNI. Do not use fetch() here; a
  // separate runtime resolver between validation and connect would reopen DNS rebinding SSRF risk.
  const response = await postPinnedHttpsJson({
    target,
    pinnedAddress,
    timeoutMs: 5000,
    maxBytes: 8192,
    headers,
    body,
  });
  const responseText = response.text;
  const limit = enforceActionBridgeResponseByteLimit(responseText);
  const responseSummary = limit.ok ? redactActionBridgeValue({ textPreview: responseText.slice(0, 500) }) : { reason: limit.reason, bytes: limit.bytes };

  return {
    ok: response.ok,
    status: response.status,
    networkExecution: true,
    resultSummary: {
      status: response.ok ? 'webhook_delivered' : 'webhook_failed',
      httpStatus: response.status,
      targetOrigin: target.origin,
      targetPath: target.pathname,
      pinnedAddressFamily: pinnedAddress.includes(':') ? 6 : 4,
      response: responseSummary,
      networkExecution: true,
    },
  };
}
