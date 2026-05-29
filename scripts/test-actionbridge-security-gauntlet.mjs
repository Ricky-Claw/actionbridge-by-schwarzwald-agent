#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let failed = 0;
const results = [];
const pass = (name, detail = '') => results.push({ ok: true, name, detail });
const fail = (name, detail = '') => { failed += 1; results.push({ ok: false, name, detail }); };

// Mirrors current ActionBridge URL validation semantics so bypass payloads are executable
// locally without importing Next/server-only TypeScript modules or touching the network.
const PRIVATE_HOST_PREFIXES = ['127.', '10.', '172.', '192.168', '169.254'];
const BLOCKED_HOSTS = new Set(['localhost', '0.0.0.0', '::', '::1']);
function isPrivateIpAddress(hostname) {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTS.has(normalized)) return true;
  if (PRIVATE_HOST_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true;
  if (normalized.includes('::ffff:')) return true;

  const ipv4Parts = normalized.split('.').map((part) => Number(part));
  if (ipv4Parts.length === 4 && ipv4Parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [a, b] = ipv4Parts;
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }

  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
}
function isPrivateActionBridgeHost(hostname) {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (isPrivateIpAddress(normalized)) return true;
  return normalized.endsWith('.local') || normalized.endsWith('.internal');
}
function matchesAllowlist(target, allowlist) {
  return allowlist.some((entry) => entry.hostname.toLowerCase() === target.hostname.toLowerCase()
    && entry.protocol === target.protocol
    && (entry.port === undefined || entry.port === target.port));
}
function isAbsoluteUrlPath(requestPath) {
  return /^[a-z][a-z0-9+.-]*:/i.test(String(requestPath).trim()) || String(requestPath).trim().startsWith('//');
}
function validateActionBridgeTarget({ connector, path = '/', allowlist = [] }) {
  if (path && isAbsoluteUrlPath(path)) return { ok: false, reason: 'absolute-path' };
  let target;
  try { target = new URL(path || '/', connector.baseUrl); } catch { return { ok: false, reason: 'invalid' }; }
  if (target.protocol !== 'https:') return { ok: false, reason: 'protocol', target };
  if (target.username || target.password) return { ok: false, reason: 'userinfo', target };
  if (isPrivateActionBridgeHost(target.hostname)) return { ok: false, reason: 'private', target };
  if (!matchesAllowlist(target, allowlist)) return { ok: false, reason: 'allowlist', target };
  return { ok: true, reason: 'allowed', target };
}

const serverAllowedOrigins = ['https://api.example.com'];
function parseServerActionBridgeAllowlist(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== 'string') return [];
    try {
      const origin = new URL(entry);
      if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return [];
      return [{ protocol: 'https:', hostname: origin.hostname, port: origin.port || undefined }];
    } catch {
      return [];
    }
  });
}
const allowlist = parseServerActionBridgeAllowlist(serverAllowedOrigins);
const privateCases = [
  ['localhost', 'https://localhost/'],
  ['127 dotted', 'https://127.0.0.1/'],
  ['IPv6 loopback', 'https://[::1]/'],
  ['decimal IPv4 loopback', 'https://2130706433/'],
  ['octal IPv4 loopback', 'https://0177.0.0.1/'],
  ['hex IPv4 loopback', 'https://0x7f.0.0.1/'],
  ['IPv4-mapped IPv6 loopback', 'https://[::ffff:127.0.0.1]/'],
  ['IPv4-mapped IPv6 hex loopback', 'https://[::ffff:7f00:1]/'],
  ['.local host', 'https://printer.local/'],
  ['.internal host', 'https://metadata.internal/'],
  ['userinfo to localhost host', 'https://evil.example@localhost/'],
];

for (const [label, url] of privateCases) {
  const target = new URL(url);
  const blocked = isPrivateActionBridgeHost(target.hostname);
  if (blocked) pass(`SSRF blocked: ${label}`, `${url} -> hostname=${target.hostname}`);
  else fail(`SSRF BYPASS: ${label}`, `${url} -> hostname=${target.hostname}`);
}

for (const [label, baseUrl, requestPath, expectedOk] of [
  ['allowlist exact allowed', 'https://api.example.com', '/', true],
  ['allowlist http blocked', 'http://api.example.com', '/', false],
  ['allowlist sibling domain blocked', 'https://evilapi.example.com', '/', false],
  ['allowlist userinfo host confusion blocked', 'https://api.example.com@evil.test', '/', false],
  ['allowlist absolute path override blocked', 'https://api.example.com', 'https://evil.test/', false],
  ['allowlist userinfo on allowed host should be rejected', 'https://api.example.com', 'https://secret-token@api.example.com/', false],
]) {
  const res = validateActionBridgeTarget({ connector: { baseUrl }, path: requestPath, allowlist });
  if (res.ok === expectedOk) pass(`allowlist: ${label}`, `ok=${res.ok} target=${res.target?.toString()}`);
  else fail(`allowlist bypass/misclassification: ${label}`, `expected ok=${expectedOk}, got ok=${res.ok}, target=${res.target?.toString()}`);
}


