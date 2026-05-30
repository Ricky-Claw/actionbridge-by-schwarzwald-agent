import 'server-only';

import crypto from 'node:crypto';
import type { LookupAddress } from 'node:dns';
import dns from 'node:dns/promises';
import https from 'node:https';
import { isPrivateActionBridgeHost } from './http-connector';
import { decideActionBridgeDnsPinning } from './dns-ip-guard';
import { defaultActionBridgeResponseLimitPolicy, enforceActionBridgeResponseByteLimit } from './response-limits';

export type ActionBridgeVerificationMethod = 'human_attestation' | 'well_known' | 'meta_tag' | 'dns_txt';
export type ActionBridgeVerificationStatus = 'pending' | 'verified' | 'failed' | 'revoked';

export interface ActionBridgeVerificationChallenge {
  origin: string;
  hostname: string;
  method: ActionBridgeVerificationMethod;
  token: string;
  tokenDigest: string;
  challengePath?: string;
  dnsRecordName?: string;
  instructions: string[];
  expiresAt: string;
}

interface ActionBridgePinnedVerificationResponse {
  status: number;
  text: string;
  bytes: number;
  tooLarge: boolean;
  redirectBlocked: boolean;
}

const ACTIONBRIDGE_DOMAIN_VERIFICATION_DNS_TIMEOUT_MS = 3000;
const ACTIONBRIDGE_DOMAIN_VERIFICATION_DNS_TXT_TIMEOUT_MS = 3000;
const ACTIONBRIDGE_DOMAIN_VERIFICATION_HTTP_TIMEOUT_MS = 5000;

async function lookupActionBridgeVerificationAddresses(hostname: string): Promise<LookupAddress[]> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      dns.lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('ACTIONBRIDGE_DOMAIN_VERIFICATION_DNS_TIMEOUT')), ACTIONBRIDGE_DOMAIN_VERIFICATION_DNS_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function resolveActionBridgeVerificationTxt(record: string): Promise<string[][]> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      dns.resolveTxt(record),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('ACTIONBRIDGE_DOMAIN_VERIFICATION_DNS_TXT_TIMEOUT')), ACTIONBRIDGE_DOMAIN_VERIFICATION_DNS_TXT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function getPinnedActionBridgeVerificationText(input: {
  target: URL;
  pinnedAddress: string;
  timeoutMs: number;
  maxBytes: number;
}): Promise<ActionBridgePinnedVerificationResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutState: { deadline?: NodeJS.Timeout } = {};
    const finish = (result: ActionBridgePinnedVerificationResponse) => {
      if (settled) return;
      settled = true;
      if (timeoutState.deadline) clearTimeout(timeoutState.deadline);
      resolve(result);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      if (timeoutState.deadline) clearTimeout(timeoutState.deadline);
      reject(error);
    };
    const request = https.request({
      protocol: 'https:',
      host: input.pinnedAddress,
      servername: input.target.hostname,
      agent: false,
      port: input.target.port ? Number(input.target.port) : 443,
      method: 'GET',
      path: `${input.target.pathname}${input.target.search}`,
      timeout: input.timeoutMs,
      headers: {
        Host: input.target.host,
        'User-Agent': 'ActionBridge-DomainVerification/1.0',
        'X-ActionBridge-Version': 'actionbridge.domain-verification.v1',
      },
    }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400) {
        finish({ status, text: '', bytes: 0, tooLarge: false, redirectBlocked: true });
        response.destroy();
        request.destroy();
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer | string) => {
        if (settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > input.maxBytes) {
          finish({ status, text: Buffer.concat(chunks).toString('utf8'), bytes, tooLarge: true, redirectBlocked: false });
          request.destroy();
          return;
        }
        chunks.push(buffer);
      });
      response.on('end', () => {
        finish({ status, text: Buffer.concat(chunks).toString('utf8'), bytes, tooLarge: false, redirectBlocked: false });
      });
      response.on('error', fail);
    });
    timeoutState.deadline = setTimeout(() => request.destroy(new Error('ACTIONBRIDGE_DOMAIN_VERIFICATION_TIMEOUT')), input.timeoutMs);
    request.on('timeout', () => request.destroy(new Error('ACTIONBRIDGE_DOMAIN_VERIFICATION_TIMEOUT')));
    request.on('error', fail);
    request.end();
  });
}

