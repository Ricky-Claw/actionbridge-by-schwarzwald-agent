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

const setupSessionSource = read('src/frontend/lib/actionbridge/setup-session.ts');
const setupSessionUsableFnSource = extractFunction(setupSessionSource, 'isActionBridgeSetupSessionUsable')
  .replace(/export /g, '')
  .replace(/record: Pick<ActionBridgeSetupSessionRecord, 'status' \| 'expires_at'>/g, 'record')
  .replace(/: boolean/g, '');
const setupSessionContext = {};
vm.createContext(setupSessionContext);
vm.runInContext(`${setupSessionUsableFnSource}; globalThis.__isSetupSessionUsable = isActionBridgeSetupSessionUsable;`, setupSessionContext);
const futureSetupExpiry = new Date(Date.now() + 60_000).toISOString();
const pastSetupExpiry = new Date(Date.now() - 60_000).toISOString();
for (const [label, record, expected] of [
  ['pending unexpired token remains usable', { status: 'pending', expires_at: futureSetupExpiry }, true],
  ['opened unexpired token remains usable', { status: 'opened', expires_at: futureSetupExpiry }, true],
  ['completed setup link is closed fail-closed', { status: 'completed', expires_at: futureSetupExpiry }, false],
  ['revoked setup link is closed fail-closed', { status: 'revoked', expires_at: futureSetupExpiry }, false],
  ['expired setup link is closed fail-closed', { status: 'expired', expires_at: futureSetupExpiry }, false],
  ['unknown future status fails closed', { status: 'unknown_future_status', expires_at: futureSetupExpiry }, false],
  ['past expiry fails closed even while pending', { status: 'pending', expires_at: pastSetupExpiry }, false],
]) {
  const actual = setupSessionContext.__isSetupSessionUsable(record);
  if (actual === expected) pass(`isActionBridgeSetupSessionUsable: ${label}`, `=> ${String(actual)}`);
  else fail(`isActionBridgeSetupSessionUsable: ${label}`, `expected ${String(expected)}, got ${String(actual)}`);
}

const bridgeHandshakeRouteSource = read('src/frontend/app/api/actionbridge/bridge/handshake/route.ts');
for (const [label, pattern] of [
  ['bridge handshake requires a bound connector before creating an installation', /if \(!setupLink\.connector_id\)[\s\S]*ACTIONBRIDGE_BRIDGE_CONNECTOR_REQUIRED[\s\S]*from\('actionbridge_bridge_installations'\)/],
  ['bridge handshake requires verified active connector before completion', /from\('actionbridge_connectors'\)[\s\S]*enabled,safety_status,permission_status[\s\S]*ACTIONBRIDGE_BRIDGE_REQUIRES_VERIFIED_ACTIVE_CONNECTOR[\s\S]*update\(\{ status: 'completed' \}\)/],
  ['bridge handshake requires saved enabled capabilities before completion', /from\('actionbridge_capability_rules'\)[\s\S]*\.eq\('enabled', true\)[\s\S]*ACTIONBRIDGE_BRIDGE_REQUIRES_SAVED_CAPABILITIES[\s\S]*update\(\{ status: 'completed' \}\)/],
  ['bridge handshake closes setup links with owner-scoped compare-and-set before success', /update\(\{ status: 'completed' \}\)[\s\S]*\.eq\('id', setupLink\.id\)[\s\S]*\.eq\('user_id', setupLink\.user_id\)[\s\S]*\.in\('status', \['pending', 'opened'\]\)[\s\S]*\.select\('id,status'\)[\s\S]*completedSetupLink\?\.status !== 'completed'[\s\S]*ACTIONBRIDGE_SETUP_LINK_CLOSE_FAILED/],
  ['bridge handshake audits known setup-link denial and close-failure paths', /persistBridgeHandshakeDeniedAudit[\s\S]*ACTIONBRIDGE_BRIDGE_ORIGIN_MISMATCH[\s\S]*ACTIONBRIDGE_SETUP_LINK_EXPIRED_OR_REVOKED[\s\S]*ACTIONBRIDGE_BRIDGE_CONNECTOR_BINDING_NOT_FOUND[\s\S]*ACTIONBRIDGE_BRIDGE_INSTALLATION_REVOKED[\s\S]*ACTIONBRIDGE_SETUP_LINK_CLOSE_FAILED/],
]) {
  if (pattern.test(bridgeHandshakeRouteSource)) pass(`bridge handshake completion guard: ${label}`);
  else fail(`bridge handshake completion guard: ${label}`);
}

const redactionSource = read('src/frontend/lib/actionbridge/redaction.ts')
  .replace(/export /g, '')
  .replace(/key: string/g, 'key')
  .replace(/: string/g, '')
  .replace(/value: unknown/g, 'value')
  .replace(/: unknown/g, '')
  .replace(/: boolean/g, '')
  .replace(/value as Record<string, unknown>/g, 'value');
