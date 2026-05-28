#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

let failed = 0;
const pass = (msg) => console.log(`✅ ${msg}`);
const fail = (msg, detail = '') => { failed += 1; console.error(`❌ ${msg}${detail ? ` — ${detail}` : ''}`); };

const root = process.cwd();
const moduleCache = new Map();

function loadTsModule(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const source = fs.readFileSync(absolutePath, 'utf8')
    .replace(/^import 'server-only';\n\n?/m, '');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: absolutePath,
  }).outputText;

  const module = { exports: {} };
  moduleCache.set(absolutePath, module);
  const dirname = path.dirname(absolutePath);
  const localRequire = (specifier) => {
    if (specifier === 'node:crypto') return crypto;
    if (specifier.startsWith('./')) {
      const target = path.relative(root, path.join(dirname, `${specifier}.ts`));
      return loadTsModule(target);
    }
    throw new Error(`Unsupported test require: ${specifier}`);
  };

  vm.runInNewContext(transpiled, {
    module,
    exports: module.exports,
    require: localRequire,
    console,
    Buffer,
    process,
    URL,
  }, { filename: relativePath });
  return module.exports;
}

const {
  ACTIONBRIDGE_SECRET_MANAGER_LIVE_PROBE_POLICY,
  handleActionBridgeSecretManagerLiveProbe,
  parseActionBridgeSecretManagerLiveProbeConnectorId,
} = loadTsModule('src/frontend/lib/actionbridge/secret-manager-live-probe-route.ts');

function makeRequest(body = { connectorId: 'conn-1' }) {
  return { body };
}

const hmacConnector = {
  id: 'conn-1',
  user_id: 'user-1',
  type: 'webhook',
  webhook_signing_mode: 'hmac_sha256',
  secret_ref: 'actionbridge:webhook-signing:pilot-live-probe-0001',
};

function makeSupabase({ user = { id: 'user-1' }, authError = null, connector = hmacConnector, calls }) {
  return {
    auth: {
      getUser: async () => ({ data: { user }, error: authError }),
    },
    from(table) {
      calls.from.push(table);
      const query = {
        select(columns) {
          calls.select.push(columns);
          return query;
        },
        eq(column, value) {
          calls.eq.push([column, value]);
          return query;
        },
        async maybeSingle() {
          calls.maybeSingle += 1;
          return { data: connector, error: null };
        },
      };
      return query;
    },
  };
}

function createHarness(overrides = {}) {
  const calls = {
    from: [],
    select: [],
    eq: [],
    maybeSingle: 0,
    service: 0,
    rateLimit: [],
    probe: [],
    audit: [],
    bodyReads: 0,
  };
  const supabase = makeSupabase({ calls, ...(overrides.supabaseOptions || {}) });
  const deps = {
    request: makeRequest(overrides.body),
    readBody: async () => {
      calls.bodyReads += 1;
      return overrides.body ?? { connectorId: 'conn-1' };
    },
    createUserClient: async () => supabase,
    tryCreateServiceClient: () => {
      calls.service += 1;
      return overrides.serviceUnavailable ? null : { service: true };
    },
    enforceRateLimit: async (input) => {
      calls.rateLimit.push(input);
      if (overrides.rateLimited) {
        return {
          ok: false,
          keyDigest: 'sha256:rate-denied',
          responseStatus: 429,
          responseBody: {
            error: 'ACTIONBRIDGE_RATE_LIMITED',
            rateLimit: { policy: 'secretManagerLiveProbe', keyDigest: 'sha256:rate-denied' },
          },
          responseHeaders: { 'Retry-After': '60' },
        };
      }
      return { ok: true, keyDigest: 'sha256:rate-ok' };
    },
    probeLiveAccess: async (input) => {
      calls.probe.push(input);
      if (overrides.probeResult) return overrides.probeResult;
      return {
        ok: true,
        resultSummary: {
          provider: 'google_secret_manager_rest',
          accessAudit: 'accessed_latest_version',
          secretRefDigest: 'sha256:probe-will-be-overridden',
          versionResourceDigest: 'sha256:version-ok',
        },
      };
    },
    persistAudit: async (serviceClient, input) => {
      calls.audit.push({ serviceClient, input });
      return { error: overrides.auditFails ? 'insert failed' : null };
    },
  };
  return { calls, deps };
}