for (const [label, origins, expectedCount] of [
  ['server-owned origin accepted', ['https://api.example.com'], 1],
  ['origin path rejected', ['https://api.example.com/v1'], 0],
  ['origin query rejected', ['https://api.example.com?token=x'], 0],
  ['origin userinfo rejected', ['https://token@api.example.com'], 0],
  ['origin http rejected', ['http://api.example.com'], 0],
]) {
  const parsed = parseServerActionBridgeAllowlist(origins);
  if (parsed.length === expectedCount) pass(`server allowlist parse: ${label}`, `count=${parsed.length}`);
  else fail(`server allowlist parse failed: ${label}`, `expected count=${expectedCount}, got ${parsed.length}`);
}

function normalizeSetupProfileUrl(value) {
  if (typeof value !== 'string') return null;
  let parsedUrl;
  try { parsedUrl = new URL(value); } catch { return null; }
  if (parsedUrl.protocol !== 'https:') return null;
  if (parsedUrl.username || parsedUrl.password) return null;
  if (isPrivateActionBridgeHost(parsedUrl.hostname)) return null;
  return parsedUrl;
}
for (const [label, url, expectedOk] of [
  ['setup rejects http', 'http://api.example.com', false],
  ['setup rejects localhost confusion', 'https://api.example.com@localhost', false],
  ['setup rejects userinfo token', 'https://token@api.example.com', false],
  ['setup allows HTTPS path but strips no secrets into origins', 'https://api.example.com/path?token=x', true],
  ['setup rejects scheme-relative', '//evil.test', false],
  ['setup rejects javascript scheme', 'javascript:alert(1)', false],
]) {
  const normalized = normalizeSetupProfileUrl(url);
  if (Boolean(normalized) === expectedOk) pass(`setup profile URL guard: ${label}`, `ok=${Boolean(normalized)} target=${normalized?.toString() || 'blocked'}`);
  else fail(`setup profile URL guard failed: ${label}`, `expected ok=${expectedOk}, got ok=${Boolean(normalized)}`);
}

const redaction = read('src/frontend/lib/actionbridge/redaction.ts');
for (const token of ['email', 'phone', 'contact', 'address', 'iban', 'vatId', 'EMAIL_PATTERN', 'PHONE_PATTERN', 'IBAN_PATTERN']) {
  if (redaction.includes(token)) pass(`GDPR redaction marker: ${token}`);
  else fail(`GDPR redaction missing marker: ${token}`);
}
for (const token of ['AUTH_HEADER_PATTERN', 'BEARER_TOKEN_PATTERN', 'JWT_PATTERN', 'QUERY_SECRET_PATTERN', 'KEY_VALUE_SECRET_PATTERN', 'OPENAI_PROJECT_SECRET_PATTERN', 'STRIPE_SECRET_PATTERN', 'AWS_ACCESS_KEY_PATTERN', 'COMMON_SECRET_PATTERN', '[REDACTED_AUTH]', '[REDACTED_TOKEN]', '[REDACTED_JWT]', '[REDACTED_SECRET]']) {
  if (redaction.includes(token)) pass(`free-text credential redaction marker: ${token}`);
  else fail(`free-text credential redaction missing marker: ${token}`);
}

const sourceFiles = [
  'src/frontend/lib/actionbridge/http-connector.ts',
  'src/frontend/lib/actionbridge/target-validation.ts',
  'src/frontend/lib/actionbridge/execution-plan.ts',
  'src/frontend/app/api/actionbridge/execute/route.ts',
];
for (const file of sourceFiles) {
  const source = read(file);
  const hasFetch = source.includes('fetch(');
  const routeCallsConnector = file.endsWith('/execute/route.ts') && source.includes('executeHttpActionConnector(');
  if (hasFetch || routeCallsConnector) fail(`no-fetch invariant: ${file}`, 'network execution marker found');
  else pass(`no-fetch invariant: ${file}`);
}

