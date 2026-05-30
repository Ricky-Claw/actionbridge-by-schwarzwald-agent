#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import ts from 'typescript';

let failed = 0;
const pass = (msg, detail = '') => console.log(`✅ ${msg}${detail ? ` — ${detail}` : ''}`);
const fail = (msg, detail = '') => { failed += 1; console.error(`❌ ${msg}${detail ? ` — ${detail}` : ''}`); };

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function sanitizeDomainVerificationSource(source) {
  return source
    .replace(/^import[^\n]+\n/gm, '')
    .replace(/export /g, '')
    // Keep behavioral timeout tests fast while executing the same timeout branches.
    .replace('const ACTIONBRIDGE_DOMAIN_VERIFICATION_DNS_TIMEOUT_MS = 3000;', 'const ACTIONBRIDGE_DOMAIN_VERIFICATION_DNS_TIMEOUT_MS = 10;')
    .replace('const ACTIONBRIDGE_DOMAIN_VERIFICATION_DNS_TXT_TIMEOUT_MS = 3000;', 'const ACTIONBRIDGE_DOMAIN_VERIFICATION_DNS_TXT_TIMEOUT_MS = 10;')
    .replace('const ACTIONBRIDGE_DOMAIN_VERIFICATION_HTTP_TIMEOUT_MS = 5000;', 'const ACTIONBRIDGE_DOMAIN_VERIFICATION_HTTP_TIMEOUT_MS = 10;');
}

function buildHarness({ dnsMock, httpsMock, maxBytes = 64 }) {
  const source = sanitizeDomainVerificationSource(read('src/frontend/lib/actionbridge/domain-verification.ts'));
  const js = ts.transpileModule(`${source}\n\nglobalThis.__verify = verifyActionBridgeDomainChallenge;`, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
  }).outputText;
  const privateIpPatterns = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^::1$/, /^fc/i, /^fd/i, /^fe80:/i];
  const context = {
    Buffer,
    URL,
    Promise,
    Error,
    crypto,
    dns: dnsMock,
    https: httpsMock,
    setTimeout,
    clearTimeout,
    defaultActionBridgeResponseLimitPolicy: { maxBytes },
    enforceActionBridgeResponseByteLimit(value) {
      const bytes = Buffer.byteLength(String(value), 'utf8');
      return bytes <= maxBytes
        ? { ok: true, bytes }
        : { ok: false, bytes, reason: 'ActionBridge response exceeds byte limit.' };
    },
    isPrivateActionBridgeHost(hostname) {
      const normalized = String(hostname).trim().toLowerCase().replace(/^\[|\]$/g, '');
      return normalized === 'localhost'
        || normalized.endsWith('.local')
        || normalized.endsWith('.internal')
        || privateIpPatterns.some((pattern) => pattern.test(normalized));
    },
    decideActionBridgeDnsPinning(snapshot) {
      const addresses = snapshot.addresses || [];
      if (!addresses.length) return { ok: false, hostname: snapshot.hostname, addresses, reason: 'DNS resolution returned no addresses.', networkExecution: false };
      const blocked = addresses.find((entry) => privateIpPatterns.some((pattern) => pattern.test(entry.address)));
      if (blocked) return { ok: false, hostname: snapshot.hostname, addresses, reason: 'DNS resolution included private or link-local address.', networkExecution: false };
      return { ok: true, hostname: snapshot.hostname, addresses, networkExecution: false };
    },
  };
  vm.createContext(context);
  vm.runInContext(js, context);
  return context.__verify;
}

function createHttpsMock(scenario) {
  const calls = [];
  return {
    calls,
    request(options, callback) {
      const request = new EventEmitter();
      request.destroyed = false;
      request.endCalled = false;
      request.options = options;
      request.setTimeout = () => request;
      request.end = () => {
        request.endCalled = true;
        queueMicrotask(() => scenario({ options, callback, request, calls }));
        return request;
      };
      request.destroy = (error) => {
        request.destroyed = true;
        if (error) queueMicrotask(() => request.emit('error', error));
        return request;
      };
      calls.push({ options, request });
      return request;
    },
  };
}

