#!/usr/bin/env node
import fs from 'node:fs';
import vm from 'node:vm';

let failed = 0;
const pass = (msg, detail = '') => console.log(`✅ ${msg}${detail ? ` — ${detail}` : ''}`);
const fail = (msg, detail = '') => { failed += 1; console.error(`❌ ${msg}${detail ? ` — ${detail}` : ''}`); };
const read = (file) => fs.readFileSync(file, 'utf8');

function extractFunction(source, functionName) {
  const start = source.indexOf(`function ${functionName}`);
  if (start < 0) throw new Error(`missing function ${functionName}`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${functionName}`);
}

function runExtractedFunction(file, functionName, calls) {
  const source = read(file);
  const fnSource = extractFunction(source, functionName)
    .replace(/: string \| null/g, '')
    .replace(/: string \| undefined/g, '')
    .replace(/: \{ ok: true; path: string \} \| \{ ok: false; reason: string \}/g, '')
    .replace(/value: unknown/g, 'value')
    .replace(/: unknown/g, '')
    .replace(/: string/g, '')
    .replace(/: null/g, '')
    .replace(/: boolean/g, '');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${fnSource}; globalThis.__fn = ${functionName};`, context);
  const fn = context.__fn;
  for (const [label, input, expected] of calls) {
    const actual = fn(input);
    if (actual === expected) pass(`${functionName}: ${label}`, `=> ${String(actual)}`);
    else fail(`${functionName}: ${label}`, `expected ${String(expected)}, got ${String(actual)}`);
  }
}

runExtractedFunction('src/frontend/app/api/actionbridge/connectors/route.ts', 'normalizeActionBridgeWebhookEndpointPath', [
  ['undefined defaults to root', undefined, '/'],
  ['empty defaults to root', '', '/'],
  ['relative path segment normalized', 'lead-submit', '/lead-submit'],
  ['absolute path accepted', '/hooks/actionbridge', '/hooks/actionbridge'],
  ['absolute URL rejected', 'https://evil.test/hook', null],
  ['scheme-relative URL rejected', '//evil.test/hook', null],
  ['query rejected fail-closed', '/hook?token=secret', null],
  ['hash rejected fail-closed', '/hook#frag', null],
  ['backslash rejected fail-closed', '/hook\\evil', null],
]);

const webhookDeliverySource = read('src/frontend/lib/actionbridge/webhook-delivery.ts');
const webhookPathFnSource = extractFunction(webhookDeliverySource, 'validateActionBridgeWebhookEndpointPath')
  .replace(/: string \| undefined/g, '')
  .replace(/: ActionBridgeWebhookEndpointPathValidation/g, '');