const executeRoute = read('src/frontend/app/api/actionbridge/execute/route.ts');
const persistenceModule = read('src/frontend/lib/actionbridge/persistence.ts');
if (executeRoute.includes('idempotencyKeyDigest') && !executeRoute.includes('idempotencyKey: consumed.execution.idempotencyKey')) pass('idempotency response redacts raw key');
else fail('idempotency leak', 'raw key may be returned');
if (executeRoute.includes('policy_check_succeeded_without_execution') && executeRoute.includes('networkExecution: false')) pass('execution status is explicitly non-network dry-run');
else fail('misleading execution status', 'missing explicit non-network dry-run wording');
if (!executeRoute.includes('body.allowlist') && executeRoute.includes('allowed_origins') && executeRoute.includes('parseServerActionBridgeAllowlist(connectorForPlan?.allowed_origins)')) pass('execute route uses server-owned connector allowlist only');
else fail('caller allowlist trust', 'execute route may not be using connector-owned allowed_origins');
if (executeRoute.includes('network_execution_enabled') && executeRoute.includes('networkExecution: false') && !executeRoute.includes('executeHttpActionConnector(')) pass('execution controls selected while network remains disabled');
else fail('network execution control invariant', 'missing controls or network may be enabled');
if (executeRoute.includes("consumed.execution.actionName === 'lead.submit'") && executeRoute.includes('persistActionBridgeLeadSubmission') && executeRoute.includes('ACTIONBRIDGE_LEAD_SUBMISSION_FAILED')) pass('approved lead.submit persists lead outbox action');
else fail('lead submit execution gate', 'lead.submit must persist an approval-gated outbox record and fail closed on persist errors');
if (executeRoute.includes("connectorId: typeof approvalSnapshot.connectorId === 'string'") && executeRoute.includes("status: 'failed'") && executeRoute.includes("errorCode: 'ACTIONBRIDGE_LEAD_SUBMISSION_FAILED'")) pass('lead.submit records connector id and failed execution state');
else fail('lead submit failure/traceability gate', 'lead.submit must preserve connector id and mark failed executions on outbox persist failure');
const leadSubmission = read('src/frontend/lib/actionbridge/lead-submission.ts');
if (!leadSubmission.includes('fetch(') && !leadSubmission.includes('form.submit') && leadSubmission.includes('actionbridge_outbox')) pass('lead submission avoids arbitrary external form post');
else fail('lead submission unsafe delivery', 'pilot lead action must not post arbitrary external forms');
if (leadSubmission.includes('normalizeLeadSourceOrigin') && leadSubmission.includes('normalizeLeadSourcePath') && leadSubmission.includes('split(/[?#]/')) pass('lead submission strips source URL query/hash PII');
else fail('lead source URL minimization', 'lead source origin/path must strip query/hash and reject unsafe URL forms');

const webhookConnectorsRoute = read('src/frontend/app/api/actionbridge/connectors/route.ts');
const webhookMigration = read('supabase/migrations/20260515230500_actionbridge_webhook_endpoint_path.sql');
for (const token of ['normalizeActionBridgeWebhookEndpointPath', 'body.endpointPath ?? body.endpoint_path', 'endpoint_path', "endpointPath: connector.endpoint_path || '/'", 'actionbridge_connectors_endpoint_path_relative']) {
  if (webhookConnectorsRoute.includes(token) || webhookMigration.includes(token)) pass(`webhook endpoint path marker: ${token}`);
  else fail(`webhook endpoint path missing marker: ${token}`);
}
if (webhookConnectorsRoute.includes("startsWith('//')") && webhookConnectorsRoute.includes("candidate.includes('?')") && webhookConnectorsRoute.includes("candidate.includes('#')")) pass('webhook endpoint path rejects query/hash and blocks absolute override');
else fail('webhook endpoint path guard', 'endpoint path must be relative-only and reject query/hash before persistence');

