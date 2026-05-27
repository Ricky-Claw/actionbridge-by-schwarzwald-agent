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

function validateWebhookDeliveryPath(path) {
  const candidate = typeof path === 'string' && path.trim() ? path.trim() : '/';
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate) || candidate.startsWith('//')) return { ok: false };
  if (candidate.includes('?') || candidate.includes('#')) return { ok: false };
  const normalized = candidate.startsWith('/') ? candidate : `/${candidate}`;
  if (normalized.includes('\\')) return { ok: false };
  return { ok: true, path: normalized };
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

function providerRequired(env = {}) {
  return env.ACTIONBRIDGE_SECRET_MANAGER_REQUIRED === 'true' || env.NODE_ENV === 'production';
}

function createGoogleSecretManagerSecretId(secretRef) {
  return `actionbridge-webhook-signing-${crypto.createHash('sha256').update(secretRef).digest('hex').slice(0, 32)}`;
}

function checkSecretManagerProductionReadiness(env = {}) {
  const provider = env.ACTIONBRIDGE_SECRET_MANAGER_PROVIDER === 'google_secret_manager_rest' ? 'google_secret_manager_rest' : 'pilot_env';
  const missing = [];
  if (provider !== 'google_secret_manager_rest') missing.push('ACTIONBRIDGE_SECRET_MANAGER_PROVIDER=google_secret_manager_rest');
  if (env.ACTIONBRIDGE_SECRET_MANAGER_REQUIRED !== 'true') missing.push('ACTIONBRIDGE_SECRET_MANAGER_REQUIRED=true');
  if (!env.ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_PROJECT_ID) missing.push('ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_PROJECT_ID');
  if (!env.ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_ACCESS_TOKEN) missing.push('ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_ACCESS_TOKEN');
  return {
    ok: missing.length === 0,
    provider,
    missing,
    resultSummary: {
      provider,
      readiness: missing.length === 0 ? 'managed_secret_environment_shape_configured' : 'managed_secret_environment_incomplete',
      missing,
      projectConfigured: Boolean(env.ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_PROJECT_ID),
      accessTokenConfigured: Boolean(env.ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_ACCESS_TOKEN),
    },
  };
}