async function runCase(label, overrides, assertions) {
  try {
    const harness = createHarness(overrides);
    const result = await handleActionBridgeSecretManagerLiveProbe(harness.deps);
    await assertions(result, harness.calls);
    pass(label);
  } catch (error) {
    fail(label, error.stack || error.message);
  }
}

assert.equal(parseActionBridgeSecretManagerLiveProbeConnectorId({ connectorId: ' conn-a ' }), 'conn-a');
assert.equal(parseActionBridgeSecretManagerLiveProbeConnectorId({ connector_id: ' conn-b ' }), 'conn-b');
assert.equal(parseActionBridgeSecretManagerLiveProbeConnectorId({ connectorId: 123 }), '');
pass('live-probe core parses connectorId and connector_id safely');

await runCase('live-probe route core returns 401 before service/probe for unauthenticated users', {
  supabaseOptions: { user: null },
}, (result, calls) => {
  assert.equal(result.status, 401);
  assert.equal(result.body.error, 'UNAUTHORIZED');
  assert.equal(calls.bodyReads, 0);
  assert.equal(calls.service, 0);
  assert.equal(calls.probe.length, 0);
  assert.equal(calls.audit.length, 0);
});

await runCase('live-probe route core returns 400 for missing connector id before service/probe', {
  body: {},
}, (result, calls) => {
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'ACTIONBRIDGE_SECRET_MANAGER_PROBE_CONNECTOR_REQUIRED');
  assert.equal(calls.bodyReads, 1);
  assert.equal(calls.service, 0);
  assert.equal(calls.probe.length, 0);
});

await runCase('live-probe route core fails closed when audit service client is unavailable before connector lookup/probe', {
  serviceUnavailable: true,
}, (result, calls) => {
  assert.equal(result.status, 503);
  assert.equal(result.body.error, 'ACTIONBRIDGE_SECRET_MANAGER_PROBE_AUDIT_UNAVAILABLE');
  assert.equal(calls.from.length, 0);
  assert.equal(calls.probe.length, 0);
  assert.equal(calls.audit.length, 0);
});

await runCase('live-probe route core uses owner-scoped connector lookup and returns 404 for not found', {
  supabaseOptions: { connector: null },
}, (result, calls) => {
  assert.equal(result.status, 404);
  assert.equal(result.body.error, 'ACTIONBRIDGE_CONNECTOR_NOT_FOUND');
  assert.deepEqual(calls.from, ['actionbridge_connectors']);
  assert.ok(calls.select[0].includes('secret_ref'));
  assert.deepEqual(calls.eq, [['user_id', 'user-1'], ['id', 'conn-1']]);
  assert.equal(calls.probe.length, 0);
});

await runCase('live-probe route core rejects non-HMAC webhook connectors before rate-limit/probe', {
  supabaseOptions: {
    connector: { ...hmacConnector, webhook_signing_mode: 'unsigned_pilot' },
  },
}, (result, calls) => {
  assert.equal(result.status, 409);
  assert.equal(result.body.error, 'ACTIONBRIDGE_SECRET_MANAGER_PROBE_REQUIRES_HMAC_WEBHOOK_CONNECTOR');
  assert.equal(calls.rateLimit.length, 0);
  assert.equal(calls.probe.length, 0);
});

await runCase('live-probe route core rejects non-webhook connectors before rate-limit/probe', {
  supabaseOptions: {
    connector: { ...hmacConnector, type: 'rest' },
  },
}, (result, calls) => {
  assert.equal(result.status, 409);
  assert.equal(result.body.error, 'ACTIONBRIDGE_SECRET_MANAGER_PROBE_REQUIRES_HMAC_WEBHOOK_CONNECTOR');
  assert.equal(calls.rateLimit.length, 0);
  assert.equal(calls.probe.length, 0);
});

await runCase('live-probe route core returns 429 rate-limit response before provider probe', {
  rateLimited: true,
}, (result, calls) => {
  assert.equal(result.status, 429);
  assert.equal(result.body.error, 'ACTIONBRIDGE_RATE_LIMITED');
  assert.equal(result.headers['Retry-After'], '60');
  assert.equal(calls.rateLimit[0].request.body.connectorId, 'conn-1');
  assert.equal(calls.rateLimit[0].userId, 'user-1');
  assert.equal(calls.rateLimit[0].connectorId, 'conn-1');
  assert.equal(calls.probe.length, 0);
  assert.equal(calls.audit.length, 0);
});