const webhookDelivery = read('src/frontend/lib/actionbridge/webhook-delivery.ts');
const webhookSigning = read('src/frontend/lib/actionbridge/webhook-signing.ts');
for (const token of ['resolveActionBridgeWebhookSigningSecret', 'ACTIONBRIDGE_WEBHOOK_SIGNING_SECRET_', 'secret_ref_missing', 'secret_ref_unresolved', 'unsigned_pilot_mode', 'secretRefDigest']) {
  if (webhookSigning.includes(token)) pass(`webhook signing marker: ${token}`);
  else fail(`webhook signing missing marker: ${token}`);
}
if (webhookSigning.includes('console.log') || webhookSigning.includes('secretValue')) fail('webhook signing resolver must not log or expose raw secrets');
for (const token of ['deliverActionBridgeWebhook', 'postPinnedHttpsJson', 'pinnedAddress', 'servername: input.target.hostname', 'Host: input.target.host', 'decideActionBridgeDnsPinning', 'validateActionBridgeTarget', 'X-ActionBridge-Idempotency-Digest', 'X-ActionBridge-Signature']) {
  if (webhookDelivery.includes(token)) pass(`webhook delivery marker: ${token}`);
  else fail(`webhook delivery missing marker: ${token}`);
}
if (!webhookDelivery.includes('form.submit') && !webhookDelivery.includes('StealthyFetcher') && !webhookDelivery.includes('request.body.target')) pass('webhook delivery avoids browser/form/body-target execution');
else fail('webhook delivery unsafe primitive', 'webhook delivery must not use browser/form submit or caller supplied target');
if (executeRoute.includes('deliverActionBridgeWebhook') && executeRoute.includes("webhookConnector?.type === 'webhook'") && executeRoute.includes('webhookDecision.allowed')) pass('execute route gates webhook delivery behind connector type and network controls');
else fail('execute route webhook gate', 'webhook delivery must be gated by connector type and network execution controls');
if (executeRoute.includes('approved_webhook_action') && executeRoute.includes('actionInput: approvalSnapshot.redactedInput')) pass('approved generic write actions can execute through webhook-v1 with approval snapshot payload');
else fail('generic approved webhook action', 'approved write actions must deliver through webhook-v1 with the approval snapshot, not only lead.submit');
for (const token of ['connectorExecutionDigest', 'createActionBridgeConnectorExecutionDigest', 'ACTIONBRIDGE_CONNECTOR_CHANGED_REAPPROVAL_REQUIRED', 'ACTIONBRIDGE_ACTION_CHANGED_REAPPROVAL_REQUIRED']) {
  if (executeRoute.includes(token)) pass(`execute route approval snapshot integrity marker: ${token}`);
  else fail(`execute route missing approval snapshot integrity marker: ${token}`);
}
if (executeRoute.includes("let finalExecutionStatus: 'succeeded' | 'failed' = consumed.execution.executionStatus === 'failed' ? 'failed' : 'succeeded'")) pass('reused failed executions return deny from stored failed status');
else fail('reused failed execution status', 'idempotent retries must derive allow/deny from stored execution status');
if (persistenceModule.includes('networkExecution: Boolean(row.safe_result?.networkExecution)')) pass('execution result audit preserves real networkExecution flag');
else fail('execution result audit networkExecution', 'audit must not hard-code networkExecution: false for webhook execution results');
if (executeRoute.includes("riskLevel === 'transactional'") || executeRoute.includes("riskLevel === 'destructive'")) pass('execute route explicitly blocks transactional/destructive live execution');
else fail('transactional/destructive guard', 'live execution must explicitly block transactional/destructive risk levels');
if (executeRoute.includes('endpoint_path') && executeRoute.includes("path: typeof webhookConnector.endpoint_path === 'string' ? webhookConnector.endpoint_path : '/'")) pass('execute route uses server-owned webhook endpoint path');
else fail('execute route webhook gate', 'webhook delivery must be gated by connector type and network execution controls');
for (const token of ['webhook_signing_secret_unresolved', 'webhook_signing_mode', 'resolveActionBridgeWebhookSigningSecret', 'signingSecret: signingResolution.signingSecret', 'webhook_delivery_error', 'ACTIONBRIDGE_WEBHOOK_DELIVERY_FAILED', 'decideActionBridgeWebhookDeliveryThrottle', 'webhook_rate_limited', 'recordActionBridgeWebhookFailureQuarantine', 'quarantine_required', "if (!webhookResult.ok)", "status: finalExecutionStatus", "finalExecutionStatus === 'failed' ? 502 : 200"]) {
  if (executeRoute.includes(token)) pass(`execute route webhook failure marker: ${token}`);
  else fail(`execute route webhook failure missing marker: ${token}`);
}


const readOnlyExecutor = read('src/frontend/lib/actionbridge/read-only-executor.ts');
if (!readOnlyExecutor.includes('targetValidation.target') && readOnlyExecutor.includes('new URL(targetValidation.url)')) pass('read-only executor consumes validated target url');
else fail('read-only executor target handling', 'executor must use validateActionBridgeTarget().url, not a missing target field');

const bridgeHandshakeRoute = read('src/frontend/app/api/actionbridge/bridge/handshake/route.ts');
if (bridgeHandshakeRoute.includes("!['pending', 'opened'].includes(setupLink.status)")) pass('bridge handshake only permits pending/opened setup links');
else fail('bridge handshake status gate', 'completed/revoked/expired setup links must not reconnect');
if (bridgeHandshakeRoute.includes('ACTIONBRIDGE_BRIDGE_INSTALLATION_REVOKED') && bridgeHandshakeRoute.includes("existingInstallation?.status === 'revoked'")) pass('bridge handshake does not revive revoked bridge installations');
else fail('bridge installation revocation gate', 'revoked bridge installations could be upserted back to connected');
if (bridgeHandshakeRoute.includes("update({ status: 'completed' })") && bridgeHandshakeRoute.includes("eventName: 'bridge.handshake.connected'")) pass('bridge handshake completes setup link and audits connection');
else fail('bridge handshake completion/audit gate', 'successful bridge handshakes must close setup replay and audit connection');