const webhookPathContext = {};
vm.createContext(webhookPathContext);
vm.runInContext(`${webhookPathFnSource}; globalThis.__fn = validateActionBridgeWebhookEndpointPath;`, webhookPathContext);
for (const [label, input, expected] of [
  ['undefined defaults to root', undefined, { ok: true, path: '/' }],
  ['relative path segment normalized', 'lead-submit', { ok: true, path: '/lead-submit' }],
  ['absolute path accepted', '/hooks/actionbridge', { ok: true, path: '/hooks/actionbridge' }],
  ['absolute URL rejected fail-closed', 'https://evil.test/hook', { ok: false }],
  ['scheme-relative URL rejected fail-closed', '//evil.test/hook', { ok: false }],
  ['query rejected fail-closed', '/hook?token=secret', { ok: false }],
  ['hash rejected fail-closed', '/hook#frag', { ok: false }],
  ['backslash rejected fail-closed', '/hook\\evil', { ok: false }],
]) {
  const actual = webhookPathContext.__fn(input);
  const matches = expected.ok ? actual.ok === true && actual.path === expected.path : actual.ok === false && typeof actual.reason === 'string';
  if (matches) pass(`validateActionBridgeWebhookEndpointPath: ${label}`, `=> ${JSON.stringify(actual)}`);
  else fail(`validateActionBridgeWebhookEndpointPath: ${label}`, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

for (const [label, pattern] of [
  ['delivery validates endpoint path before target validation', /const pathDecision = validateActionBridgeWebhookEndpointPath\(input\.path\)[\s\S]*networkExecution: false[\s\S]*const path = pathDecision\.path[\s\S]*validateActionBridgeTarget/],
  ['delivery no longer strips query or fragment from unsafe paths', /candidate\.includes\('\?'\) \|\| candidate\.includes\('#'\)/],
]) {
  if (pattern.test(webhookDeliverySource)) pass(`webhook delivery endpoint path behavior: ${label}`);
  else fail(`webhook delivery endpoint path behavior: ${label}`);
}

const signingSource = read('src/frontend/lib/actionbridge/webhook-signing.ts');
for (const [label, pattern] of [
  ['unsigned mode explicit branch exists', /signingMode === 'unsigned_pilot'/],
  ['hmac mode requires normalized secret ref', /if \(!secretRef\)/],
  ['unresolved secret has ok false', /secret_ref_unresolved[\s\S]*ok: false|ok: false[\s\S]*secret_ref_unresolved/],
  ['raw env value is not placed in resultSummary', /resultSummary: \{ signing: 'hmac_sha256', secretRefDigest/],
]) {
  if (pattern.test(signingSource)) pass(`webhook signing source behavior: ${label}`);
  else fail(`webhook signing source behavior: ${label}`);
}

const executeRoute = read('src/frontend/app/api/actionbridge/execute/route.ts');
for (const [label, pattern] of [
  ['quarantine lookup error fails closed before signing/delivery', /activeQuarantine\.error[\s\S]*webhook_quarantine_lookup_failed[\s\S]*networkExecution: false[\s\S]*else if \(activeQuarantine\.quarantined\)/],
  ['execute checks durable quarantine before signing/delivery', /activeQuarantine\.quarantined[\s\S]*webhook_connector_quarantined[\s\S]*networkExecution: false/],
  ['signing resolution only occurs after lookup error and active quarantine branches', /else \{[\s\S]*const signingResolution = resolveActionBridgeWebhookSigningSecret/],
  ['unresolved signing ref blocks before throttle and delivery imports are called', /if \(!signingResolution\.ok\) \{[\s\S]*webhook_signing_secret_unresolved[\s\S]*networkExecution: false[\s\S]*\} else \{[\s\S]*const webhookThrottle = decideActionBridgeWebhookDeliveryThrottle[\s\S]*deliverActionBridgeWebhook/],
  ['repeated pilot failures persist durable quarantine', /persistActionBridgeWebhookFailureQuarantine[\s\S]*quarantine_required/],
  ['durable quarantine persistence failure is surfaced', /durablePersistenceStatus[\s\S]*ACTIONBRIDGE_CONNECTOR_QUARANTINE_PERSIST_FAILED/],
]) {
  if (pattern.test(executeRoute)) pass(`execute route durable quarantine behavior: ${label}`);
  else fail(`execute route durable quarantine behavior: ${label}`);
}

const quarantineSource = read('src/frontend/lib/actionbridge/webhook-quarantine.ts');
for (const [label, pattern] of [
  ['quarantine view is redacted', /redactActionBridgeValue\(row\.redacted_context/],
  ['active quarantine lookup is owner and connector scoped', /eq\('user_id', input\.userId\)[\s\S]*eq\('connector_id', input\.connectorId\)[\s\S]*eq\('status', 'active'\)/],
  ['persistent quarantine uses repeated failure reason', /reason_code: 'webhook_repeated_failures'/],
]) {
  if (pattern.test(quarantineSource)) pass(`webhook quarantine source behavior: ${label}`);
  else fail(`webhook quarantine source behavior: ${label}`);
}

const errorsRoute = read('src/frontend/app/api/actionbridge/errors/route.ts');
const statusUpdateIndex = errorsRoute.indexOf(".update({");
const statusPredicateIndex = errorsRoute.indexOf(".eq('status', currentStatus)");
if (statusUpdateIndex > 0 && statusPredicateIndex > statusUpdateIndex) pass('error lifecycle route uses compare-and-set status predicate after update builder');
else fail('error lifecycle route compare-and-set predicate missing or misplaced');

const transitionSnippet = errorsRoute.slice(errorsRoute.indexOf('const allowed ='), errorsRoute.indexOf('if (!allowed)'));
for (const token of ["currentStatus === 'open'", "nextStatus === 'acknowledged'", "nextStatus === 'resolved'", "currentStatus === 'acknowledged'", 'currentStatus === nextStatus']) {
  if (transitionSnippet.includes(token)) pass(`error lifecycle transition token: ${token}`);
  else fail(`error lifecycle transition token missing: ${token}`);
}

process.exitCode = failed ? 1 : 0;