await runCase('live-probe route core returns 503 when audit persistence fails after probe', {
  auditFails: true,
}, (result, calls) => {
  assert.equal(result.status, 503);
  assert.equal(result.body.error, 'ACTIONBRIDGE_SECRET_MANAGER_PROBE_AUDIT_FAILED');
  assert.equal(result.body.resultSummary.auditPersisted, false);
  assert.equal(calls.probe.length, 1);
  assert.equal(calls.audit.length, 1);
});

await runCase('live-probe route core returns 200 with redacted persisted evidence on provider success', {}, (result, calls) => {
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.status, 'succeeded');
  assert.equal(result.body.resultSummary.auditPersisted, true);
  assert.equal(result.body.resultSummary.sentinelPolicy, ACTIONBRIDGE_SECRET_MANAGER_LIVE_PROBE_POLICY);
  assert.match(result.body.resultSummary.secretRefDigest, /^sha256:[a-f0-9]{16}$/);
  assert.equal(calls.rateLimit[0].request.body.connectorId, 'conn-1');
  assert.equal(calls.rateLimit[0].userId, 'user-1');
  assert.equal(calls.rateLimit[0].connectorId, 'conn-1');
  assert.equal(calls.audit[0].input.eventName, 'secret_manager.live_probe_verified');
  assert.equal(calls.audit[0].input.status, 'succeeded');
  assert.equal(calls.audit[0].input.resultSummary.rateLimitKeyDigest, 'sha256:rate-ok');
});

await runCase('live-probe route core returns 409 and persists failed evidence on provider denial', {
  probeResult: {
    ok: false,
    resultSummary: {
      provider: 'google_secret_manager_rest',
      accessAudit: 'access_denied_or_unavailable',
      httpStatus: 403,
    },
  },
}, (result, calls) => {
  assert.equal(result.status, 409);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.status, 'failed');
  assert.equal(result.body.resultSummary.auditPersisted, true);
  assert.equal(calls.audit[0].input.eventName, 'secret_manager.live_probe_failed');
  assert.equal(calls.audit[0].input.status, 'failed');
});

await runCase('live-probe route core accepts connector_id alias for compatibility', {
  body: { connector_id: ' conn-1 ' },
}, (result, calls) => {
  assert.equal(result.status, 200);
  assert.deepEqual(calls.eq, [['user_id', 'user-1'], ['id', 'conn-1']]);
});

await runCase('live-probe route core strips raw refs, tokens, secrets, and provider resources from response and audit summaries', {
  probeResult: {
    ok: true,
    resultSummary: {
      provider: 'google_secret_manager_rest',
      accessAudit: 'accessed_latest_version',
      secretRef: 'actionbridge:webhook-signing:raw-secret-ref-0001',
      secret_ref: 'actionbridge:webhook-signing:raw-secret-ref-0001',
      token: 'Bearer raw-token-value-abcdefghijklmnopqrstuvwxyz',
      accessToken: 'ya29.raw-token-value-abcdefghijklmnopqrstuvwxyz',
      secretValue: 'raw-secret-value-abcdefghijklmnopqrstuvwxyz',
      providerResourceName: 'projects/raw-project/secrets/raw-secret/versions/latest',
      versionResource: 'projects/raw-project/secrets/raw-secret/versions/2',
      versionResourceDigest: 'sha256:version-safe',
      nested: {
        resourceName: 'projects/raw-project/secrets/raw-secret/versions/3',
        note: 'ref actionbridge:webhook-signing:raw-secret-ref-0001 with token=raw-token-value-abcdefghijklmnopqrstuvwxyz',
      },
    },
  },
}, (result, calls) => {
  assert.equal(result.status, 200);
  const combined = JSON.stringify({ response: result.body, audit: calls.audit[0].input });
  for (const forbidden of [
    'actionbridge:webhook-signing:raw-secret-ref-0001',
    'raw-token-value',
    'raw-secret-value',
    'raw-project',
    'raw-secret/versions',
    'projects/raw-project',
  ]) {
    assert.equal(combined.includes(forbidden), false, `forbidden raw value leaked: ${forbidden}`);
  }
  assert.equal(result.body.resultSummary.versionResourceDigest, 'sha256:version-safe');
  assert.equal(result.body.resultSummary.secretRef, '[REDACTED]');
  assert.equal(result.body.resultSummary.providerResourceName, '[REDACTED]');
  assert.equal(calls.audit[0].input.resultSummary.nested.resourceName, '[REDACTED]');
});

process.exitCode = failed ? 1 : 0;