function createResponse({ statusCode = 200, chunks = [], end = true }) {
  const response = new EventEmitter();
  response.statusCode = statusCode;
  response.destroyed = false;
  response.destroy = () => {
    response.destroyed = true;
    return response;
  };
  response.start = () => {
    for (const chunk of chunks) response.emit('data', chunk);
    if (end) response.emit('end');
  };
  return response;
}

async function runCase(label, fn) {
  try {
    await fn();
  } catch (error) {
    fail(label, error instanceof Error ? error.stack || error.message : String(error));
  }
}

await runCase('setup domain verification DNS rebinding behavior: mixed resolver results block before HTTP', async () => {
  const dnsMock = {
    lookup: async () => ([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.7', family: 4 }]),
    resolveTxt: async () => [],
  };
  const httpsMock = createHttpsMock(() => fail('unexpected HTTPS request after unsafe DNS result'));
  const verify = buildHarness({ dnsMock, httpsMock });
  const result = await verify({ origin: 'https://example.test/', method: 'well_known', token: 'abv_safe_token_123456' });
  if (!result.ok
    && result.networkExecution === false
    && result.evidence.httpRequestAttempted === false
    && result.evidence.dnsLookupAttempted === true
    && String(result.evidence.reason).includes('private')
    && httpsMock.calls.length === 0) {
    pass('setup domain verification DNS rebinding behavior: mixed resolver results block before HTTP');
  } else {
    fail('setup domain verification DNS rebinding behavior: mixed resolver result did not fail closed', JSON.stringify(result));
  }
});

await runCase('setup domain verification HTTPS pinning behavior: verified response uses pinned IP with original Host/SNI', async () => {
  const dnsMock = {
    lookup: async () => ([{ address: '93.184.216.34', family: 4 }, { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }]),
    resolveTxt: async () => [],
  };
  const httpsMock = createHttpsMock(({ callback }) => {
    const response = createResponse({ chunks: ['actionbridge-verification=abv_safe_token_123456\n'] });
    callback(response);
    response.start();
  });
  const verify = buildHarness({ dnsMock, httpsMock });
  const result = await verify({ origin: 'https://example.test/', method: 'well_known', token: 'abv_safe_token_123456' });
  const options = httpsMock.calls[0]?.options;
  if (result.ok
    && result.status === 'verified'
    && result.networkExecution === true
    && result.evidence.httpRequestAttempted === true
    && options?.host === '93.184.216.34'
    && options?.servername === 'example.test'
    && options?.headers?.Host === 'example.test'
    && options?.agent === false
    && options?.path === '/.well-known/actionbridge-verify.txt') {
    pass('setup domain verification HTTPS pinning behavior: verified response uses pinned IP with original Host/SNI');
  } else {
    fail('setup domain verification HTTPS pinning behavior: request was not pinned safely', JSON.stringify({ result, options }));
  }
});

await runCase('setup domain verification redirect behavior: 3xx is blocked and request/response are destroyed', async () => {
  const dnsMock = {
    lookup: async () => ([{ address: '93.184.216.34', family: 4 }]),
    resolveTxt: async () => [],
  };
  let redirectResponse;
  const httpsMock = createHttpsMock(({ callback }) => {
    redirectResponse = createResponse({ statusCode: 302, chunks: ['actionbridge-verification=abv_safe_token_123456'], end: false });
    callback(redirectResponse);
  });
  const verify = buildHarness({ dnsMock, httpsMock });
  const result = await verify({ origin: 'https://example.test/', method: 'well_known', token: 'abv_safe_token_123456' });
  const request = httpsMock.calls[0]?.request;
  if (!result.ok
    && result.evidence.redirectBlocked === true
    && result.evidence.httpStatus === 302
    && result.evidence.httpRequestAttempted === true
    && redirectResponse?.destroyed === true
    && request?.destroyed === true) {
    pass('setup domain verification redirect behavior: 3xx is blocked and request/response are destroyed');
  } else {
    fail('setup domain verification redirect behavior: redirect was not fail-closed', JSON.stringify({ result, requestDestroyed: request?.destroyed, responseDestroyed: redirectResponse?.destroyed }));
  }
});

await runCase('setup domain verification response cap behavior: oversize body fails closed and aborts request', async () => {
  const dnsMock = {
    lookup: async () => ([{ address: '93.184.216.34', family: 4 }]),
    resolveTxt: async () => [],
  };
  const httpsMock = createHttpsMock(({ callback }) => {
    const response = createResponse({ chunks: ['0123456789', 'oversize-body'] });
    callback(response);
    response.start();
  });
  const verify = buildHarness({ dnsMock, httpsMock, maxBytes: 12 });
  const result = await verify({ origin: 'https://example.test/', method: 'well_known', token: 'abv_safe_token_123456' });
  const request = httpsMock.calls[0]?.request;
  if (!result.ok
    && result.evidence.reason === 'ActionBridge response exceeds byte limit.'
    && result.evidence.bytes > 12
    && result.evidence.httpRequestAttempted === true
    && request?.destroyed === true) {
    pass('setup domain verification response cap behavior: oversize body fails closed and aborts request');
  } else {
    fail('setup domain verification response cap behavior: oversize response was not blocked', JSON.stringify({ result, requestDestroyed: request?.destroyed }));
  }
});

await runCase('setup domain verification slowloris behavior: stalled response hits hard HTTP deadline', async () => {
  const dnsMock = {
    lookup: async () => ([{ address: '93.184.216.34', family: 4 }]),
    resolveTxt: async () => [],
  };
  const httpsMock = createHttpsMock(({ callback }) => {
    const response = createResponse({ chunks: ['partial'], end: false });
    callback(response);
    response.start();
  });
  const verify = buildHarness({ dnsMock, httpsMock });
  const result = await verify({ origin: 'https://example.test/', method: 'meta_tag', token: 'abv_safe_token_123456' });
  const request = httpsMock.calls[0]?.request;
  if (!result.ok
    && result.evidence.reason === 'http_probe_timeout'
    && result.evidence.httpRequestAttempted === true
    && result.networkExecution === true
    && request?.destroyed === true) {
    pass('setup domain verification slowloris behavior: stalled response hits hard HTTP deadline');
  } else {
    fail('setup domain verification slowloris behavior: stalled response did not time out safely', JSON.stringify({ result, requestDestroyed: request?.destroyed }));
  }
});

await runCase('setup domain verification DNS timeout behavior: unresolved HTTP lookup fails before network', async () => {
  const dnsMock = {
    lookup: () => new Promise(() => {}),
    resolveTxt: async () => [],
  };
  const httpsMock = createHttpsMock(() => fail('unexpected HTTPS request after DNS timeout'));
  const verify = buildHarness({ dnsMock, httpsMock });
  const result = await verify({ origin: 'https://example.test/', method: 'well_known', token: 'abv_safe_token_123456' });
  if (!result.ok
    && result.evidence.reason === 'dns_lookup_timeout'
    && result.evidence.dnsLookupAttempted === true
    && result.evidence.httpRequestAttempted === false
    && result.networkExecution === false
    && httpsMock.calls.length === 0) {
    pass('setup domain verification DNS timeout behavior: unresolved HTTP lookup fails before network');
  } else {
    fail('setup domain verification DNS timeout behavior: lookup timeout did not fail closed', JSON.stringify(result));
  }
});

await runCase('setup domain verification DNS TXT timeout behavior: unresolved TXT lookup is bounded and does not try HTTP', async () => {
  const dnsMock = {
    lookup: async () => ([{ address: '93.184.216.34', family: 4 }]),
    resolveTxt: () => new Promise(() => {}),
  };
  const httpsMock = createHttpsMock(() => fail('unexpected HTTPS request for DNS TXT method'));
  const verify = buildHarness({ dnsMock, httpsMock });
  const result = await verify({ origin: 'https://example.test/', method: 'dns_txt', token: 'abv_safe_token_123456' });
  if (!result.ok
    && result.evidence.reason === 'dns_txt_lookup_timeout'
    && result.evidence.dnsLookupAttempted === true
    && result.evidence.httpRequestAttempted === false
    && result.networkExecution === true
    && httpsMock.calls.length === 0) {
    pass('setup domain verification DNS TXT timeout behavior: unresolved TXT lookup is bounded and does not try HTTP');
  } else {
    fail('setup domain verification DNS TXT timeout behavior: TXT timeout did not fail closed', JSON.stringify(result));
  }
});

process.exitCode = failed ? 1 : 0;
