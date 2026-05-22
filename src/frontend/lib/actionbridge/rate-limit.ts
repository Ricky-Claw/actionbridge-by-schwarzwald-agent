import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';

export interface ActionBridgeRateLimitPolicy {
  windowMs: number;
  max: number;
  name: string;
  scope?: 'pilot_process_local' | 'production_distributed_required';
}

export interface ActionBridgeRateLimitResult {
  ok: boolean;
  keyDigest: string;
  remaining: number;
  resetAt: string;
  retryAfterSeconds?: number;
  response?: NextResponse;
}

const DEFAULT_POLICIES: Record<string, ActionBridgeRateLimitPolicy> = {
  setupSession: { name: 'setupSession', windowMs: 60_000, max: 30, scope: 'pilot_process_local' },
  bridgeHandshake: { name: 'bridgeHandshake', windowMs: 60_000, max: 20, scope: 'pilot_process_local' },
  domainVerification: { name: 'domainVerification', windowMs: 60_000, max: 20, scope: 'pilot_process_local' },
  backendBridgePairing: { name: 'backendBridgePairing', windowMs: 60_000, max: 10, scope: 'pilot_process_local' },
  webhookDelivery: { name: 'webhookDelivery', windowMs: 60_000, max: 30, scope: 'pilot_process_local' },
  webhookFailureQuarantine: { name: 'webhookFailureQuarantine', windowMs: 15 * 60_000, max: 5, scope: 'pilot_process_local' },
};

type Bucket = { count: number; resetAtMs: number };
const globalBuckets = globalThis as typeof globalThis & { __actionBridgeRateLimitBuckets?: Map<string, Bucket> };
const buckets = globalBuckets.__actionBridgeRateLimitBuckets || new Map<string, Bucket>();
globalBuckets.__actionBridgeRateLimitBuckets = buckets;
const MAX_PILOT_BUCKETS = 10_000;

export const ACTIONBRIDGE_RATE_LIMIT_MODE = process.env.ACTIONBRIDGE_RATE_LIMIT_MODE === 'production_distributed'
  ? 'production_distributed_required'
  : 'pilot_process_local';

export const ACTIONBRIDGE_TRUSTED_PROXY_HEADER = process.env.ACTIONBRIDGE_TRUSTED_PROXY_HEADER === 'x-vercel-forwarded-for'
  ? 'x-vercel-forwarded-for'
  : process.env.ACTIONBRIDGE_TRUSTED_PROXY_HEADER === 'cf-connecting-ip'
    ? 'cf-connecting-ip'
    : process.env.ACTIONBRIDGE_TRUSTED_PROXY_HEADER === 'x-real-ip'
      ? 'x-real-ip'
      : 'none';

export const ACTIONBRIDGE_PRODUCTION_RATE_LIMIT_REQUIREMENTS = [
  'distributed_atomic_counter_store',
  'trusted_proxy_header_policy',
  'per_tenant_per_connector_per_token_dimensions',
  'success_and_denial_headers',
  'redacted_rate_limit_telemetry',
] as const;

function digestKey(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
}

export function getActionBridgeTrustedClientIdentity(request: NextRequest): {
  trusted: boolean;
  source: typeof ACTIONBRIDGE_TRUSTED_PROXY_HEADER;
  client: string;
} {
  const userAgent = request.headers.get('user-agent')?.slice(0, 120) || 'unknown-agent';
  if (ACTIONBRIDGE_TRUSTED_PROXY_HEADER === 'none') return { trusted: false, source: 'none', client: `untrusted-proxy|${userAgent}` };
  const headerValue = request.headers.get(ACTIONBRIDGE_TRUSTED_PROXY_HEADER)?.split(',')[0]?.trim();
  if (!headerValue) return { trusted: false, source: ACTIONBRIDGE_TRUSTED_PROXY_HEADER, client: `missing-trusted-client|${userAgent}` };
  return { trusted: true, source: ACTIONBRIDGE_TRUSTED_PROXY_HEADER, client: `${headerValue}|${userAgent}` };
}

function clientKey(request: NextRequest): string {
  const identity = getActionBridgeTrustedClientIdentity(request);
  return identity.client;
}

function cleanupExpiredPilotBuckets(nowMs: number) {
  if (buckets.size < MAX_PILOT_BUCKETS) return;
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAtMs <= nowMs) buckets.delete(key);
    if (buckets.size < MAX_PILOT_BUCKETS) return;
  }
}