export function normalizeActionBridgeVerificationOrigin(value: unknown): URL | null {
  if (typeof value !== 'string') return null;
  let parsedUrl: URL;
  try { parsedUrl = new URL(value); } catch { return null; }
  if (parsedUrl.protocol !== 'https:') return null;
  if (parsedUrl.username || parsedUrl.password) return null;
  if (parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) return null;
  if (isPrivateActionBridgeHost(parsedUrl.hostname)) return null;
  return parsedUrl;
}

export function createActionBridgeVerificationToken(): string {
  return `abv_${crypto.randomBytes(24).toString('base64url')}`;
}

export function digestActionBridgeVerificationToken(token: string): string {
  return `sha256:${crypto.createHash('sha256').update(token).digest('hex')}`;
}

export function createActionBridgeVerificationChallenge(input: {
  origin: string;
  method: ActionBridgeVerificationMethod;
  token?: string;
  now?: Date;
}): ActionBridgeVerificationChallenge | null {
  const origin = normalizeActionBridgeVerificationOrigin(input.origin);
  if (!origin) return null;
  const token = input.token || createActionBridgeVerificationToken();
  const expiresAt = new Date((input.now || new Date()).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const hostname = origin.hostname;
  const challengePath = '/.well-known/actionbridge-verify.txt';
  const dnsRecordName = `_actionbridge.${hostname}`;
  const tokenLine = `actionbridge-verification=${token}`;

  const instructionsByMethod: Record<ActionBridgeVerificationMethod, string[]> = {
    human_attestation: [
      `Confirm you are authorized to connect ${origin.origin} to ActionBridge.`,
      'This only permits public read-only connector setup unless stronger verification is completed.',
    ],
    well_known: [
      `Create ${origin.origin}${challengePath}`,
      `Set the file content to: ${tokenLine}`,
    ],
    meta_tag: [
      `Add this tag to the HTML <head> of ${origin.origin}:`,
      `<meta name="actionbridge-verification" content="${token}">`,
    ],
    dns_txt: [
      `Create DNS TXT record ${dnsRecordName}`,
      `Set TXT value to: ${tokenLine}`,
    ],
  };

  return {
    origin: origin.origin,
    hostname,
    method: input.method,
    token,
    tokenDigest: digestActionBridgeVerificationToken(token),
    challengePath: input.method === 'well_known' ? challengePath : undefined,
    dnsRecordName: input.method === 'dns_txt' ? dnsRecordName : undefined,
    instructions: instructionsByMethod[input.method],
    expiresAt,
  };
}

export async function verifyActionBridgeDomainChallenge(input: {
  origin: string;
  method: ActionBridgeVerificationMethod;
  token: string;
}): Promise<{ ok: boolean; status: ActionBridgeVerificationStatus; evidence: Record<string, unknown>; networkExecution: boolean }> {
  const origin = normalizeActionBridgeVerificationOrigin(input.origin);
  if (!origin) return { ok: false, status: 'failed', evidence: { reason: 'Invalid verification origin.' }, networkExecution: false };
  const tokenLine = `actionbridge-verification=${input.token}`;

  if (input.method === 'human_attestation') {
    return { ok: true, status: 'verified', evidence: { attestation: true, origin: origin.origin }, networkExecution: false };
  }

  if (input.method === 'dns_txt') {
    const record = `_actionbridge.${origin.hostname}`;
    let values: string[][];
    try {
      values = await resolveActionBridgeVerificationTxt(record);
    } catch (error) {
      return {
        ok: false,
        status: 'failed',
        evidence: {
          record,
          reason: error instanceof Error && error.message === 'ACTIONBRIDGE_DOMAIN_VERIFICATION_DNS_TXT_TIMEOUT'
            ? 'dns_txt_lookup_timeout'
            : 'dns_txt_lookup_failed',
          errorName: error instanceof Error ? error.name : 'unknown',
          dnsLookupAttempted: true,
          httpRequestAttempted: false,
        },
        networkExecution: true,
      };
    }
    const flattened = values.map((chunks) => chunks.join(''));
    const ok = flattened.includes(tokenLine);
    return { ok, status: ok ? 'verified' : 'failed', evidence: { record, matched: ok, dnsLookupAttempted: true, httpRequestAttempted: false }, networkExecution: true };
  }

  const target = input.method === 'well_known'
    ? new URL('/.well-known/actionbridge-verify.txt', origin.origin)
    : origin;
  let addresses: LookupAddress[];
  try {
    addresses = await lookupActionBridgeVerificationAddresses(target.hostname);
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      evidence: {
        reason: error instanceof Error && error.message === 'ACTIONBRIDGE_DOMAIN_VERIFICATION_DNS_TIMEOUT'
          ? 'dns_lookup_timeout'
          : 'dns_lookup_failed',
        errorName: error instanceof Error ? error.name : 'unknown',
        dnsLookupAttempted: true,
        httpRequestAttempted: false,
      },
      networkExecution: false,
    };
  }
  const dnsDecision = decideActionBridgeDnsPinning({
    hostname: target.hostname,
    addresses: addresses.map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 })),
    networkExecution: false,
  });
  if (!dnsDecision.ok) {
    return { ok: false, status: 'failed', evidence: { reason: dnsDecision.reason, dns: dnsDecision, dnsLookupAttempted: true, httpRequestAttempted: false }, networkExecution: false };
  }
  const pinnedAddress = addresses[0]?.address;
  if (!pinnedAddress) {
    return { ok: false, status: 'failed', evidence: { reason: 'DNS resolution returned no addresses.', dnsLookupAttempted: true, httpRequestAttempted: false }, networkExecution: false };
  }

  // Connection-pinned HTTPS: resolve once, validate every returned address, then connect to the
  // selected validated IP while preserving the original Host/SNI. Do not use the global Fetch API
  // here; a separate runtime resolver between validation and connect would reopen DNS rebinding SSRF risk.
  let response: ActionBridgePinnedVerificationResponse;
  try {
    response = await getPinnedActionBridgeVerificationText({
      target,
      pinnedAddress,
      timeoutMs: ACTIONBRIDGE_DOMAIN_VERIFICATION_HTTP_TIMEOUT_MS,
      maxBytes: defaultActionBridgeResponseLimitPolicy.maxBytes,
    });
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      evidence: {
        reason: error instanceof Error && error.message === 'ACTIONBRIDGE_DOMAIN_VERIFICATION_TIMEOUT'
          ? 'http_probe_timeout'
          : 'http_probe_failed',
        errorName: error instanceof Error ? error.name : 'unknown',
        method: input.method,
        dnsLookupAttempted: true,
        httpRequestAttempted: true,
      },
      networkExecution: true,
    };
  }
  if (response.redirectBlocked) {
    return { ok: false, status: 'failed', evidence: { httpStatus: response.status, method: input.method, matched: false, redirectBlocked: true, dnsLookupAttempted: true, httpRequestAttempted: true }, networkExecution: true };
  }
  if (response.tooLarge) {
    return { ok: false, status: 'failed', evidence: { reason: 'ActionBridge response exceeds byte limit.', bytes: response.bytes, dnsLookupAttempted: true, httpRequestAttempted: true }, networkExecution: true };
  }
  const body = response.text;
  const limit = enforceActionBridgeResponseByteLimit(body);
  if (!limit.ok) {
    return { ok: false, status: 'failed', evidence: { reason: limit.reason, bytes: limit.bytes, dnsLookupAttempted: true, httpRequestAttempted: true }, networkExecution: true };
  }
  const ok = input.method === 'well_known'
    ? body.trim().split(/\r?\n/).includes(tokenLine)
    : body.includes(`name="actionbridge-verification" content="${input.token}"`) || body.includes(`content="${input.token}" name="actionbridge-verification"`);
  return {
    ok,
    status: ok ? 'verified' : 'failed',
    evidence: { httpStatus: response.status, method: input.method, matched: ok, pinnedAddressFamily: pinnedAddress.includes(':') ? 6 : 4, dnsLookupAttempted: true, httpRequestAttempted: true },
    networkExecution: true,
  };
}