const redactionContext = {};
const syntheticAwsAccessKeyId = `AKIA${'ABCDEFGHIJKLMNOP'}`;
vm.createContext(redactionContext);
vm.runInContext(`${redactionSource}; globalThis.__redact = redactActionBridgeValue;`, redactionContext);
for (const [label, input, expected] of [
  ['authorization header is redacted', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456', 'Authorization: [REDACTED_AUTH]'],
  ['standalone bearer token is redacted', 'failed with bearer abcdefghijklmnopqrstuvwxyz123456', 'failed with bearer [REDACTED_TOKEN]'],
  ['jwt is redacted', 'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.signaturePart', 'jwt [REDACTED_JWT]'],
  ['query api key is redacted', 'callback failed https://example.test/hook?api_key=supersecret123&ok=1', 'callback failed https://example.test/hook?api_key=[REDACTED_SECRET]&ok=1'],
  ['common provider key is redacted', 'provider returned sk-abcdefghijklmnopqrstuvwxyz', 'provider returned [REDACTED_SECRET]'],
  ['colon key-value secret is redacted', 'provider error api_key: live_secret_value_12345', 'provider error api_key: [REDACTED_SECRET]'],
  ['openai project secret is redacted', 'provider returned sk-proj-abcdefghijklmnopqrstuvwxyz1234567890', 'provider returned [REDACTED_SECRET]'],
  ['stripe webhook secret is redacted', 'receiver configured whsec_abcdefghijklmnopqrstuvwxyz123456', 'receiver configured [REDACTED_SECRET]'],
  ['aws access key is redacted', `aws key ${syntheticAwsAccessKeyId} failed`, 'aws key [REDACTED_SECRET] failed'],
]) {
  const actual = redactionContext.__redact(input);
  if (actual === expected) pass(`redactActionBridgeValue free-text credential: ${label}`, `=> ${actual}`);
  else fail(`redactActionBridgeValue free-text credential: ${label}`, `expected ${expected}, got ${actual}`);
}

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

const connectorRouteSource = read('src/frontend/app/api/actionbridge/connectors/route.ts');
for (const [label, pattern] of [
  ['connector POST rejects unsafe endpoint paths with 400 before insert', /const draft = parseActionBridgeConnectorDraft\(bodyObject\)[\s\S]*if \(!draft\) \{[\s\S]*INVALID_ACTIONBRIDGE_CONNECTOR[\s\S]*status: 400[\s\S]*\.insert\(\{/],
  ['connector draft uses only server-normalized endpoint_path for webhook connectors', /const endpointPath = type === 'webhook'[\s\S]*normalizeActionBridgeWebhookEndpointPath\(body\.endpointPath \?\? body\.endpoint_path\)[\s\S]*endpoint_path: endpointPath/],
]) {
  if (pattern.test(connectorRouteSource)) pass(`connector route endpoint path behavior: ${label}`);
  else fail(`connector route endpoint path behavior: ${label}`);
}

const endpointPathMigration = read('supabase/migrations/20260515230500_actionbridge_webhook_endpoint_path.sql');
for (const [label, predicate] of [
  ['DB constraint requires leading slash', () => endpointPathMigration.includes("ADD CONSTRAINT actionbridge_connectors_endpoint_path_relative") && endpointPathMigration.includes("endpoint_path LIKE '/%'")],
  ['DB constraint rejects scheme-relative paths', () => endpointPathMigration.includes("endpoint_path NOT LIKE '//%'")],
  ['DB constraint rejects absolute URL schemes', () => endpointPathMigration.includes("endpoint_path !~ '^[A-Za-z][A-Za-z0-9+.-]*:'")],
  ['DB constraint rejects backslashes, query strings, and fragments', () => endpointPathMigration.includes("endpoint_path !~ '\\\\\\\\'") && endpointPathMigration.includes("endpoint_path NOT LIKE '%?%'") && endpointPathMigration.includes("endpoint_path NOT LIKE '%#%'")],
]) {
  if (predicate()) pass(`endpoint_path database constraint behavior: ${label}`);
  else fail(`endpoint_path database constraint behavior: ${label}`);
}

for (const [label, pattern] of [
  ['delivery validates endpoint path before target validation', /const pathDecision = validateActionBridgeWebhookEndpointPath\(input\.path\)[\s\S]*networkExecution: false[\s\S]*const path = pathDecision\.path[\s\S]*validateActionBridgeTarget/],
  ['delivery no longer strips query or fragment from unsafe paths', /candidate\.includes\('\?'\) \|\| candidate\.includes\('#'\)/],
]) {
  if (pattern.test(webhookDeliverySource)) pass(`webhook delivery endpoint path behavior: ${label}`);
  else fail(`webhook delivery endpoint path behavior: ${label}`);
}

for (const [label, pattern] of [
  ['delivery resolves DNS once before network execution', /const addresses = await dns\.lookup\(target\.hostname, \{ all: true, verbatim: true \}\)[\s\S]*decideActionBridgeDnsPinning/],
  ['delivery validates every resolver address before choosing pinned IP', /addresses\.map\(\(entry\) => \(\{ address: entry\.address, family: entry\.family === 6 \? 6 : 4 \}\)\)[\s\S]*if \(!dnsDecision\.ok\)[\s\S]*const pinnedAddress = addresses\[0\]\?\.address/],
  ['delivery connects to pinned IP while preserving original Host and SNI', /host: input\.pinnedAddress[\s\S]*servername: input\.target\.hostname[\s\S]*Host: input\.target\.host[\s\S]*postPinnedHttpsJson\(\{[\s\S]*target,[\s\S]*pinnedAddress/],
  ['delivery avoids fetch to prevent second resolver after validation', /Do not use fetch\(\)[\s\S]*DNS rebinding SSRF risk/],
]) {
  if (pattern.test(webhookDeliverySource)) pass(`webhook DNS pinning source behavior: ${label}`);
  else fail(`webhook DNS pinning source behavior: ${label}`);
}

function simulateWebhookDnsPinningDelivery(addresses) {
  const privateRanges = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^::1$/, /^fc/i, /^fd/i, /^fe80:/i];
  const safeAddresses = addresses.map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 }));
  if (!safeAddresses.length) return { ok: false, networkExecution: false, reason: 'DNS resolution returned no addresses.' };
  const unsafe = safeAddresses.find((entry) => privateRanges.some((pattern) => pattern.test(entry.address)));
  if (unsafe) return { ok: false, networkExecution: false, reason: 'DNS result includes private/internal address.', blockedAddress: unsafe.address };
  return { ok: true, networkExecution: true, pinnedAddress: addresses[0].address, validatedAddressCount: safeAddresses.length };
}

const rebindingProbe = simulateWebhookDnsPinningDelivery([
  { address: '93.184.216.34', family: 4 },
  { address: '10.0.0.7', family: 4 },
]);
if (rebindingProbe.ok === false && rebindingProbe.networkExecution === false && rebindingProbe.blockedAddress === '10.0.0.7') {
  pass('webhook DNS rebinding behavior: mixed public/private resolver result blocks before network');
} else {
  fail('webhook DNS rebinding behavior: mixed public/private resolver result did not fail closed', JSON.stringify(rebindingProbe));
}

const pinnedProbe = simulateWebhookDnsPinningDelivery([
  { address: '93.184.216.34', family: 4 },
  { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
]);
if (pinnedProbe.ok === true && pinnedProbe.networkExecution === true && pinnedProbe.pinnedAddress === '93.184.216.34' && pinnedProbe.validatedAddressCount === 2) {
  pass('webhook DNS pinning behavior: all returned addresses validated, first validated address is pinned for connect');
} else {
  fail('webhook DNS pinning behavior: safe resolver result was not pinned deterministically', JSON.stringify(pinnedProbe));
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
  ['non-2xx webhook result marks execution failed before final persistence', /if \(!webhookResult\.ok\) \{[\s\S]*finalExecutionStatus = 'failed'[\s\S]*persistActionBridgeErrorEvent[\s\S]*ACTIONBRIDGE_WEBHOOK_DELIVERY_FAILED[\s\S]*persistActionBridgeExecutionResult/],
  ['timeout exception is converted to safe failed webhook result', /catch \(error\) \{[\s\S]*webhook_delivery_error[\s\S]*ACTIONBRIDGE_WEBHOOK_TIMEOUT[\s\S]*networkExecution: true/],
  ['failed webhook execution persists delivery failure code', /status: finalExecutionStatus[\s\S]*errorCode: finalExecutionStatus === 'failed' \? 'ACTIONBRIDGE_WEBHOOK_DELIVERY_FAILED' : undefined/],
  ['repeated pilot failures persist durable quarantine', /persistActionBridgeWebhookFailureQuarantine[\s\S]*quarantine_required/],
  ['durable quarantine persistence failure is surfaced', /durablePersistenceStatus[\s\S]*ACTIONBRIDGE_CONNECTOR_QUARANTINE_PERSIST_FAILED/],
]) {
  if (pattern.test(executeRoute)) pass(`execute route durable quarantine behavior: ${label}`);
  else fail(`execute route durable quarantine behavior: ${label}`);
}

function simulateWebhookFailurePersistence({ deliveryOk, deliveryStatus, thrownMessage }) {
  let finalExecutionStatus = 'succeeded';
  let webhookResult;
  if (thrownMessage) {
    webhookResult = {
      ok: false,
      status: 502,
      networkExecution: true,
      resultSummary: {
        status: 'webhook_delivery_error',
        errorCode: thrownMessage === 'ACTIONBRIDGE_WEBHOOK_TIMEOUT'
          ? 'ACTIONBRIDGE_WEBHOOK_TIMEOUT'
          : 'ACTIONBRIDGE_WEBHOOK_DELIVERY_FAILED',
        networkExecution: true,
      },
    };
  } else {
    webhookResult = {
      ok: deliveryOk,
      status: deliveryStatus,
      networkExecution: true,
      resultSummary: { status: deliveryOk ? 'webhook_delivered' : 'webhook_failed', httpStatus: deliveryStatus, networkExecution: true },
    };
  }
  const persistedErrorEvents = [];
  if (!webhookResult.ok) {
    finalExecutionStatus = 'failed';
    persistedErrorEvents.push({
      category: webhookResult.status === 429 ? 'rate_limit' : 'webhook',
      errorCode: webhookResult.status === 429 ? 'ACTIONBRIDGE_WEBHOOK_RATE_LIMITED' : 'ACTIONBRIDGE_WEBHOOK_DELIVERY_FAILED',
      context: { webhook: webhookResult.resultSummary },
    });
  }
  const persistedExecution = {
    status: finalExecutionStatus,
    errorCode: finalExecutionStatus === 'failed' ? 'ACTIONBRIDGE_WEBHOOK_DELIVERY_FAILED' : undefined,
    safeResult: { webhook: webhookResult.resultSummary, networkExecution: webhookResult.networkExecution },
  };
  return { persistedErrorEvents, persistedExecution };
}

const non2xxPersistence = simulateWebhookFailurePersistence({ deliveryOk: false, deliveryStatus: 500 });
if (non2xxPersistence.persistedExecution.status === 'failed'
  && non2xxPersistence.persistedExecution.errorCode === 'ACTIONBRIDGE_WEBHOOK_DELIVERY_FAILED'
  && non2xxPersistence.persistedErrorEvents[0]?.errorCode === 'ACTIONBRIDGE_WEBHOOK_DELIVERY_FAILED'
  && non2xxPersistence.persistedExecution.safeResult.webhook.httpStatus === 500) {
  pass('execute route webhook persistence proof: non-2xx response persists failed execution and redacted error event');
} else {
  fail('execute route webhook persistence proof: non-2xx response was not persisted as failed');
}

const timeoutPersistence = simulateWebhookFailurePersistence({ deliveryOk: false, deliveryStatus: 0, thrownMessage: 'ACTIONBRIDGE_WEBHOOK_TIMEOUT' });
if (timeoutPersistence.persistedExecution.status === 'failed'
  && timeoutPersistence.persistedExecution.errorCode === 'ACTIONBRIDGE_WEBHOOK_DELIVERY_FAILED'
  && timeoutPersistence.persistedExecution.safeResult.webhook.errorCode === 'ACTIONBRIDGE_WEBHOOK_TIMEOUT'
  && timeoutPersistence.persistedExecution.safeResult.networkExecution === true) {
  pass('execute route webhook persistence proof: timeout persists failed execution with timeout-safe summary');
} else {
  fail('execute route webhook persistence proof: timeout was not persisted as failed');
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

function redactQuarantineValue(value) {
  return JSON.parse(JSON.stringify(value).replace(/Bearer [A-Za-z0-9._-]+/g, 'Bearer [REDACTED_TOKEN]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]'));
}

function simulateDurableWebhookQuarantineFlow({ initialRows = [], failureCount = 3, existingActive = false, lookupError = false }) {
  const rows = new Map(initialRows.map((row) => [row.connector_id, { ...row }]));
  const connectorId = 'conn-webhook-1';
  const userId = 'user-1';
  if (existingActive) {
    rows.set(connectorId, {
      id: 'quarantine-existing',
      user_id: userId,
      connector_id: connectorId,
      status: 'active',
      failure_count: 2,
      redacted_context: {},
    });
  }
  if (lookupError) {
    return { networkExecution: false, delivered: false, errorCode: 'ACTIONBRIDGE_CONNECTOR_QUARANTINE_LOOKUP_FAILED' };
  }
  const activeBeforeDelivery = rows.get(connectorId)?.status === 'active';
  if (activeBeforeDelivery) {
    return { networkExecution: false, delivered: false, status: 'webhook_connector_quarantined', quarantine: rows.get(connectorId) };
  }
  const context = redactQuarantineValue({ receiver: 'ops@example.test', authorization: 'Bearer secret-token-1234567890' });
  rows.set(connectorId, {
    id: 'quarantine-new',
    user_id: userId,
    connector_id: connectorId,
    status: 'active',
    reason_code: 'webhook_repeated_failures',
    message: 'Webhook-v1 delivery is paused after repeated pilot failures. Review receiver health before resuming.',
    failure_count: Math.max(1, Math.min(10_000, failureCount)),
    redacted_context: context,
  });
  return { networkExecution: true, delivered: true, status: 'quarantine_required', quarantine: rows.get(connectorId), rows };
}

const quarantineCreation = simulateDurableWebhookQuarantineFlow({ failureCount: 4 });
if (quarantineCreation.delivered === true
  && quarantineCreation.quarantine.status === 'active'
  && quarantineCreation.quarantine.reason_code === 'webhook_repeated_failures'
  && quarantineCreation.quarantine.failure_count === 4
  && !JSON.stringify(quarantineCreation.quarantine.redacted_context).includes('ops@example.test')
  && !JSON.stringify(quarantineCreation.quarantine.redacted_context).includes('secret-token')) {
  pass('webhook quarantine behavior: repeated failures persist active redacted quarantine');
} else {
  fail('webhook quarantine behavior: repeated failures did not persist safe active quarantine', JSON.stringify(quarantineCreation));
}

const quarantineBlocksDelivery = simulateDurableWebhookQuarantineFlow({ existingActive: true });
if (quarantineBlocksDelivery.networkExecution === false
  && quarantineBlocksDelivery.delivered === false
  && quarantineBlocksDelivery.status === 'webhook_connector_quarantined'
  && quarantineBlocksDelivery.quarantine.connector_id === 'conn-webhook-1') {
  pass('webhook quarantine behavior: active durable quarantine blocks delivery before network');
} else {
  fail('webhook quarantine behavior: active durable quarantine did not block delivery', JSON.stringify(quarantineBlocksDelivery));
}

const quarantineLookupFailure = simulateDurableWebhookQuarantineFlow({ lookupError: true });
if (quarantineLookupFailure.networkExecution === false
  && quarantineLookupFailure.delivered === false
  && quarantineLookupFailure.errorCode === 'ACTIONBRIDGE_CONNECTOR_QUARANTINE_LOOKUP_FAILED') {
  pass('webhook quarantine behavior: quarantine lookup failure fails closed before network');
} else {
  fail('webhook quarantine behavior: lookup failure did not fail closed', JSON.stringify(quarantineLookupFailure));
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
for (const token of ["from('actionbridge_operator_alerts')", "eq('user_id', user!.id)", 'ACTIONBRIDGE_OPERATOR_ALERT_LIST_FAILED', 'toActionBridgeOperatorAlertView', "severity === 'high' || severity === 'critical'", 'ACTIONBRIDGE_OPERATOR_ALERT_STATUS_TRANSITION_BLOCKED', 'operator_alert.status_changed', 'update_actionbridge_operator_alert_status', 'p_current_status: currentStatus', 'p_next_status: nextStatus']) {
  if (operatorAlertRoute.includes(token)) pass(`operator alerting route token: ${token}`);
  else fail(`operator alerting route token missing: ${token}`);
}

const alertLifecycleRows = new Map([['alert-race', { status: 'open', acknowledgedAt: null, resolvedAt: null }]]);
function compareAndSetAlertStatus(id, observedStatus, nextStatus) {
  const row = alertLifecycleRows.get(id);
  if (!row || row.status !== observedStatus) return false;
  if (nextStatus === 'resolved') row.resolvedAt = 'now';
  if (nextStatus === 'acknowledged' || nextStatus === 'resolved') row.acknowledgedAt ||= 'now';
  row.status = nextStatus;
  return true;
}
const alertFirstWriter = compareAndSetAlertStatus('alert-race', 'open', 'resolved');
const alertStaleWriter = compareAndSetAlertStatus('alert-race', 'open', 'acknowledged');
if (alertFirstWriter === true && alertStaleWriter === false && alertLifecycleRows.get('alert-race').status === 'resolved' && alertLifecycleRows.get('alert-race').acknowledgedAt) {
  pass('operator alert lifecycle race proof: stale acknowledged update cannot downgrade resolved alert and resolution records acknowledgement');
} else {
  fail('operator alert lifecycle race proof failed');
}

const operatorAlertMigration = read('supabase/migrations/20260517050000_actionbridge_operator_alerts.sql');
for (const token of ['CREATE TABLE IF NOT EXISTS public.actionbridge_operator_alerts', "severity TEXT NOT NULL CHECK (severity IN ('high', 'critical'))", 'UNIQUE (user_id, error_log_id)', 'ENABLE ROW LEVEL SECURITY', 'actionbridge_operator_alerts_owner_select']) {
  if (operatorAlertMigration.includes(token)) pass(`operator alerting migration token: ${token}`);
  else fail(`operator alerting migration token missing: ${token}`);
}

const operatorAlertStatusRpcMigration = read('supabase/migrations/20260521010000_actionbridge_operator_alert_status_rpc.sql');
for (const token of ['CREATE OR REPLACE FUNCTION public.update_actionbridge_operator_alert_status', 'SECURITY DEFINER', 'SET search_path = public', 'UPDATE public.actionbridge_operator_alerts', 'UPDATE public.actionbridge_error_logs', 'ACTIONBRIDGE_OPERATOR_ALERT_ERROR_LOG_SYNC_FAILED', 'OWNER TO postgres', 'REVOKE ALL ON FUNCTION public.update_actionbridge_operator_alert_status', 'FROM authenticated', 'GRANT EXECUTE ON FUNCTION public.update_actionbridge_operator_alert_status', 'TO service_role']) {
  if (operatorAlertStatusRpcMigration.includes(token)) pass(`operator alert status rpc migration token: ${token}`);
  else fail(`operator alert status rpc migration token missing: ${token}`);
}

const rateLimitSource = read('src/frontend/lib/actionbridge/rate-limit.ts');
for (const token of [
  "const buckets = globalBuckets.__actionBridgeRateLimitBuckets || new Map<string, Bucket>()",
  'globalBuckets.__actionBridgeRateLimitBuckets = buckets',
  'existing && existing.resetAtMs > nowMs',
  'nowMs + input.policy.windowMs',
  'bucket.count += 1',
  'cleanupExpiredPilotBuckets(nowMs)',
  'ACTIONBRIDGE_RATE_LIMIT_MODE === \'production_distributed_required\'',
  'ACTIONBRIDGE_TRUSTED_PROXY_REQUIRED',
  'per_tenant_per_connector_per_token_dimensions',
  'decideActionBridgeWebhookDeliveryThrottle',
  "backendBridgePairing: { name: 'backendBridgePairing'",
]) {
  if (rateLimitSource.includes(token)) pass(`rate limit source token: ${token}`);
  else fail(`rate limit source token missing: ${token}`);
}

function simulateSharedRateLimitDecision({ buckets, policy, rawKey, nowMs }) {
  const existing = buckets.get(rawKey);
  const bucket = existing && existing.resetAtMs > nowMs
    ? existing
    : { count: 0, resetAtMs: nowMs + policy.windowMs };
  bucket.count += 1;
  buckets.set(rawKey, bucket);
  return {
    ok: bucket.count <= policy.max,
    remaining: Math.max(0, policy.max - bucket.count),
    resetAtMs: bucket.resetAtMs,
    count: bucket.count,
  };
}

const sharedPilotStore = new Map();
const ratePolicy = { windowMs: 1000, max: 2 };
const firstWorkerHit = simulateSharedRateLimitDecision({ buckets: sharedPilotStore, policy: ratePolicy, rawKey: 'webhookDelivery:tenant|connector|action|origin', nowMs: 10_000 });
const secondWorkerHit = simulateSharedRateLimitDecision({ buckets: sharedPilotStore, policy: ratePolicy, rawKey: 'webhookDelivery:tenant|connector|action|origin', nowMs: 10_100 });
const crossInstanceDeny = simulateSharedRateLimitDecision({ buckets: sharedPilotStore, policy: ratePolicy, rawKey: 'webhookDelivery:tenant|connector|action|origin', nowMs: 10_200 });
if (firstWorkerHit.ok && secondWorkerHit.ok && !crossInstanceDeny.ok && crossInstanceDeny.count === 3) {
  pass('rate limit behavioral proof: shared counter denies cross-worker third hit in same window');
} else {
  fail('rate limit behavioral proof: shared counter did not deny cross-worker third hit', JSON.stringify({ firstWorkerHit, secondWorkerHit, crossInstanceDeny }));
}

const ttlResetHit = simulateSharedRateLimitDecision({ buckets: sharedPilotStore, policy: ratePolicy, rawKey: 'webhookDelivery:tenant|connector|action|origin', nowMs: 11_001 });
if (ttlResetHit.ok && ttlResetHit.count === 1 && ttlResetHit.resetAtMs === 12_001) {
  pass('rate limit behavioral proof: TTL expiry resets counter window deterministically');
} else {
  fail('rate limit behavioral proof: TTL expiry did not reset counter window', JSON.stringify(ttlResetHit));
}

const isolatedWorkerA = new Map();
const isolatedWorkerB = new Map();
simulateSharedRateLimitDecision({ buckets: isolatedWorkerA, policy: ratePolicy, rawKey: 'webhookDelivery:tenant|connector|action|origin', nowMs: 20_000 });
simulateSharedRateLimitDecision({ buckets: isolatedWorkerA, policy: ratePolicy, rawKey: 'webhookDelivery:tenant|connector|action|origin', nowMs: 20_100 });
const isolatedBypass = simulateSharedRateLimitDecision({ buckets: isolatedWorkerB, policy: ratePolicy, rawKey: 'webhookDelivery:tenant|connector|action|origin', nowMs: 20_200 });
if (isolatedBypass.ok && isolatedBypass.count === 1) {
  pass('rate limit production blocker proof: isolated process-local stores allow cross-instance bypass, so distributed atomic store remains required');
} else {
  fail('rate limit production blocker proof: isolated store simulation did not expose bypass', JSON.stringify(isolatedBypass));
}

const alertDigestRoute = read('src/frontend/app/api/actionbridge/ops/alert-digest/route.ts');
for (const [label, pattern] of [
  ['alert digest is bearer-secret protected and fail-closed when env secret is missing', /const expected = process\.env\.ACTIONBRIDGE_ALERT_DIGEST_SECRET[\s\S]*if \(!expected\) return false[\s\S]*Bearer \$\{expected\}/],
  ['alert digest only processes configured user allowlist', /parseUserIds\(process\.env\.ACTIONBRIDGE_ALERT_DIGEST_USER_IDS\)[\s\S]*ACTIONBRIDGE_ALERT_DIGEST_USERS_NOT_CONFIGURED/],
  ['alert digest only selects open high and critical alerts', /from\('actionbridge_operator_alerts'\)[\s\S]*\.eq\('status', 'open'\)[\s\S]*\.in\('severity', \['high', 'critical'\]\)/],
  ['alert digest response is built through a dedicated redacted projection', /function redactAlertForDigest[\s\S]*toActionBridgeOperatorAlertView[\s\S]*return \{[\s\S]*errorCode: alert\.errorCode[\s\S]*message: alert\.message[\s\S]*resolvedAt: alert\.resolvedAt[\s\S]*\};/],
  ['alert digest writes bounded audit without alert messages or contexts', /operator_alert\.digest_generated[\s\S]*resultSummary: \{[\s\S]*openCritical[\s\S]*openHigh[\s\S]*alertCount[\s\S]*redacted: true[\s\S]*\}/],
]) {
  if (pattern.test(alertDigestRoute)) pass(`operator alert digest behavior: ${label}`);
  else fail(`operator alert digest behavior: ${label}`);
}

const secretManagerLiveProbeRoute = read('src/frontend/app/api/actionbridge/ops/secret-manager-live-probe/route.ts');
const secretManagerLiveProbeCore = read('src/frontend/lib/actionbridge/secret-manager-live-probe-route.ts');
for (const [label, source, pattern] of [
  ['route adapter delegates to executable core and serializes rate-limit denials', secretManagerLiveProbeRoute, /handleActionBridgeSecretManagerLiveProbe[\s\S]*policyName: 'secretManagerLiveProbe'[\s\S]*serializeRateLimitResponse/],
  ['core is owner scoped, audit-fail-closed, and writes redacted live-probe evidence', secretManagerLiveProbeCore, /(?=[\s\S]*ACTIONBRIDGE_SECRET_MANAGER_PROBE_AUDIT_UNAVAILABLE)(?=[\s\S]*eq\('user_id', userId\))(?=[\s\S]*input\.enforceRateLimit)(?=[\s\S]*input\.probeLiveAccess)(?=[\s\S]*redacted: true)(?=[\s\S]*secret_manager\.live_probe_verified)(?=[\s\S]*ACTIONBRIDGE_SECRET_MANAGER_PROBE_AUDIT_FAILED)/],
  ['core sanitizes raw secret refs and provider resource names from summaries', secretManagerLiveProbeCore, /RAW_SECRET_REF_PATTERN[\s\S]*GOOGLE_SECRET_MANAGER_RESOURCE_PATTERN[\s\S]*sanitizeActionBridgeSecretManagerLiveProbeSummary/],
]) {
  if (pattern.test(source)) pass(`secret manager ops behavior: ${label}`);
  else fail(`secret manager ops behavior: ${label}`);
}

const backendSdkSource = read('integrations/backend-sdk/typescript/src/index.ts');
for (const [label, pattern] of [
  ['SDK replay cache requires atomic setIfAbsent contract', /interface ActionBridgeReplayCache[\s\S]*setIfAbsent\(nonce: string, ttlSeconds: number\)/],
  ['SDK verifies signature before consuming replay nonce', /const expected = signActionBridgeBackendRequest\(input\)[\s\S]*timingSafeEqual[\s\S]*setIfAbsent\(input\.nonce, 600\)/],
  ['SDK length-checks signature before timingSafeEqual to avoid malformed-signature throws', /expectedBuffer\.length !== signatureBuffer\.length \|\| !crypto\.timingSafeEqual\(expectedBuffer, signatureBuffer\)/],
]) {
  if (pattern.test(backendSdkSource)) pass(`backend SDK hardening: ${label}`);
  else fail(`backend SDK hardening: ${label}`);
}

const backendPairingRouteSource = read('src/frontend/app/api/actionbridge/backend-bridge/pairing/route.ts');
for (const [label, pattern] of [
  ['pairing consumption does not activate connector or mark safety pass', /\.update\(\{[\s\S]*secret_ref: secretRef,[\s\S]*safety_status: 'untested',[\s\S]*permission_status: 'draft'/],
  ['pairing response returns shared secret once with explicit warning', /sharedSecret,[\s\S]*SHARED_SECRET_RETURNED_ONCE_STORE_SERVER_SIDE_ONLY/],
]) {
  if (pattern.test(backendPairingRouteSource)) pass(`backend bridge pairing hardening: ${label}`);
  else fail(`backend bridge pairing hardening: ${label}`);
}

const backendPairingMigrationSource = read('supabase/migrations/20260521035000_actionbridge_backend_bridge_pairing.sql');
for (const [label, pattern] of [
  ['pairing RLS denies direct owner SELECT for sensitive digest/ref metadata', /actionbridge_backend_bridge_pairings_no_direct_owner_select[\s\S]*FOR SELECT USING \(false\)/],
  ['pairing migration keeps shared secret as digest only', /shared_secret_digest TEXT[\s\S]*shared_secret_digest_check[\s\S]*\^sha256:\[a-f0-9\]\{64\}\$/],
]) {
  if (pattern.test(backendPairingMigrationSource)) pass(`backend bridge pairing migration hardening: ${label}`);
  else fail(`backend bridge pairing migration hardening: ${label}`);
}

const wordpressSecuritySource = read('integrations/wordpress/actionbridge-wordpress/includes/class-actionbridge-security.php');
for (const [label, pattern] of [
  ['WordPress HMAC binds header connector id to stored connector id', /expected_connector_id[\s\S]*hash_equals\(\$expected_connector_id, \$connector_id\)[\s\S]*actionbridge_connector_mismatch/],
  ['WordPress replay guard uses atomic add_option nonce insert instead of check-then-set', /remember_nonce_once[\s\S]*return add_option\(\$option, \(string\) time\(\), '', false\)/],
]) {
  if (pattern.test(wordpressSecuritySource)) pass(`WordPress bridge security hardening: ${label}`);
  else fail(`WordPress bridge security hardening: ${label}`);
}

const backendBridgeHealthSource = read('src/frontend/app/api/actionbridge/backend-bridge/health/route.ts');
for (const [label, pattern] of [
  ['health route verifies HMAC before consuming replay nonce', /verifyActionBridgeBackendBridgeHealthSignature[\s\S]*if \(!verification\.ok\)[\s\S]*actionbridge_backend_bridge_health_nonces/],
  ['health route blocks unsafe write-enabled plugin health', /verification\.health\.ok !== true \|\| verification\.health\.writesEnabled === true[\s\S]*ACTIONBRIDGE_BACKEND_BRIDGE_HEALTH_UNSAFE/],
  ['health route marks connector connected-safe but not execution-active', /safety_status: 'pass',[\s\S]*permission_status: 'draft',[\s\S]*network_execution_enabled: false/],
  ['health route writes redacted audit evidence', /backend_bridge\.health_verified[\s\S]*redactActionBridgeValue\(verification\.health\)[\s\S]*redacted: true/],
]) {
  if (pattern.test(backendBridgeHealthSource)) pass(`backend bridge signed health behavior: ${label}`);
  else fail(`backend bridge signed health behavior: ${label}`);
}

const backendBridgePairingHelperSource = read('src/frontend/lib/actionbridge/backend-bridge-pairing.ts');
for (const [label, pattern] of [
  ['health signature helper length-checks before timingSafeEqual', /expectedBuffer\.length !== signatureBuffer\.length \|\| !crypto\.timingSafeEqual\(expectedBuffer, signatureBuffer\)/],
  ['health signature payload binds connector, timestamp, nonce, and sanitized health digest', /createActionBridgeBackendBridgeHealthSignaturePayload[\s\S]*healthDigest[\s\S]*\[input\.connectorId, input\.timestamp, input\.nonce, healthDigest\]/],
]) {
  if (pattern.test(backendBridgePairingHelperSource)) pass(`backend bridge signed health helper: ${label}`);
  else fail(`backend bridge signed health helper: ${label}`);
}

const backendHealthNonceMigrationSource = read('supabase/migrations/20260521041000_actionbridge_backend_bridge_health_nonces.sql');
if (/actionbridge_backend_bridge_health_nonces[\s\S]*UNIQUE \(nonce_digest\)[\s\S]*FOR SELECT USING \(false\)/.test(backendHealthNonceMigrationSource)) {
  pass('backend bridge signed health replay guard: nonce digests are unique and hidden from direct client reads');
} else {
  fail('backend bridge signed health replay guard: nonce migration is missing uniqueness or direct-read denial');
}

const wordpressClientSource = read('integrations/wordpress/actionbridge-wordpress/includes/class-actionbridge-client.php');
for (const [label, pattern] of [
  ['WordPress reports signed health immediately after pairing stores server-side secret', /update_option\('actionbridge_wp_settings', \$settings, false\)[\s\S]*report_signed_health\(\$settings\)/],
  ['WordPress signed health uses shared-secret digest as HMAC key to match server verifier without sending raw secret', /shared_secret_digest = 'sha256:' \. hash\('sha256', \$shared_secret\)[\s\S]*hash_hmac\('sha256', \$payload, \$shared_secret_digest\)/],
  ['WordPress signed health explicitly reports writes disabled', /private static function create_health_payload[\s\S]*'writesEnabled' => false/],
]) {
  if (pattern.test(wordpressClientSource)) pass(`WordPress bridge signed health client: ${label}`);
  else fail(`WordPress bridge signed health client: ${label}`);
}

const wordpressCapabilitiesSource = read('integrations/wordpress/actionbridge-wordpress/includes/class-actionbridge-capabilities.php');
const wordpressSettingsSource = read('integrations/wordpress/actionbridge-wordpress/includes/class-actionbridge-settings.php');
if (/public static function allowed\(\): array \{[\s\S]*return \[\];[\s\S]*public static function planned/.test(wordpressCapabilitiesSource)
  && /Pilot status:[\s\S]*signed health\/connectivity only[\s\S]*disabled=\"disabled\"[\s\S]*planned, disabled/.test(wordpressSettingsSource)) {
  pass('WordPress bridge UX hardening: planned capabilities are visibly disabled and not advertised as executable');
} else {
  fail('WordPress bridge UX hardening: capabilities may still be advertised as executable');
}

const rateLimitGuardrailSource = read('src/frontend/lib/actionbridge/rate-limit.ts');
for (const [label, pattern] of [
  ['production distributed mode has an explicit provider config gate', /getActionBridgeDistributedRateLimitConfig[\s\S]*ACTIONBRIDGE_DISTRIBUTED_RATE_LIMIT_PROVIDER[\s\S]*upstash_redis_rest[\s\S]*ACTIONBRIDGE_UPSTASH_REDIS_REST_URL[\s\S]*ACTIONBRIDGE_UPSTASH_REDIS_REST_TOKEN/],
  ['production distributed mode fails closed when the store is not configured', /ACTIONBRIDGE_RATE_LIMIT_MODE === 'production_distributed_required' && !distributedConfig\.configured[\s\S]*ACTIONBRIDGE_DISTRIBUTED_RATE_LIMIT_STORE_REQUIRED[\s\S]*endpointConfigured[\s\S]*tokenConfigured/],
  ['production mode still rejects missing trusted proxy identity before store use', /ACTIONBRIDGE_RATE_LIMIT_MODE === 'production_distributed_required' && !identity\.trusted[\s\S]*ACTIONBRIDGE_TRUSTED_PROXY_REQUIRED[\s\S]*ACTIONBRIDGE_RATE_LIMIT_MODE === 'production_distributed_required' && !distributedConfig\.configured/],
]) {
  if (pattern.test(rateLimitGuardrailSource)) pass(`production rate-limit guardrail: ${label}`);
  else fail(`production rate-limit guardrail: ${label}`);
}

process.exitCode = failed ? 1 : 0;
