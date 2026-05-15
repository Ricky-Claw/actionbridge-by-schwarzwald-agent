#!/usr/bin/env node
import crypto from 'node:crypto';

let failed = 0;
const pass = (msg, detail = '') => console.log(`✅ ${msg}${detail ? ` — ${detail}` : ''}`);
const fail = (msg, detail = '') => { failed += 1; console.error(`❌ ${msg}${detail ? ` — ${detail}` : ''}`); };

function normalizeActionBridgeWebhookEndpointPath(value) {
  if (value === undefined || value === null || value === '') return '/';
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (!candidate) return '/';
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate) || candidate.startsWith('//')) return null;
  if (candidate.includes('?') || candidate.includes('#')) return null;
  const path = candidate.startsWith('/') ? candidate : `/${candidate}`;
  if (path.includes('\\')) return null;
  return path;
}

function safeWebhookDeliveryPath(path) {
  const candidate = typeof path === 'string' && path.trim() ? path.trim() : '/';
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate) || candidate.startsWith('//')) return '/';
  const noHash = candidate.split('#', 1)[0] || '/';
  const noQuery = noHash.split('?', 1)[0] || '/';
  return noQuery.startsWith('/') ? noQuery : `/${noQuery}`;
}

function digestSecretRef(secretRef) {
  return crypto.createHash('sha256').update(secretRef).digest('hex').slice(0, 16).toUpperCase();
}

function normalizeSecretRef(secretRef) {
  if (typeof secretRef !== 'string') return null;
  const value = secretRef.trim();
  if (!value) return null;
  if (!/^actionbridge:webhook-signing:[a-zA-Z0-9._:-]{8,160}$/.test(value)) return null;
  return value;
}

function resolveActionBridgeWebhookSigningSecret(input) {
  const signingMode = input.signingMode === 'hmac_sha256' ? 'hmac_sha256' : 'unsigned_pilot';
  const secretRef = normalizeSecretRef(input.secretRef);
  if (signingMode === 'unsigned_pilot') return { ok: true, signingSecret: null, status: 'unsigned_pilot_mode' };
  if (!secretRef) return { ok: false, signingSecret: null, status: 'secret_ref_missing', networkAllowed: false };
  const envName = `ACTIONBRIDGE_WEBHOOK_SIGNING_SECRET_${digestSecretRef(secretRef)}`;
  const signingSecret = (input.env || {})[envName];
  if (!signingSecret || signingSecret.length < 32 || signingSecret.length > 4096) {
    return { ok: false, signingSecret: null, status: 'secret_ref_unresolved', networkAllowed: false };
  }
  return { ok: true, signingSecret, status: 'hmac_sha256' };
}

function createExecutionPersistenceResult(webhookResult) {
  const finalExecutionStatus = webhookResult.ok ? 'succeeded' : 'failed';
  return {
    httpStatus: finalExecutionStatus === 'failed' ? 502 : 200,
    decision: finalExecutionStatus === 'failed' ? 'deny' : 'allow',
    persistedExecutionStatus: finalExecutionStatus,
    persistedErrorCode: finalExecutionStatus === 'failed' ? 'ACTIONBRIDGE_WEBHOOK_DELIVERY_FAILED' : undefined,
    errorLogCategory: webhookResult.status === 429 ? 'rate_limit' : finalExecutionStatus === 'failed' ? 'webhook' : null,
    errorLogSeverity: webhookResult.status === 429 ? 'low' : finalExecutionStatus === 'failed' ? 'medium' : null,
  };
}

for (const [label, value, expected] of [
  ['empty defaults to root', '', '/'],
  ['relative segment becomes absolute path', 'lead-submit', '/lead-submit'],
  ['absolute path stays absolute path', '/hooks/actionbridge', '/hooks/actionbridge'],
  ['absolute https URL rejected', 'https://evil.test/hook', null],
  ['scheme-relative URL rejected', '//evil.test/hook', null],
  ['query rejected before persistence', '/hook?token=secret', null],
  ['hash rejected before persistence', '/hook#secret', null],
  ['backslash rejected', '/hook\\evil', null],
]) {
  const actual = normalizeActionBridgeWebhookEndpointPath(value);
  if (actual === expected) pass(`endpoint path persistence behavior: ${label}`, `=> ${String(actual)}`);
  else fail(`endpoint path persistence behavior: ${label}`, `expected ${String(expected)}, got ${String(actual)}`);
}