const rateLimit = read('src/frontend/lib/actionbridge/rate-limit.ts');
for (const token of ['ACTIONBRIDGE_RATE_LIMITED', 'ACTIONBRIDGE_TRUSTED_PROXY_REQUIRED', 'ACTIONBRIDGE_TRUSTED_PROXY_HEADER', 'getActionBridgeTrustedClientIdentity', 'production_distributed_required', 'Retry-After', 'setupLinks', 'setupSession', 'bridgeHandshake', 'domainVerification', 'webhookDelivery', 'webhookFailureQuarantine', 'keyDigest', 'ACTIONBRIDGE_RATE_LIMIT_MODE', 'pilot_process_local', 'ACTIONBRIDGE_PRODUCTION_RATE_LIMIT_REQUIREMENTS', 'trusted_proxy_header_policy', 'redacted_rate_limit_telemetry', 'decideActionBridgeWebhookDeliveryThrottle', 'recordActionBridgeWebhookFailureQuarantine', 'MAX_PILOT_BUCKETS']) {
  if (rateLimit.includes(token)) pass(`rate-limit marker: ${token}`);
  else fail(`rate-limit missing marker: ${token}`);
}
const productionRateLimitSpec = read('docs/specs/actionbridge-production-rate-limits.md');
for (const token of ['not a production distributed abuse-control boundary', 'Edge/CDN/WAF outer gate', 'Distributed app limiter', 'Webhook-v1 delivery attempts', 'Do not log raw IP', 'Trusted proxy header spoof test']) {
  if (productionRateLimitSpec.includes(token)) pass(`production rate-limit spec marker: ${token}`);
  else fail(`production rate-limit spec missing marker: ${token}`);
}

const setupLinksRoute = read('src/frontend/app/api/actionbridge/setup-links/route.ts');
const setupSessionRoute = read('src/frontend/app/api/actionbridge/setup-session/route.ts');
const setupSessionVerificationRoute = read('src/frontend/app/api/actionbridge/setup-session/verification/route.ts');
const verifyRoute = read('src/frontend/app/api/actionbridge/connectors/verify/route.ts');
const capabilitiesRoute = read('src/frontend/app/api/actionbridge/capabilities/route.ts');
const setupLinksLib = read('src/frontend/lib/actionbridge/setup-links.ts');
for (const routeSource of [setupLinksRoute, bridgeHandshakeRoute]) {
  if (routeSource.includes(".select('id,base_url,allowed_origins')") || routeSource.includes('base_url')) {
    fail('setup-link origin lock route leak check', 'route handlers must use the setup-links library helper so raw connector base URLs stay out of public route modules');
  }
}
for (const [label, source, marker] of [
  ['setup link route rate limit', setupLinksRoute, "policyName: 'setupLinks'"],
  ['setup session rate limit', setupSessionRoute, "policyName: 'setupSession'"],
  ['setup session verification rate limit', setupSessionVerificationRoute, "policyName: 'domainVerification'"],
  ['bridge handshake rate limit', bridgeHandshakeRoute, "policyName: 'bridgeHandshake'"],
  ['verification rate limit', verifyRoute, "policyName: 'domainVerification'"],
]) {
  if (source.includes('enforceActionBridgeRateLimit') && source.includes(marker)) pass(`route rate-limit marker: ${label}`);
  else fail(`missing route rate-limit marker: ${label}`);
  if (source.includes('createActionBridgeRateLimitHeaders')) pass(`route success rate-limit headers: ${label}`);
  else fail(`missing route success rate-limit headers: ${label}`);
}

