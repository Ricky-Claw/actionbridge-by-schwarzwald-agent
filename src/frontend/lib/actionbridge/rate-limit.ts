import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';

export interface ActionBridgeRateLimitPolicy {
  windowMs: number;
  max: number;
  name: string;
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
  setupSession: { name: 'setupSession', windowMs: 60_000, max: 30 },
  bridgeHandshake: { name: 'bridgeHandshake', windowMs: 60_000, max: 20 },
  domainVerification: { name: 'domainVerification', windowMs: 60_000, max: 20 },
};

type Bucket = { count: number; resetAtMs: number };
const globalBuckets = globalThis as typeof globalThis & { __actionBridgeRateLimitBuckets?: Map<string, Bucket> };
const buckets = globalBuckets.__actionBridgeRateLimitBuckets || new Map<string, Bucket>();
globalBuckets.__actionBridgeRateLimitBuckets = buckets;

function digestKey(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
}

function clientKey(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const realIp = request.headers.get('x-real-ip')?.trim();
  const userAgent = request.headers.get('user-agent')?.slice(0, 120) || 'unknown-agent';
  return `${forwardedFor || realIp || 'unknown-ip'}|${userAgent}`;
}

export function decideActionBridgeRateLimit(input: {
  request: NextRequest;
  policy: ActionBridgeRateLimitPolicy;
  discriminator?: string;
  nowMs?: number;
}): ActionBridgeRateLimitResult {
  const nowMs = input.nowMs ?? Date.now();
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
        'X-ActionBridge-RateLimit-Policy': input.policy.name,
        'X-ActionBridge-RateLimit-Remaining': '0',
        'X-ActionBridge-RateLimit-Reset': resetAt,
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

export function summarizeActionBridgeRateLimitPolicies(): Record<string, ActionBridgeRateLimitPolicy> {
  return DEFAULT_POLICIES;
}