export function createActionBridgeRateLimitHeaders(result: Pick<ActionBridgeRateLimitResult, 'remaining' | 'resetAt'> & { policyName: string }): Record<string, string> {
  return {
    'X-ActionBridge-RateLimit-Policy': result.policyName,
    'X-ActionBridge-RateLimit-Remaining': String(result.remaining),
    'X-ActionBridge-RateLimit-Reset': result.resetAt,
    'X-ActionBridge-RateLimit-Mode': ACTIONBRIDGE_RATE_LIMIT_MODE,
  };
}

export function decideActionBridgeRateLimit(input: {
  request: NextRequest;
  policy: ActionBridgeRateLimitPolicy;
  discriminator?: string;
  nowMs?: number;
}): ActionBridgeRateLimitResult {
  const nowMs = input.nowMs ?? Date.now();
  cleanupExpiredPilotBuckets(nowMs);
  const identity = getActionBridgeTrustedClientIdentity(input.request);
  const rawKey = `${input.policy.name}|${clientKey(input.request)}|${input.discriminator || ''}`;
  const keyDigest = digestKey(rawKey);
  const bucketKey = `${input.policy.name}:${keyDigest}`;
  const existing = buckets.get(bucketKey);
  const bucket = existing && existing.resetAtMs > nowMs
    ? existing
    : { count: 0, resetAtMs: nowMs + input.policy.windowMs };

  bucket.count += 1;
  buckets.set(bucketKey, bucket);

  const resetAt = new Date(bucket.resetAtMs).toISOString();
  const remaining = Math.max(0, input.policy.max - bucket.count);
  if (ACTIONBRIDGE_RATE_LIMIT_MODE === 'production_distributed_required' && !identity.trusted) {
    return {
      ok: false,
      keyDigest,
      remaining: 0,
      resetAt,
      retryAfterSeconds: 60,
      response: NextResponse.json({
        error: 'ACTIONBRIDGE_TRUSTED_PROXY_REQUIRED',
        rateLimit: {
          policy: input.policy.name,
          keyDigest,
          retryAfterSeconds: 60,
          resetAt,
          trustedProxyHeader: ACTIONBRIDGE_TRUSTED_PROXY_HEADER,
        },
      }, {
        status: 503,
        headers: {
          'Retry-After': '60',
          ...createActionBridgeRateLimitHeaders({ policyName: input.policy.name, remaining: 0, resetAt }),
        },
      }),
    };
  }

  if (bucket.count <= input.policy.max) {
    return { ok: true, keyDigest, remaining, resetAt };
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAtMs - nowMs) / 1000));
  return {
    ok: false,
    keyDigest,
    remaining: 0,
    resetAt,
    retryAfterSeconds,
    response: NextResponse.json({
      error: 'ACTIONBRIDGE_RATE_LIMITED',
      rateLimit: {
        policy: input.policy.name,
        keyDigest,
        retryAfterSeconds,
        resetAt,
      },
    }, {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSeconds),
        ...createActionBridgeRateLimitHeaders({ policyName: input.policy.name, remaining: 0, resetAt }),
      },
    }),
  };
}

export function enforceActionBridgeRateLimit(input: {
  request: NextRequest;
  policyName: keyof typeof DEFAULT_POLICIES;
  discriminator?: string;
}): ActionBridgeRateLimitResult {
  return decideActionBridgeRateLimit({
    request: input.request,
    policy: DEFAULT_POLICIES[input.policyName],
    discriminator: input.discriminator,
  });
}

export function decideActionBridgeWebhookDeliveryThrottle(input: {
  request: NextRequest;
  tenantId: string;
  connectorId: string;
  actionName: string;
  destinationOrigin: string;
}): ActionBridgeRateLimitResult {
  return enforceActionBridgeRateLimit({
    request: input.request,
    policyName: 'webhookDelivery',
    discriminator: `${input.tenantId}|${input.connectorId}|${input.actionName}|${input.destinationOrigin}`,
  });
}

export function recordActionBridgeWebhookFailureQuarantine(input: {
  request: NextRequest;
  tenantId: string;
  connectorId: string;
  actionName: string;
  destinationOrigin: string;
}): ActionBridgeRateLimitResult {
  return enforceActionBridgeRateLimit({
    request: input.request,
    policyName: 'webhookFailureQuarantine',
    discriminator: `${input.tenantId}|${input.connectorId}|${input.actionName}|${input.destinationOrigin}`,
  });
}

export function summarizeActionBridgeRateLimitPolicies(): Record<string, ActionBridgeRateLimitPolicy> {
  return DEFAULT_POLICIES;
}