for (const [label, source, marker] of [
  ['setup link creation audit', setupLinksRoute, "eventName: 'setup_link.created'"],
  ['verification challenge audit', verifyRoute, "eventName: 'domain_verification.challenge_issued'"],
  ['setup-session verification challenge audit', setupSessionVerificationRoute, "eventName: 'domain_verification.challenge_issued'"],
  ['verification result audit', verifyRoute, "domain_verification.verified"],
  ['setup-session verification result audit', setupSessionVerificationRoute, "domain_verification.verified"],
  ['connector status audit', verifyRoute, "eventName: 'connector.permission_status.changed'"],
  ['capability rule audit', capabilitiesRoute, "capability_rule.enabled"],
]) {
  if (source.includes('persistActionBridgeControlAuditEvent') && source.includes(marker)) pass(`control-plane audit marker: ${label}`);
  else fail(`missing control-plane audit marker: ${label}`);
}
for (const token of ['verifyActionBridgeConnectorSetupTargetOriginBinding', 'actionBridgeConnectorAllowsSetupTargetOrigin', 'normalizeActionBridgeConnectorBindingOrigin', 'connector.allowed_origins', 'connector.base_url', 'if (!baseOrigin) return false', 'connectorOrigins.has(normalizedTargetOrigin)']) {
  if (setupLinksLib.includes(token)) pass(`setup-link origin-binding helper marker: ${token}`);
  else fail(`setup-link origin-binding helper missing marker: ${token}`);
}
if (setupLinksRoute.includes('verifyActionBridgeConnectorSetupTargetOriginBinding(supabase as any')
  && setupLinksRoute.includes("bindingStatus === 'connector_not_found'")
  && setupLinksRoute.includes("eventName: 'setup_link.denied'")
  && setupLinksRoute.includes('ACTIONBRIDGE_SETUP_LINK_CONNECTOR_ORIGIN_MISMATCH')) {
  pass('setup-link creation origin-locks connector binding before token issuance');
} else {
  fail('setup-link connector origin lock missing', 'bound setup links must reject target origins outside the connector base/allowed origins');
}
if (bridgeHandshakeRoute.includes('verifyActionBridgeConnectorSetupTargetOriginBinding(serviceSupabase as any')
  && bridgeHandshakeRoute.includes("bindingStatus === 'connector_not_found'")
  && bridgeHandshakeRoute.includes("eventName: 'bridge.handshake.denied'")
  && bridgeHandshakeRoute.includes('ACTIONBRIDGE_BRIDGE_CONNECTOR_ORIGIN_MISMATCH')) {
  pass('bridge handshake rechecks connector origin binding before completing setup link');
} else {
  fail('bridge handshake connector origin lock missing', 'legacy/mismatched setup links must not attach arbitrary origins to connectors');
}
if (!verifyRoute.includes('human_attestation') && !setupSessionVerificationRoute.includes('human_attestation')) pass('pilot verification disables human attestation method');
else fail('human attestation pilot gate', 'customer pilot verification must not expose human_attestation as an active method');
for (const token of ['digestActionBridgeSetupSessionToken', 'setup-session-verification-client', 'verifyActionBridgeConnectorSetupTargetOriginBinding', 'getActiveActionBridgeConnectorQuarantine', 'ACTIONBRIDGE_SETUP_VERIFICATION_CONNECTOR_REQUIRED', 'ACTIONBRIDGE_SETUP_VERIFICATION_CONNECTOR_ORIGIN_MISMATCH', 'ACTIONBRIDGE_SETUP_VERIFICATION_CONNECTOR_NOT_ACTIVATABLE', 'ACTIONBRIDGE_SETUP_VERIFICATION_CONNECTOR_QUARANTINED', "connector.safety_status === 'fail'", "connector.permission_status !== 'draft'", 'verificationToken', 'existingVerification?.status === \'verified\'', 'domain_verification.verified_replay', 'alreadyVerified: true', 'networkExecution: result.networkExecution', 'ACTIONBRIDGE_SETUP_VERIFICATION_UPDATE_FAILED', 'ACTIONBRIDGE_SETUP_VERIFICATION_AUDIT_FAILED', 'ACTIONBRIDGE_SETUP_VERIFICATION_CONNECTOR_UPDATE_FAILED', 'connector.permission_status.verified_noop', 'connector.permission_status.changed']) {
  if (setupSessionVerificationRoute.includes(token)) pass(`setup-session verification route marker: ${token}`);
  else fail(`setup-session verification route missing marker: ${token}`);
}
if (setupSessionVerificationRoute.includes('auth.getUser') || setupSessionVerificationRoute.includes('base_url') || setupSessionVerificationRoute.includes('secret_ref')) {
  fail('setup-session verification route boundary', 'token-scoped verification route must not require browser auth or select connector secrets/base URLs');
} else pass('setup-session verification route is setup-token scoped and avoids connector secret/base URL exposure');
if (setupSessionVerificationRoute.includes('[89ab][0-9a-f]{3}-[0-9a-f]{12}')) pass('setup-session verification accepts standard 8-4-4-4-12 UUID verification IDs');
else fail('setup-session verification UUID guard', 'verificationId regex must accept standard UUIDs');
const persistenceSource = read('src/frontend/lib/actionbridge/persistence.ts');
if (persistenceSource.includes('networkExecution?: boolean') && persistenceSource.includes('networkExecution: Boolean(input.networkExecution)')) pass('control-plane audit can record real network probe semantics');
else fail('control-plane audit network semantics', 'domain verification probes must not be forced to networkExecution:false');

