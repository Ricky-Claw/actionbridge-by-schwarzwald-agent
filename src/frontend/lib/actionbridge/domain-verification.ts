import 'server-only';

import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import { isPrivateActionBridgeHost } from './http-connector';

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
    const values = await dns.resolveTxt(record);
    const flattened = values.map((chunks) => chunks.join(''));
    const ok = flattened.includes(tokenLine);
    return { ok, status: ok ? 'verified' : 'failed', evidence: { record, matched: ok }, networkExecution: true };
  }

  const target = input.method === 'well_known'
    ? new URL('/.well-known/actionbridge-verify.txt', origin.origin)
    : origin;
  const response = await fetch(target, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(5000) });
  const body = await response.text();
  const ok = input.method === 'well_known'
    ? body.trim().split(/\r?\n/).includes(tokenLine)
    : body.includes(`name="actionbridge-verification" content="${input.token}"`) || body.includes(`content="${input.token}" name="actionbridge-verification"`);
  return {
    ok,
    status: ok ? 'verified' : 'failed',
    evidence: { httpStatus: response.status, method: input.method, matched: ok },
    networkExecution: true,
  };
}