for (const [label, value, expected] of [
  ['delivery falls back on absolute override', 'https://evil.test/hook', '/'],
  ['delivery falls back on scheme-relative override', '//evil.test/hook', '/'],
  ['delivery strips accidental query', '/hook?token=secret', '/hook'],
  ['delivery strips accidental hash', '/hook#secret', '/hook'],
]) {
  const actual = safeWebhookDeliveryPath(value);
  if (actual === expected) pass(`endpoint path delivery hardening: ${label}`, `=> ${actual}`);
  else fail(`endpoint path delivery hardening: ${label}`, `expected ${expected}, got ${actual}`);
}

const secretRef = 'actionbridge:webhook-signing:pilot-webhook-0001';
const envName = `ACTIONBRIDGE_WEBHOOK_SIGNING_SECRET_${digestSecretRef(secretRef)}`;
for (const [label, input, expectedOk, expectedStatus] of [
  ['unsigned pilot permits no secret', { signingMode: 'unsigned_pilot', secretRef: null, env: {} }, true, 'unsigned_pilot_mode'],
  ['missing secret ref blocks before network', { signingMode: 'hmac_sha256', secretRef: null, env: {} }, false, 'secret_ref_missing'],
  ['unresolved secret ref blocks before network', { signingMode: 'hmac_sha256', secretRef, env: {} }, false, 'secret_ref_unresolved'],
  ['resolved server env secret permits signing', { signingMode: 'hmac_sha256', secretRef, env: { [envName]: 'x'.repeat(32) } }, true, 'hmac_sha256'],
]) {
  const actual = resolveActionBridgeWebhookSigningSecret(input);
  if (actual.ok === expectedOk && actual.status === expectedStatus && (actual.ok || actual.networkAllowed === false)) {
    pass(`webhook signing behavior: ${label}`, `status=${actual.status}`);
  } else {
    fail(`webhook signing behavior: ${label}`, `expected ok=${expectedOk} status=${expectedStatus}, got ok=${actual.ok} status=${actual.status}`);
  }
}

for (const [label, webhookResult, expected] of [
  ['non-2xx response fails closed and persists failed execution', { ok: false, status: 500 }, { httpStatus: 502, decision: 'deny', persistedExecutionStatus: 'failed', persistedErrorCode: 'ACTIONBRIDGE_WEBHOOK_DELIVERY_FAILED', errorLogCategory: 'webhook', errorLogSeverity: 'medium' }],
  ['timeout/error response fails closed and persists failed execution', { ok: false, status: 502 }, { httpStatus: 502, decision: 'deny', persistedExecutionStatus: 'failed', persistedErrorCode: 'ACTIONBRIDGE_WEBHOOK_DELIVERY_FAILED', errorLogCategory: 'webhook', errorLogSeverity: 'medium' }],
  ['rate limit response fails closed with low-severity rate-limit log', { ok: false, status: 429 }, { httpStatus: 502, decision: 'deny', persistedExecutionStatus: 'failed', persistedErrorCode: 'ACTIONBRIDGE_WEBHOOK_DELIVERY_FAILED', errorLogCategory: 'rate_limit', errorLogSeverity: 'low' }],
]) {
  const actual = createExecutionPersistenceResult(webhookResult);
  const ok = Object.entries(expected).every(([key, value]) => actual[key] === value);
  if (ok) pass(`webhook failure persistence behavior: ${label}`, `status=${actual.persistedExecutionStatus}`);
  else fail(`webhook failure persistence behavior: ${label}`, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

process.exitCode = failed ? 1 : 0;