const onboardingAuditMigration = read('supabase/migrations/20260515000100_actionbridge_onboarding_audit_triggers.sql');
if (onboardingAuditMigration.includes('audit_actionbridge_setup_link_status_change') && onboardingAuditMigration.includes("'setup_link.' || NEW.status")) pass('setup link status changes are audited by DB trigger');
else fail('setup link status audit trigger missing', 'opened/completed/revoked/expired setup transitions need immutable audit');

const connectorsRoute = read('src/frontend/app/api/actionbridge/connectors/route.ts');
for (const token of ['normalizeActionBridgeAllowedOrigins', "parsedUrl.pathname !== \'/\'", 'parsedUrl.search', 'parsedUrl.hash', 'isPrivateActionBridgeHost', 'network_execution_enabled: false']) {
  if (connectorsRoute.includes(token)) pass(`connector route hardening marker: ${token}`);
  else fail(`connector route missing hardening marker: ${token}`);
}
const migrations = fs.readdirSync(path.join(root, 'supabase/migrations')).filter((name) => name.endsWith('.sql')).map((name) => read(`supabase/migrations/${name}`)).join('\n');
for (const token of ['allowed_origins JSONB NOT NULL DEFAULT', 'capabilities JSONB NOT NULL DEFAULT', 'network_execution_enabled BOOLEAN NOT NULL DEFAULT false', "CHECK (safety_status IN ('untested', 'pass', 'fail'))", "CHECK (permission_status IN ('draft', 'active', 'paused', 'revoked'))"]) {
  if (migrations.includes(token)) pass(`migration execution control: ${token}`);
  else fail(`migration missing execution control: ${token}`);
}

for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
console.log(`\nPayloads tried: ${privateCases.map(([, u]) => u).join(', ')}`);
process.exit(failed ? 1 : 0);


const errorLog = read('src/frontend/lib/actionbridge/error-log.ts');
for (const token of ['persistActionBridgeErrorEvent', 'redactActionBridgeValue', 'sanitizeActionBridgeErrorContext', 'maxDepth', 'maxKeys', '[circular]', 'ActionBridgeErrorSeverity', 'critical', 'redacted_context', 'actionbridge_error_logs', 'pruneActionBridgeResolvedErrorLogs', 'info_low_30d', 'medium_90d', 'high_critical_180d']) {
  if (errorLog.includes(token)) pass(`error-log security marker: ${token}`);
  else fail(`error-log missing security marker: ${token}`);
}
if (errorLog.includes('secretValue') || errorLog.includes('idempotency_key')) fail('error-log must not expose raw secrets or raw idempotency keys');
const errorsRoute = read('src/frontend/app/api/actionbridge/errors/route.ts');
for (const token of ['auth.getUser', 'UNAUTHORIZED', 'actionbridge_error_logs', ".eq('user_id', user!.id)", 'toActionBridgeErrorLogView', 'export async function PATCH', 'export async function DELETE', 'ACTIONBRIDGE_ERROR_RETENTION_CONFIRMATION_REQUIRED', 'DELETE_EXPIRED_ACTIONBRIDGE_ERROR_LOGS', 'error_log.retention_deleted', 'ACTIONBRIDGE_ERROR_STATUS_TRANSITION_BLOCKED', 'error_log.status_changed', 'ACTIONBRIDGE_ERROR_LOG_LIST_FAILED']) {
  if (errorsRoute.includes(token)) pass(`errors route security marker: ${token}`);
  else fail(`errors route missing security marker: ${token}`);
}
if (errorsRoute.includes('token_digest') || errorsRoute.includes('secret_ref') || errorsRoute.includes('idempotency_key')) fail('errors route must not select secrets, token digests, or raw idempotency keys');
const errorRetentionOpsRoute = read('src/frontend/app/api/actionbridge/ops/error-retention/route.ts');
for (const token of ['ACTIONBRIDGE_RETENTION_CRON_SECRET', 'ACTIONBRIDGE_RETENTION_USER_IDS', 'ACTIONBRIDGE_RETENTION_DELETE_ENABLED', 'x-actionbridge-retention-confirm', 'DELETE_EXPIRED_ACTIONBRIDGE_ERROR_LOGS', 'pruneActionBridgeResolvedErrorLogs', 'error_log.retention_cron_deleted']) {
  if (errorRetentionOpsRoute.includes(token)) pass(`error retention cron security marker: ${token}`);
  else fail(`error retention cron missing security marker: ${token}`);
}
if (errorRetentionOpsRoute.includes('auth.getUser') || errorRetentionOpsRoute.includes('token_digest') || errorRetentionOpsRoute.includes('secret_ref') || errorRetentionOpsRoute.includes('idempotency_key')) fail('retention cron route must not depend on browser auth or expose token/secret/idempotency fields');
const quarantineRoute = read('src/frontend/app/api/actionbridge/quarantine/route.ts');
for (const token of ['auth.getUser', 'UNAUTHORIZED', 'actionbridge_connector_quarantine', ".eq('user_id', user!.id)", "eq('status', 'active')", 'connector_quarantine.paused', 'connector_quarantine.resolved', 'redactActionBridgeValue', 'const redacted = redactActionBridgeValue(trimmed)']) {
  if (quarantineRoute.includes(token)) pass(`quarantine route security marker: ${token}`);
  else fail(`quarantine route missing security marker: ${token}`);
}
if (quarantineRoute.includes('secret_ref') || quarantineRoute.includes('token_digest') || quarantineRoute.includes('idempotency_key')) fail('quarantine route must not select secrets, token digests, or raw idempotency keys');