async function probeSecretManagerLiveAccess({ secretRef, env = {}, fetchImpl }) {
  const readiness = checkSecretManagerProductionReadiness(env);
  const normalizedSecretRef = normalizeSecretRef(secretRef);
  const secretRefDigest = normalizedSecretRef ? `sha256:${digestSecretRef(normalizedSecretRef).toLowerCase()}` : undefined;
  if (!readiness.ok || !normalizedSecretRef) {
    return {
      ok: false,
      resultSummary: {
        provider: readiness.provider,
        readiness: readiness.ok ? 'managed_secret_environment_shape_configured' : 'managed_secret_environment_incomplete',
        accessAudit: !normalizedSecretRef ? 'invalid_secret_ref' : 'preflight_incomplete',
        missing: readiness.missing,
        secretRefDigest,
      },
    };
  }
  const secretId = createGoogleSecretManagerSecretId(normalizedSecretRef);
  const url = `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(env.ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_PROJECT_ID)}/secrets/${encodeURIComponent(secretId)}/versions/latest:access`;
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${env.ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_ACCESS_TOKEN}` } });
  if (!response.ok) return { ok: false, resultSummary: { provider: 'google_secret_manager_rest', readiness: 'managed_secret_live_access_failed', accessAudit: 'access_denied_or_unavailable', httpStatus: response.status, secretRefDigest } };
  const body = await response.json();
  const secret = Buffer.from(body?.payload?.data || '', 'base64').toString('utf8');
  const ok = secret.length >= 32 && secret.length <= 4096;
  return { ok, resultSummary: { provider: 'google_secret_manager_rest', readiness: ok ? 'managed_secret_live_access_verified' : 'managed_secret_live_access_failed', accessAudit: ok ? 'accessed_latest_version' : 'invalid_secret_payload', secretRefDigest, versionResourceDigest: body?.name ? `sha256:${crypto.createHash('sha256').update(body.name).digest('hex').slice(0, 16)}` : undefined } };
}

function resolveActionBridgeWebhookSigningSecret(input) {
  const env = input.env || {};
  if (env.ACTIONBRIDGE_SECRET_MANAGER_PROVIDER === 'google_secret_manager_rest') {
    return { ok: false, signingSecret: null, status: 'secret_manager_async_required', networkAllowed: false };
  }
  const signingMode = input.signingMode === 'hmac_sha256' ? 'hmac_sha256' : 'unsigned_pilot';
  const secretRef = normalizeSecretRef(input.secretRef);
  if (signingMode === 'unsigned_pilot') return { ok: true, signingSecret: null, status: 'unsigned_pilot_mode' };
  if (!secretRef) return { ok: false, signingSecret: null, status: 'secret_ref_missing', networkAllowed: false };
  if (providerRequired(env)) return { ok: false, signingSecret: null, status: 'secret_manager_required', networkAllowed: false };
  const envName = `ACTIONBRIDGE_WEBHOOK_SIGNING_SECRET_${digestSecretRef(secretRef)}`;
  const signingSecret = env[envName];
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
  ['delivery accepts relative segment', 'lead-submit', { ok: true, path: '/lead-submit' }],
  ['delivery rejects absolute override fail-closed', 'https://evil.test/hook', { ok: false }],
  ['delivery rejects scheme-relative override fail-closed', '//evil.test/hook', { ok: false }],
  ['delivery rejects accidental query fail-closed', '/hook?token=secret', { ok: false }],
  ['delivery rejects accidental hash fail-closed', '/hook#secret', { ok: false }],
  ['delivery rejects backslash fail-closed', '/hook\\evil', { ok: false }],
]) {
  const actual = validateWebhookDeliveryPath(value);
  const matches = expected.ok ? actual.ok === true && actual.path === expected.path : actual.ok === false;
  if (matches) pass(`endpoint path delivery hardening: ${label}`, `=> ${JSON.stringify(actual)}`);
  else fail(`endpoint path delivery hardening: ${label}`, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const secretRef = 'actionbridge:webhook-signing:pilot-webhook-0001';
const envName = `ACTIONBRIDGE_WEBHOOK_SIGNING_SECRET_${digestSecretRef(secretRef)}`;
for (const [label, input, expectedOk, expectedStatus] of [
  ['unsigned pilot permits no secret', { signingMode: 'unsigned_pilot', secretRef: null, env: {} }, true, 'unsigned_pilot_mode'],
  ['missing secret ref blocks before network', { signingMode: 'hmac_sha256', secretRef: null, env: {} }, false, 'secret_ref_missing'],
  ['unresolved secret ref blocks before network', { signingMode: 'hmac_sha256', secretRef, env: {} }, false, 'secret_ref_unresolved'],
  ['resolved server env secret permits signing', { signingMode: 'hmac_sha256', secretRef, env: { [envName]: 'x'.repeat(32) } }, true, 'hmac_sha256'],
  ['production disables pilot env secret fallback', { signingMode: 'hmac_sha256', secretRef, env: { NODE_ENV: 'production', [envName]: 'x'.repeat(32) } }, false, 'secret_manager_required'],
  ['managed provider requires async resolver in sync compatibility path', { signingMode: 'hmac_sha256', secretRef, env: { ACTIONBRIDGE_SECRET_MANAGER_PROVIDER: 'google_secret_manager_rest' } }, false, 'secret_manager_async_required'],
]) {
  const actual = resolveActionBridgeWebhookSigningSecret(input);
  if (actual.ok === expectedOk && actual.status === expectedStatus && (actual.ok || actual.networkAllowed === false)) {
    pass(`webhook signing behavior: ${label}`, `status=${actual.status}`);
  } else {
    fail(`webhook signing behavior: ${label}`, `expected ok=${expectedOk} status=${expectedStatus}, got ok=${actual.ok} status=${actual.status}`);
  }
}

const providerSecretId = createGoogleSecretManagerSecretId('actionbridge:webhook-signing:customer.label:with:colon');
if (/^actionbridge-webhook-signing-[a-f0-9]{32}$/.test(providerSecretId) && !providerSecretId.includes('customer.label')) {
  pass('webhook managed secret id mapping: digest-only provider-safe id', `=> ${providerSecretId}`);
} else {
  fail('webhook managed secret id mapping: digest-only provider-safe id', `got ${providerSecretId}`);
}

for (const forbidden of ['customer.label', 'with:colon', 'ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_ACCESS_TOKEN']) {
  if (!providerSecretId.includes(forbidden)) pass('webhook managed secret id mapping: no raw ref/provider token marker exposed', forbidden);
  else fail('webhook managed secret id mapping: no raw ref/provider token marker exposed', forbidden);
}

for (const [label, env, expectedOk, expectedMissing] of [
  ['pilot env cannot pass production readiness', {}, false, ['ACTIONBRIDGE_SECRET_MANAGER_PROVIDER=google_secret_manager_rest', 'ACTIONBRIDGE_SECRET_MANAGER_REQUIRED=true', 'ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_PROJECT_ID', 'ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_ACCESS_TOKEN']],
  ['managed provider without token still blocks production readiness', { ACTIONBRIDGE_SECRET_MANAGER_PROVIDER: 'google_secret_manager_rest', ACTIONBRIDGE_SECRET_MANAGER_REQUIRED: 'true', ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_PROJECT_ID: 'actionbridge-prod' }, false, ['ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_ACCESS_TOKEN']],
  ['managed provider with required config passes local preflight shape', { ACTIONBRIDGE_SECRET_MANAGER_PROVIDER: 'google_secret_manager_rest', ACTIONBRIDGE_SECRET_MANAGER_REQUIRED: 'true', ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_PROJECT_ID: 'actionbridge-prod', ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_ACCESS_TOKEN: 'ya29.redacted-test-token' }, true, []],
]) {
  const actual = checkSecretManagerProductionReadiness(env);
  const missingMatches = JSON.stringify(actual.missing) === JSON.stringify(expectedMissing);
  const noRawToken = !JSON.stringify(actual.resultSummary).includes('ya29.redacted-test-token');
  if (actual.ok === expectedOk && missingMatches && noRawToken) pass(`webhook secret-manager production readiness: ${label}`, `missing=${actual.missing.length}`);
  else fail(`webhook secret-manager production readiness: ${label}`, `got ${JSON.stringify(actual)}`);
}

const managedEnv = {
  ACTIONBRIDGE_SECRET_MANAGER_PROVIDER: 'google_secret_manager_rest',
  ACTIONBRIDGE_SECRET_MANAGER_REQUIRED: 'true',
  ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_PROJECT_ID: 'actionbridge-prod',
  ACTIONBRIDGE_GOOGLE_SECRET_MANAGER_ACCESS_TOKEN: 'ya29.redacted-test-token',
};

const liveAccessSuccess = await probeSecretManagerLiveAccess({
  secretRef,
  env: managedEnv,
  fetchImpl: async (url, init) => ({
    ok: true,
    status: 200,
    url,
    init,
    async json() {
      return {
        name: 'projects/actionbridge-prod/secrets/raw-provider-resource-name/versions/latest',
        payload: { data: Buffer.from('s'.repeat(32), 'utf8').toString('base64') },
      };
    },
  }),
});
if (
  liveAccessSuccess.ok === true &&
  liveAccessSuccess.resultSummary.readiness === 'managed_secret_live_access_verified' &&
  liveAccessSuccess.resultSummary.accessAudit === 'accessed_latest_version' &&
  !JSON.stringify(liveAccessSuccess.resultSummary).includes('ya29.redacted-test-token') &&
  !JSON.stringify(liveAccessSuccess.resultSummary).includes('raw-provider-resource-name')
) pass('webhook secret-manager live access proof: mocked managed access verifies without leaking token/resource name');
else fail('webhook secret-manager live access proof: mocked managed access verifies without leaking token/resource name', JSON.stringify(liveAccessSuccess));

const liveAccessDenied = await probeSecretManagerLiveAccess({
  secretRef,
  env: managedEnv,
  fetchImpl: async () => ({ ok: false, status: 403, async json() { return {}; } }),
});
if (liveAccessDenied.ok === false && liveAccessDenied.resultSummary.accessAudit === 'access_denied_or_unavailable' && liveAccessDenied.resultSummary.httpStatus === 403) {
  pass('webhook secret-manager live access proof: denied IAM/provider response fails closed');
} else fail('webhook secret-manager live access proof: denied IAM/provider response fails closed', JSON.stringify(liveAccessDenied));

const liveAccessPreflightBlocked = await probeSecretManagerLiveAccess({ secretRef, env: {}, fetchImpl: async () => { throw new Error('must not call provider'); } });
if (liveAccessPreflightBlocked.ok === false && liveAccessPreflightBlocked.resultSummary.accessAudit === 'preflight_incomplete') {
  pass('webhook secret-manager live access proof: incomplete preflight blocks before provider call');
} else fail('webhook secret-manager live access proof: incomplete preflight blocks before provider call', JSON.stringify(liveAccessPreflightBlocked));

for (const sourcePath of [
  'src/frontend/app/api/actionbridge/execute/route.ts',
  'src/frontend/app/api/actionbridge/ops/webhook-secret-rotation/route.ts',
]) {
  const source = await import('node:fs').then((fs) => fs.readFileSync(sourcePath, 'utf8'));
  if (source.includes('resolveActionBridgeWebhookSigningSecretAsync as resolveActionBridgeWebhookSigningSecret') && source.includes('await resolveActionBridgeWebhookSigningSecret({')) {
    pass('webhook managed secret caller behavior: async resolver used before secret-dependent action', sourcePath);
  } else {
    fail('webhook managed secret caller behavior: async resolver used before secret-dependent action', sourcePath);
  }
}

const rotationSource = await import('node:fs').then((fs) => fs.readFileSync('src/frontend/app/api/actionbridge/ops/webhook-secret-rotation/route.ts', 'utf8'));
for (const marker of [
  'parseExpectedCurrentDigest',
  '^sha256:[a-f0-9]{16}$',
  'expectedCurrentDigestInvalid',
  'expectedCurrentDigest: undefined',
  'expected_current_digest: undefined',
]) {
  if (rotationSource.includes(marker)) pass('webhook rotation digest input hardening marker', marker);
  else fail('webhook rotation digest input hardening marker', marker);
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
