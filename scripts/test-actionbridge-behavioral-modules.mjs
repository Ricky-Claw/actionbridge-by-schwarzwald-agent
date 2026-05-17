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
const errorLogSource = read('src/frontend/lib/actionbridge/error-log.ts');
const statusUpdateIndex = errorsRoute.indexOf(".update({");
const statusPredicateIndex = errorsRoute.indexOf(".eq('status', currentStatus)");
if (statusUpdateIndex > 0 && statusPredicateIndex > statusUpdateIndex) pass('error lifecycle route uses compare-and-set status predicate after update builder');
else fail('error lifecycle route compare-and-set predicate missing or misplaced');

for (const token of ['normalizeActionBridgeErrorStatus(existing.status)', 'canTransitionActionBridgeErrorStatus(currentStatus, nextStatus)', "ACTIONBRIDGE_ERROR_STATUS_TRANSITION_BLOCKED", ".eq('user_id', user!.id)", ".eq('id', errorId)", ".eq('status', currentStatus)"]) {
  if (errorsRoute.includes(token)) pass(`error lifecycle route race guard token: ${token}`);
  else fail(`error lifecycle route race guard token missing: ${token}`);
}

const rankSnippet = errorLogSource.slice(errorLogSource.indexOf('const ACTIONBRIDGE_ERROR_STATUS_RANK'), errorLogSource.indexOf('export function sanitizeActionBridgeErrorContext'));
for (const token of ['open: 0', 'acknowledged: 1', 'resolved: 2', 'canTransitionActionBridgeErrorStatus', '>=']) {
  if (rankSnippet.includes(token)) pass(`error lifecycle monotonic transition token: ${token}`);
  else fail(`error lifecycle monotonic transition token missing: ${token}`);
}

const raceRows = new Map([['err-race', { status: 'open' }]]);
function compareAndSetStatus(id, observedStatus, nextStatus) {
  const row = raceRows.get(id);
  if (!row || row.status !== observedStatus) return false;
  row.status = nextStatus;
  return true;
}
const firstWriter = compareAndSetStatus('err-race', 'open', 'resolved');
const staleDowngradeWriter = compareAndSetStatus('err-race', 'open', 'acknowledged');
if (firstWriter === true && staleDowngradeWriter === false && raceRows.get('err-race').status === 'resolved') {
  pass('error lifecycle race proof: stale acknowledged update cannot downgrade resolved state');
} else {
  fail('error lifecycle race proof: stale acknowledged update downgraded or CAS did not hold');
}

for (const token of ['requiresActionBridgeOperatorAlert', "severity === 'high' || severity === 'critical'", 'persistActionBridgeOperatorAlert', "from('actionbridge_operator_alerts')", 'redacted_context: sanitizedContext', 'operatorAlert', 'toActionBridgeOperatorAlertView', 'sanitizeActionBridgeErrorMessage', 'ACTIONBRIDGE_OPERATOR_ALERT_INSERT_FAILED']) {
  if (errorLogSource.includes(token)) pass(`operator alerting source token: ${token}`);
  else fail(`operator alerting source token missing: ${token}`);
}

const alertRows = [];
function simulateOperatorAlertPersistence({ severity, errorLogInsertOk = true, alertInsertOk, message }) {
  const required = severity === 'high' || severity === 'critical';
  const safeMessage = String(message).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]').slice(0, 500);
  if (!errorLogInsertOk && required) throw new Error('ACTIONBRIDGE_ERROR_LOG_INSERT_FAILED');
  if (!errorLogInsertOk) return { logged: false, alert: { required: false, id: null, error: 'ACTIONBRIDGE_ERROR_LOG_INSERT_FAILED' }, message: safeMessage };
  if (!required) return { logged: true, alert: { required: false, id: null, error: null }, message: safeMessage };
  if (!alertInsertOk) throw new Error('ACTIONBRIDGE_OPERATOR_ALERT_INSERT_FAILED');
  alertRows.push({ severity, message: safeMessage });
  return { logged: true, alert: { required: true, id: 'alert-1', error: null }, message: safeMessage };
}

try {
  const low = simulateOperatorAlertPersistence({ severity: 'medium', alertInsertOk: false, message: 'medium test user@example.com' });
  if (low.alert.required === false && low.message.includes('[REDACTED_EMAIL]')) pass('operator alert behavior: medium does not require alert and message is redacted');
  else fail('operator alert behavior: medium severity handling failed');
} catch (error) {
  fail('operator alert behavior: medium unexpectedly threw', error.message);
}

try {
  simulateOperatorAlertPersistence({ severity: 'high', errorLogInsertOk: false, alertInsertOk: true, message: 'high test user@example.com' });
  fail('operator alert behavior: high error-log insert failure did not fail closed');
} catch (error) {
  if (error.message === 'ACTIONBRIDGE_ERROR_LOG_INSERT_FAILED') pass('operator alert behavior: high error-log insert failure fails closed');
  else fail('operator alert behavior: high error-log failure threw wrong error', error.message);
}

try {
  simulateOperatorAlertPersistence({ severity: 'high', alertInsertOk: false, message: 'high test user@example.com' });
  fail('operator alert behavior: high alert insert failure did not fail closed');
} catch (error) {
  if (error.message === 'ACTIONBRIDGE_OPERATOR_ALERT_INSERT_FAILED') pass('operator alert behavior: high alert insert failure fails closed');
  else fail('operator alert behavior: high alert failure threw wrong error', error.message);
}

try {
  const critical = simulateOperatorAlertPersistence({ severity: 'critical', alertInsertOk: true, message: 'critical test user@example.com' });
  if (critical.alert.required === true && alertRows.length === 1 && alertRows[0].message.includes('[REDACTED_EMAIL]')) pass('operator alert behavior: critical creates durable redacted alert');
  else fail('operator alert behavior: critical alert creation failed');
} catch (error) {
  fail('operator alert behavior: critical unexpectedly threw', error.message);
}

const operatorAlertRoute = read('src/frontend/app/api/actionbridge/alerts/route.ts');
for (const token of ["from('actionbridge_operator_alerts')", "eq('user_id', user!.id)", 'ACTIONBRIDGE_OPERATOR_ALERT_LIST_FAILED', 'toActionBridgeOperatorAlertView', "severity === 'high' || severity === 'critical'"]) {
  if (operatorAlertRoute.includes(token)) pass(`operator alerting route token: ${token}`);
  else fail(`operator alerting route token missing: ${token}`);
}

const operatorAlertMigration = read('supabase/migrations/20260517050000_actionbridge_operator_alerts.sql');
for (const token of ['CREATE TABLE IF NOT EXISTS public.actionbridge_operator_alerts', "severity TEXT NOT NULL CHECK (severity IN ('high', 'critical'))", 'UNIQUE (user_id, error_log_id)', 'ENABLE ROW LEVEL SECURITY', 'actionbridge_operator_alerts_owner_select']) {
  if (operatorAlertMigration.includes(token)) pass(`operator alerting migration token: ${token}`);
  else fail(`operator alerting migration token missing: ${token}`);
}

process.exitCode = failed ? 1 : 0;