const errorMigration = read('supabase/migrations/20260515000400_actionbridge_error_logs.sql');
for (const token of ['actionbridge_error_logs', 'ENABLE ROW LEVEL SECURITY', 'auth.uid() = user_id', 'redacted_context', "severity IN ('info', 'low', 'medium', 'high', 'critical')", "category IN ('setup', 'verification', 'approval', 'execution', 'webhook', 'rate_limit', 'system')"]) {
  if (errorMigration.includes(token)) pass(`error-log migration marker: ${token}`);
  else fail(`error-log migration missing marker: ${token}`);
}


// Strict endpoint path and atomic error status gates
if (connectorsRoute.includes("candidate.includes('?')") && connectorsRoute.includes("candidate.includes('#')") && connectorsRoute.includes("path.includes('\\')")) pass('webhook endpoint path rejects query/hash/backslash instead of stripping');
else fail('webhook endpoint path strict rejection missing', 'endpointPath must reject query/hash/backslash inputs fail-closed');
if (errorsRoute.includes(".eq('status', currentStatus)") && errorsRoute.includes('ACTIONBRIDGE_ERROR_STATUS_UPDATE_FAILED')) pass('error status lifecycle update is compare-and-set guarded');
else fail('error status lifecycle atomic guard missing', 'PATCH must update with current status predicate to prevent racing downgrades');


const productionReadiness = read('docs/production-readiness-checklist.md');
for (const token of ['HMAC secret-ref wiring', 'Distributed atomic rate limiter', 'Trusted proxy/header enforcement', 'Retention/GDPR policy', 'No production/broad rollout']) {
  if (productionReadiness.includes(token)) pass(`production readiness security doc marker: ${token}`);
  else fail(`production readiness doc missing marker: ${token}`);
}
const receiverGuide = read('docs/webhook-signature-receiver-guide.md');
for (const token of ['X-ActionBridge-Signature', 'constant-time comparison', 'timestamp', 'idempotency', 'Never send the shared secret']) {
  if (receiverGuide.includes(token)) pass(`webhook receiver guide security marker: ${token}`);
  else fail(`webhook receiver guide missing marker: ${token}`);
}
const retentionPolicy = read('docs/error-log-retention-policy.md');
for (const token of ['must not store', 'raw setup tokens', 'raw idempotency keys', 'connector secrets', 'unredacted personal data']) {
  if (retentionPolicy.includes(token)) pass(`error retention security marker: ${token}`);
  else fail(`error retention policy missing marker: ${token}`);
}


const sentinelBlockers = read('docs/sentinel-production-blockers.md');
for (const token of ['Distributed Rate Limiting', 'Durable Quarantine', 'Behavioral Security Tests', 'Secret Management / Rotation', 'Operational Retention']) {
  if (sentinelBlockers.includes(token)) pass(`sentinel blocker doc marker: ${token}`);
  else fail(`sentinel blocker doc missing marker: ${token}`);
}
const pilotSmoke = read('docs/pilot-smoke-test-runbook.md');
for (const token of ['Stop Criteria', 'private/internal host', 'raw secret/token/idempotency key', 'failed webhook delivery is recorded as success', 'revoked/closed setup link']) {
  if (pilotSmoke.includes(token)) pass(`pilot smoke security marker: ${token}`);
  else fail(`pilot smoke runbook missing marker: ${token}`);
}


const webhookSigningModeMigration = read('supabase/migrations/20260515234500_actionbridge_webhook_signing_mode.sql');
for (const token of ['webhook_signing_mode', 'unsigned_pilot', 'hmac_sha256', 'secret_ref IS NOT NULL']) {
  if (webhookSigningModeMigration.includes(token)) pass(`webhook signing mode migration marker: ${token}`);
  else fail(`webhook signing mode migration missing marker: ${token}`);
}
