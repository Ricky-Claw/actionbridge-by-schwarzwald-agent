#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));
const fail = (msg) => { console.error(`❌ ${msg}`); process.exitCode = 1; };
const pass = (msg) => console.log(`✅ ${msg}`);

const requiredFiles = [
  'src/frontend/lib/actionbridge/types.ts',
  'src/frontend/lib/actionbridge/policy.ts',
  'src/frontend/lib/actionbridge/redaction.ts',
  'src/frontend/lib/actionbridge/http-connector.ts',
  'src/frontend/lib/actionbridge/target-validation.ts',
  'src/frontend/lib/actionbridge/dns-ip-guard.ts',
  'src/frontend/lib/actionbridge/execution-plan.ts',
  'src/frontend/lib/actionbridge/execution-controls.ts',
  'src/frontend/lib/actionbridge/response-limits.ts',
  'src/frontend/lib/actionbridge/rate-limit.ts',
  'src/frontend/lib/actionbridge/audit-taxonomy.ts',
  'src/frontend/lib/actionbridge/website-connector.ts',
  'src/frontend/lib/actionbridge/website-extraction-guards.ts',
  'src/frontend/lib/actionbridge/setup-profile.ts',
  'src/frontend/lib/actionbridge/tool-catalog.ts',
  'src/frontend/lib/actionbridge/schema-safety.ts',
  'src/frontend/lib/actionbridge/read-only-executor.ts',
  'src/frontend/lib/actionbridge/lead-submission.ts',
  'src/frontend/lib/actionbridge/domain-verification.ts',
  'src/frontend/lib/actionbridge/setup-links.ts',
  'src/frontend/lib/actionbridge/setup-session.ts',
  'src/frontend/lib/actionbridge/bridge-handshake.ts',
  'src/frontend/lib/actionbridge/capability-rules.ts',
];

for (const file of requiredFiles) {
  if (!exists(file)) fail(`Missing ActionBridge file: ${file}`);
  else pass(`ActionBridge file exists: ${file}`);
}

if (!process.exitCode) {
  const types = read('src/frontend/lib/actionbridge/types.ts');
  for (const token of [
    'ActionBridgeRiskLevel',
    "'read'",
    "'write'",
    "'transactional'",
    "'destructive'",
    'ActionBridgeDecision',
    "'allow'",
    "'deny'",
    "'approval_required'",
    'ActionBridgeActionDefinition',
    'ActionBridgeConnector',
    'ActionBridgeAuditEvent',
  ]) {
    if (!types.includes(token)) fail(`types.ts missing ${token}`);
  }
  if (!process.exitCode) pass('ActionBridge core types expose risk, decision, action, connector, audit contracts');

  const policy = read('src/frontend/lib/actionbridge/policy.ts');
  if (!policy.includes('decideActionBridgePolicy')) fail('policy.ts missing decideActionBridgePolicy');
  if (!policy.includes("riskLevel === 'write'") || !policy.includes("approval_required")) {
    fail('Policy does not approval-gate write actions by default');
  }
  if (!policy.includes("riskLevel === 'transactional'") || !policy.includes("riskLevel === 'destructive'")) {
    fail('Policy does not explicitly handle transactional/destructive risk levels');
  }
  if (!process.exitCode) pass('ActionBridge policy gates risky actions fail-closed');

  const redaction = read('src/frontend/lib/actionbridge/redaction.ts');
  for (const token of ['apiKey', 'authorization', 'clientSecret', 'password', 'token', 'redactActionBridgeValue']) {
    if (!redaction.toLowerCase().includes(token.toLowerCase())) fail(`redaction.ts missing sensitive key handling for ${token}`);
  }
  if (!process.exitCode) pass('ActionBridge redaction covers common secret variants');

  const connector = read('src/frontend/lib/actionbridge/http-connector.ts');
  if (!connector.includes('executeHttpActionConnector')) fail('http-connector.ts missing executeHttpActionConnector');
  if (!connector.includes('server-only')) fail('HTTP connector must import server-only');
  if (connector.includes('secretValue') && !connector.includes('redactActionBridgeValue')) {
    fail('HTTP connector references secretValue without redaction path');
  }
  if (connector.includes("'http:'") || connector.includes('"http:"')) {
    fail('HTTP connector must not allow plain HTTP targets');
  }
  if (!connector.includes('https:')) {
    fail('HTTP connector must require HTTPS target protocols');
  }
  if (!process.exitCode) pass('ActionBridge HTTP connector is server-only and validates protocols');

  const targetValidation = read('src/frontend/lib/actionbridge/target-validation.ts');
  for (const token of [
    'validateActionBridgeTarget',
    'defaultDenyActionBridgeAllowlist',
    'networkExecution: false',
    'isPrivateActionBridgeHost',
    'Unsupported connector protocol',
    'Connector target is not in the explicit allowlist',
  ]) {
    if (!targetValidation.includes(token)) fail(`target-validation.ts missing ${token}`);
  }
  if (targetValidation.includes('fetch(')) fail('target-validation.ts must not perform network execution');
  if (!process.exitCode) pass('ActionBridge target validation is default-deny and non-networked');

  const dnsIpGuard = read('src/frontend/lib/actionbridge/dns-ip-guard.ts');
  for (const token of [
    'ActionBridgeDnsResolutionSnapshot',
    'decideActionBridgeDnsPinning',
    'isActionBridgePrivateIpAddress',
    'isActionBridgeBlockedHost',
    'DNS resolution included private or link-local address',
    'networkExecution: false',
  ]) {
    if (!dnsIpGuard.includes(token)) fail(`dns-ip-guard.ts missing ${token}`);
  }
  if (dnsIpGuard.includes('fetch(') || dnsIpGuard.includes('dns.lookup') || dnsIpGuard.includes('resolve')) fail('dns-ip-guard.ts must classify supplied DNS snapshots only');
  if (!process.exitCode) pass('ActionBridge DNS/IP guard classifies offline resolver snapshots without network execution');

  const executionPlan = read('src/frontend/lib/actionbridge/execution-plan.ts');
  for (const token of [
    'classifyActionBridgeAction',
    'createActionBridgeExecutionPlan',
    "riskLevel === 'read'",
    'readOnly',
    'networkExecution: false',
    'redactedInput',
    'redactedResultSummary',
  ]) {
    if (!executionPlan.includes(token)) fail(`execution-plan.ts missing ${token}`);
  }
  if (executionPlan.includes('fetch(')) fail('execution-plan.ts must not perform network execution');
  if (!process.exitCode) pass('ActionBridge execution plan classifies read-only actions and emits redacted dry-run plans');

  const executionControls = read('src/frontend/lib/actionbridge/execution-controls.ts');
  for (const token of [
    'normalizeActionBridgeExecutionControls',
    'decideActionBridgeNetworkExecutionControls',
    'killSwitchActive',
    'networkExecution: false',
    'Read-only network executor gates passed.',
  ]) {
    if (!executionControls.includes(token)) fail(`execution-controls.ts missing ${token}`);
  }
  if (executionControls.includes('fetch(')) fail('execution-controls.ts must not perform network execution');
  if (!process.exitCode) pass('ActionBridge execution controls include kill-switch and read-only network gates');

  const readOnlyExecutor = read('src/frontend/lib/actionbridge/read-only-executor.ts');
  for (const token of ['executeActionBridgeReadOnlyGet', 'dns.lookup', 'decideActionBridgeDnsPinning', 'validateActionBridgeTarget', "method: 'GET'", "redirect: 'manual'", 'AbortSignal.timeout', 'enforceActionBridgeResponseByteLimit', 'redactActionBridgeValue']) {
    if (!readOnlyExecutor.includes(token)) fail(`read-only-executor.ts missing ${token}`);
  }
  for (const forbidden of ["method: 'POST'", 'secretValue', 'form.submit', 'StealthyFetcher']) {
    if (readOnlyExecutor.includes(forbidden)) fail(`read-only executor must not include ${forbidden}`);
  }
  const leadSubmission = read('src/frontend/lib/actionbridge/lead-submission.ts');
  for (const token of ['createActionBridgeLeadSubmissionDraft', 'persistActionBridgeLeadSubmission', 'lead.submit', 'actionbridge_lead_submissions', 'actionbridge_outbox', 'redactActionBridgeValue']) {
    if (!leadSubmission.includes(token)) fail(`lead-submission.ts missing ${token}`);
  }
  for (const forbidden of ['fetch(', 'form.submit', 'StealthyFetcher', 'credentials']) {
    if (leadSubmission.includes(forbidden)) fail(`lead-submission must not perform unsafe external delivery: ${forbidden}`);
  }
  if (!process.exitCode) pass('ActionBridge lead submission creates approval-gated outbox records without external form submit');

  const capabilityRules = read('src/frontend/lib/actionbridge/capability-rules.ts');
  for (const token of ['ACTIONBRIDGE_CAPABILITY_DEFINITIONS', 'site.knowledge.read', 'lead.prepare_draft', 'lead.submit', 'appointment.request.prepare_draft', 'requiresApproval: true', 'riskLevel: \'write\'', 'sanitizeActionBridgeInputSchema', 'compileActionBridgeCapabilityTool']) {
    if (!capabilityRules.includes(token)) fail(`capability-rules.ts missing ${token}`);
  }
  if (capabilityRules.includes('transactional') || capabilityRules.includes('destructive') || capabilityRules.includes('form.submit') || capabilityRules.includes('calendar write')) fail('capability rules v1 must not expose transactional/destructive execution');
  if (!process.exitCode) pass('ActionBridge capability rules define safe read/draft capabilities');

  const bridgeHandshake = read('src/frontend/lib/actionbridge/bridge-handshake.ts');
  for (const token of ['parseActionBridgeBridgeHandshake', 'createActionBridgeBridgeScript', 'normalizeActionBridgeHandshakeOrigin', 'credentials:\'omit\'', 'window.ActionBridge', 'data-setup-token']) {
    if (!bridgeHandshake.includes(token)) fail(`bridge-handshake.ts missing ${token}`);
  }
  if (bridgeHandshake.includes('secret_ref') || bridgeHandshake.includes('form.submit') || bridgeHandshake.includes('querySelectorAll')) fail('bridge handshake/script v1 must not expose secrets, submit forms, or scrape DOM');
  if (!process.exitCode) pass('ActionBridge bridge script v1 performs connected-only handshake');

  const setupSession = read('src/frontend/lib/actionbridge/setup-session.ts');
  for (const token of ['createActionBridgeSetupSessionView', 'digestActionBridgeSetupSessionToken', 'isActionBridgeSetupSessionUsable', 'bridgeInstall', 'capabilityChoices', 'site.knowledge.read', 'lead.prepare_draft', 'appointment.request.prepare_draft']) {
    if (!setupSession.includes(token)) fail(`setup-session.ts missing ${token}`);
  }
  if (setupSession.includes('secret_ref') || setupSession.includes('token_digest')) fail('setup-session view must not expose secrets or token digests');
  if (!process.exitCode) pass('ActionBridge setup session exposes customer-safe setup state');

  const setupLinks = read('src/frontend/lib/actionbridge/setup-links.ts');
  for (const token of ['createActionBridgeSetupLinkDraft', 'digestActionBridgeSetupLinkToken', 'normalizeActionBridgeSetupLinkOrigin', 'absl_', 'tokenDigest', 'isPrivateActionBridgeHost']) {
    if (!setupLinks.includes(token)) fail(`setup-links.ts missing ${token}`);
  }
  if (setupLinks.includes('fetch(')) fail('setup-links.ts must not perform network execution');
  if (!process.exitCode) pass('ActionBridge setup links generate digest-only customer setup tokens');

  const domainVerification = read('src/frontend/lib/actionbridge/domain-verification.ts');
  for (const token of ['createActionBridgeVerificationChallenge', 'verifyActionBridgeDomainChallenge', 'human_attestation', 'well_known', 'meta_tag', 'dns_txt', 'actionbridge-verification=', 'dns.resolveTxt', 'dns.lookup', 'decideActionBridgeDnsPinning', 'enforceActionBridgeResponseByteLimit', 'redirect: \'manual\'', 'AbortSignal.timeout']) {
    if (!domainVerification.includes(token)) fail(`domain-verification.ts missing ${token}`);
  }
  if (!domainVerification.includes('isPrivateActionBridgeHost')) fail('domain verification must reject private/internal origins');
  if (!process.exitCode) pass('ActionBridge domain verification supports attestation, well-known, meta tag, and DNS TXT');

  const websiteConnector = read('src/frontend/lib/actionbridge/website-connector.ts');
  for (const token of ['server-only', 'createActionBridgeWebsiteExtractPlan', 'public_page_extract', 'same_origin_route_discovery', 'formInventory', 'no_form_submit', 'networkExecution: false', 'requiredExecutorGates', 'serverSideDnsPinning', 'robotsPolicy', 'browserNoWriteInterception', 'piiSecretRedaction', 'killSwitch']) {
    if (!websiteConnector.includes(token)) fail(`website-connector.ts missing ${token}`);
  }
  if (websiteConnector.includes('fetch(') || websiteConnector.includes('StealthyFetcher') || websiteConnector.includes('form.submit')) fail('website connector contract must not wire live network/browser execution in this release');

  const websiteExtractionGuards = read('src/frontend/lib/actionbridge/website-extraction-guards.ts');
  for (const token of ['decideActionBridgeWebsiteRobotsPolicy', 'decideActionBridgeWebsiteNoWritePolicy', 'sanitizeActionBridgeWebsitePageProfile', 'rawHtmlReturned: false', 'rawJavaScriptReturned: false', 'Website connector blocks write-capable HTTP methods', 'robots.txt does not allow']) {
    if (!websiteExtractionGuards.includes(token)) fail(`website-extraction-guards.ts missing ${token}`);
  }
  if (websiteExtractionGuards.includes('fetch(') || websiteExtractionGuards.includes('StealthyFetcher')) fail('website extraction guards must not perform network/browser execution');
  if (!process.exitCode) pass('ActionBridge website connector defines safe public extraction plan and release gates without live execution');

  const schemaSafety = read('src/frontend/lib/actionbridge/schema-safety.ts');
  for (const token of ['sanitizeActionBridgeSchemaName', 'sanitizeActionBridgeSchemaText', 'sanitizeActionBridgeInputSchema', 'PROMPT_INJECTION_PATTERNS', 'bypass\\s+(policy|approval|guardrails?)']) {
    if (!schemaSafety.includes(token)) fail(`schema-safety.ts missing ${token}`);
  }
  if (!process.exitCode) pass('ActionBridge schema safety blocks prompt-like schema poisoning');

  const setupProfile = read('src/frontend/lib/actionbridge/setup-profile.ts');
  for (const token of ['normalizeActionBridgeSetupProfile', 'networkExecutionEnabled: false', "safetyStatus: 'untested'", "permissionStatus: 'draft'", "authMode: 'none'", 'isPrivateActionBridgeHost', 'suggestedActions']) {
    if (!setupProfile.includes(token)) fail(`setup-profile.ts missing ${token}`);
  }
  if (setupProfile.includes('fetch(') || setupProfile.includes('StealthyFetcher')) fail('setup profile must not perform live network/browser execution');

  const toolCatalog = read('src/frontend/lib/actionbridge/tool-catalog.ts');
  for (const token of ['createActionBridgeWidgetToolCatalog', "version: 'actionbridge.catalog.v1'", 'inputSchema', 'riskLevel', 'requiresApproval', 'networkExecution: false']) {
    if (!toolCatalog.includes(token)) fail(`tool-catalog.ts missing ${token}`);
  }
  if (toolCatalog.includes('secretRef') || toolCatalog.includes('secret_ref') || toolCatalog.includes('secretValue') || toolCatalog.includes('idempotency_key')) fail('tool catalog must not expose secrets or raw idempotency fields');
  if (!process.exitCode) pass('ActionBridge setup profile and widget tool catalog are dry-run and agent-safe');

  const responseLimits = read('src/frontend/lib/actionbridge/response-limits.ts');
  for (const token of ['defaultActionBridgeResponseLimitPolicy', 'maxBytes', 'maxJsonDepth', 'maxArrayItems', 'maxObjectKeys', 'enforceActionBridgeResponseByteLimit']) {
    if (!responseLimits.includes(token)) fail(`response-limits.ts missing ${token}`);
  }
  if (!process.exitCode) pass('ActionBridge response limit contract is defined');

  const rateLimit = read('src/frontend/lib/actionbridge/rate-limit.ts');
  for (const token of ['enforceActionBridgeRateLimit', 'ACTIONBRIDGE_RATE_LIMITED', 'Retry-After', 'setupSession', 'bridgeHandshake', 'domainVerification', 'keyDigest']) {
    if (!rateLimit.includes(token)) fail(`rate-limit.ts missing ${token}`);
  }
  if (!process.exitCode) pass('ActionBridge rate limit contract protects public/token-adjacent endpoints');

  const auditTaxonomy = read('src/frontend/lib/actionbridge/audit-taxonomy.ts');
  for (const token of ['ActionBridgeAuditCategory', 'execution_control', 'target_validation', 'dry_run_result', 'ACTIONBRIDGE_KILL_SWITCH_BLOCKED', 'ACTIONBRIDGE_APPROVAL_CONSUMED', 'ACTIONBRIDGE_IDEMPOTENCY_REPLAY', 'ACTIONBRIDGE_NETWORK_EXECUTOR_UNAVAILABLE', 'ACTIONBRIDGE_EXECUTION_RESULT_PERSISTED', 'networkExecution: false']) {
    if (!auditTaxonomy.includes(token)) fail(`audit-taxonomy.ts missing ${token}`);
  }
  if (!process.exitCode) pass('ActionBridge audit taxonomy covers policy, approval, target, control, and execution-result events');
}


if (!exists('ACTIONBRIDGE_GOAL.md')) fail('Missing ACTIONBRIDGE_GOAL.md');
else {
  const goal = read('ACTIONBRIDGE_GOAL.md');
  for (const token of ['Connector-', 'kein CRM', 'Keine Lead-Outbox-UI', 'Webhook-v1', 'standalone DoD']) {
    if (!goal.includes(token)) fail(`ACTIONBRIDGE_GOAL.md missing connector-scope marker: ${token}`);
  }
  if (!process.exitCode) pass('ACTIONBRIDGE_GOAL.md defines connector-only standalone product scope');
}
if (!exists('docs/actionbridge-pilot-runbook.md')) fail('Missing ActionBridge pilot runbook');
else {
  const runbook = read('docs/actionbridge-pilot-runbook.md');
  for (const token of ['Main Flow', 'Revoke / Kill-Switch', 'Verification Checklist', 'Pilot Exit Criteria', 'Do not integrate into Schwarzwald-Agent dashboard until ActionBridge standalone DoD is satisfied']) {
    if (!runbook.includes(token)) fail(`pilot runbook missing ${token}`);
  }
  if (!process.exitCode) pass('ActionBridge pilot runbook documents standalone setup, verification, approval, execution, and exit gates');
}

if (!exists('docs/specs/actionbridge-webhook-v1-adapter.md')) fail('Missing Webhook-v1 adapter spec');
else {
  const webhookSpec = read('docs/specs/actionbridge-webhook-v1-adapter.md');
  for (const token of ['Webhook-v1', 'lead.submit', 'HTTPS only', 'No redirects', 'Exact origin allowlist', 'Idempotency', 'HMAC signature', 'No arbitrary form submission', 'No dashboard CRM/lead inbox']) {
    if (!webhookSpec.includes(token)) fail(`Webhook-v1 spec missing ${token}`);
  }
  if (!process.exitCode) pass('Webhook-v1 adapter spec defines safe standalone connector delivery contract');
}

if (!exists('docs/build-and-verification-gates.md')) fail('Missing build and verification gates doc');
else {
  const gates = read('docs/build-and-verification-gates.md');
  for (const token of ['npm test', 'git diff --check', 'Not Yet Available', 'tsconfig.json', 'npm run build', 'Autopilot Rule']) {
    if (!gates.includes(token)) fail(`build gates doc missing ${token}`);
  }
  if (!process.exitCode) pass('Build/verification gate doc defines current and production checks');
}

const routeFiles = [
  'src/frontend/app/api/actionbridge/actions/route.ts',
  'src/frontend/app/api/actionbridge/connectors/route.ts',
  'src/frontend/app/api/actionbridge/execute/route.ts',
  'src/frontend/app/api/actionbridge/approvals/route.ts',
  'src/frontend/app/api/actionbridge/audit/route.ts',
  'src/frontend/app/api/actionbridge/executions/route.ts',
  'src/frontend/app/api/actionbridge/setup-profile/route.ts',
  'src/frontend/app/api/actionbridge/tool-catalog/route.ts',
  'src/frontend/app/api/actionbridge/connectors/verify/route.ts',
  'src/frontend/app/api/actionbridge/setup-links/route.ts',
  'src/frontend/app/api/actionbridge/setup-session/route.ts',
  'src/frontend/app/api/actionbridge/bridge/handshake/route.ts',
  'src/frontend/app/actionbridge/bridge.js/route.ts',
  'src/frontend/app/api/actionbridge/capabilities/route.ts',
  'src/frontend/app/api/actionbridge/agent-tools/route.ts',
];
for (const file of routeFiles) {
  if (!exists(file)) fail(`Missing ActionBridge route: ${file}`);
  else pass(`ActionBridge route exists: ${file}`);
}

if (!process.exitCode) {
  const actionsRoute = read('src/frontend/app/api/actionbridge/actions/route.ts');
  const connectorsRoute = read('src/frontend/app/api/actionbridge/connectors/route.ts');
  const executeRoute = read('src/frontend/app/api/actionbridge/execute/route.ts');
  const approvalsRoute = read('src/frontend/app/api/actionbridge/approvals/route.ts');
  const auditRoute = read('src/frontend/app/api/actionbridge/audit/route.ts');
  const executionsRoute = read('src/frontend/app/api/actionbridge/executions/route.ts');
  const setupProfileRoute = read('src/frontend/app/api/actionbridge/setup-profile/route.ts');
  const toolCatalogRoute = read('src/frontend/app/api/actionbridge/tool-catalog/route.ts');
  const connectorVerifyRoute = read('src/frontend/app/api/actionbridge/connectors/verify/route.ts');
  const setupLinksRoute = read('src/frontend/app/api/actionbridge/setup-links/route.ts');
  const setupSessionRoute = read('src/frontend/app/api/actionbridge/setup-session/route.ts');
  const bridgeHandshakeRoute = read('src/frontend/app/api/actionbridge/bridge/handshake/route.ts');
  const bridgeScriptRoute = read('src/frontend/app/actionbridge/bridge.js/route.ts');
  const capabilitiesRoute = read('src/frontend/app/api/actionbridge/capabilities/route.ts');
  const agentToolsRoute = read('src/frontend/app/api/actionbridge/agent-tools/route.ts');
  for (const [name, source] of [['actions', actionsRoute], ['connectors', connectorsRoute], ['execute', executeRoute], ['approvals', approvalsRoute], ['audit', auditRoute], ['executions', executionsRoute]]) {
    if (!source.includes('createClient')) fail(`${name} route must use Supabase server auth`);
    if (!source.includes('auth.getUser')) fail(`${name} route must require authenticated user`);
    if (!source.includes('UNAUTHORIZED')) fail(`${name} route must fail closed when unauthenticated`);
  }
  if (!connectorsRoute.includes('actionbridge_connectors')) fail('connectors route must persist/list actionbridge_connectors');
  if (!connectorsRoute.includes(".eq('user_id', user!.id)")) fail('connectors route must scope reads to authenticated owner');
  if (!connectorsRoute.includes('createCoreServiceClient')) fail('connectors route must use server-only service client for connector creation');
  if (!connectorsRoute.includes('ACTIONBRIDGE_CONNECTOR_CREATE_FAILED')) fail('connectors route must fail closed on connector creation errors');
  if (!connectorsRoute.includes("new Set(['http', 'website'])")) fail('connectors route must allow website connector type');
  if (!connectorsRoute.includes('public_page_extract') || !connectorsRoute.includes('no_form_submit')) fail('website connectors must persist public extraction guardrail capabilities');
  if (!connectorsRoute.includes('parsedUrl.username') || !connectorsRoute.includes('parsedUrl.password')) fail('connectors route must reject URL userinfo secrets');
  if (!connectorsRoute.includes("const authMode = type === 'website' ? 'none'")) fail('website connectors must force auth_mode none');
  if (!connectorsRoute.includes("type === 'website' ? [parsedUrl.origin]")) fail('website connectors must default allowed origins to own origin');
  if (connectorsRoute.includes('secret_ref:') && !connectorsRoute.includes('ACTIONBRIDGE_SECRET_STORAGE_NOT_CONFIGURED')) fail('connectors route must not accept client-supplied secret_ref');
  if (!connectorsRoute.includes('redactActionBridgeValue')) fail('connectors route must redact invalid connector payloads');
  if (actionsRoute.includes('demoActions')) fail('actions route must not serve demo-only actions');
  if (!actionsRoute.includes('actionbridge_actions')) fail('actions route must persist/list actionbridge_actions');
  if (!actionsRoute.includes(".eq('user_id', user!.id)")) fail('actions route must scope action reads/writes to authenticated owner');
  if (!actionsRoute.includes('ACTIONBRIDGE_ACTION_CREATE_FAILED')) fail('actions route must fail closed on action creation errors');
  if (!actionsRoute.includes('sanitizeActionBridgeSchemaName') || !actionsRoute.includes('sanitizeActionBridgeSchemaText') || !actionsRoute.includes('sanitizeActionBridgeInputSchema')) fail('actions route must sanitize action schemas against poisoning');
  if (actionsRoute.includes('requiresApproval ===')) fail('actions route must not trust client-controlled requiresApproval');
  if (actionsRoute.includes('requires_approval ===')) fail('actions route must not trust client-controlled requires_approval');
  if (!actionsRoute.includes("ActionBridgeRiskLevel = 'write'") && !actionsRoute.includes("riskLevel: 'write'")) fail('actions route must default client-created actions to write risk');
  if (!actionsRoute.includes('createCoreServiceClient')) fail('actions route must use server-only service client for action creation');
  if (!actionsRoute.includes('requires_approval: true')) fail('actions route must force approval for client-created actions');
  if (!actionsRoute.includes('connector_id')) fail('actions route must persist connector_id relationship');
  if (!executeRoute.includes('decideActionBridgePolicy')) fail('execute route must call policy decision layer');
  if (!executeRoute.includes('approval_required')) fail('execute route must support approval_required decision');
  if (!executeRoute.includes('redactActionBridgeValue')) fail('execute route must redact inputs before returning/logging');
  if (!executeRoute.includes("type: connectorForPlan.type || 'http'")) fail('execute route must pass connector type into execution planning');
  if (!approvalsRoute.includes('export async function POST')) fail('approvals route must support approve/reject decisions');
  if (!approvalsRoute.includes('action_snapshot') || !approvalsRoute.includes('connector_id')) fail('approvals route must expose immutable approval snapshot fields');
  if (!approvalsRoute.includes('p_user_id: user!.id')) fail('approvals route must scope decisions to authenticated owner');
  if (!approvalsRoute.includes('ACTIONBRIDGE_APPROVAL_DECISION_FAILED')) fail('approvals route must fail closed if decision persistence fails');
  if (!approvalsRoute.includes('decide_actionbridge_approval_atomic')) fail('approvals route must use atomic approval decision RPC with audit');
  if (!approvalsRoute.includes('createCoreServiceClient')) fail('approvals route must use server-only service client for approval status transitions');
  for (const token of ['actionbridge_audit_logs', ".eq('user_id', user!.id)", 'redacted_input', 'result_summary', 'sanitizeActionBridgeVisibilityResult(entry.result_summary)', 'ACTIONBRIDGE_AUDIT_LIST_FAILED']) {
    if (!auditRoute.includes(token)) fail(`audit route missing safe visibility token ${token}`);
  }
  for (const token of ['actionbridge_executions', ".eq('user_id', user!.id)", 'safe_result', 'sanitizeActionBridgeVisibilityResult(value)', 'ACTIONBRIDGE_EXECUTIONS_LIST_FAILED']) {
    if (!executionsRoute.includes(token)) fail(`executions route missing safe visibility token ${token}`);
  }
  if (auditRoute.includes('idempotency_key') || executionsRoute.includes('idempotency_key') || executionsRoute.includes('...result')) fail('visibility routes must not return raw idempotency keys or spread stored result JSON');
  for (const token of ['normalizeActionBridgeSetupProfile', 'ACTIONBRIDGE_SECRET_STORAGE_NOT_CONFIGURED', 'INVALID_ACTIONBRIDGE_SETUP_PROFILE']) {
    if (!setupProfileRoute.includes(token)) fail(`setup-profile route missing ${token}`);
  }
  for (const token of ['createActionBridgeWidgetToolCatalogs', 'actionbridge_connectors', 'actionbridge_actions', 'actionbridge_capability_rules', ".eq('user_id', user!.id)", "version: 'actionbridge.catalog.v1'", 'networkExecution: false']) {
    if (!toolCatalogRoute.includes(token)) fail(`tool-catalog route missing ${token}`);
  }
  if (toolCatalogRoute.includes('secret_ref') || toolCatalogRoute.includes('base_url') || toolCatalogRoute.includes('idempotency_key')) fail('tool-catalog route must not select/expose secrets, base URLs, or idempotency keys');
  for (const token of ['actionbridge_setup_links', 'createActionBridgeSetupLinkDraft', 'token_digest', 'target_origin', 'allowed_methods', ".eq('user_id', user!.id)", 'auth.getUser', 'UNAUTHORIZED']) {
    if (!setupLinksRoute.includes(token)) fail(`setup-links route missing ${token}`);
  }
  if (setupLinksRoute.includes('token_digest,') || setupLinksRoute.includes('token_digest)')) fail('setup-links route must not select/return token_digest');
  for (const token of ['digestActionBridgeSetupSessionToken', 'createActionBridgeSetupSessionView', 'isActionBridgeSetupSessionUsable', 'ACTIONBRIDGE_SETUP_SESSION_NOT_FOUND', "status: 'opened'"]) {
    if (!setupSessionRoute.includes(token)) fail(`setup-session route missing ${token}`);
  }
  if (setupSessionRoute.includes('user_id') || setupSessionRoute.includes('secret_ref')) fail('public setup-session route must not select user_id or secrets');
  for (const token of ['parseActionBridgeBridgeHandshake', 'actionbridge_setup_links', 'actionbridge_bridge_installations', 'originHeader && originHeader !== parsed.origin', 'connected_only']) {
    if (!bridgeHandshakeRoute.includes(token)) fail(`bridge handshake route missing ${token}`);
  }
  if (bridgeHandshakeRoute.includes('secret_ref') || bridgeHandshakeRoute.includes('base_url')) fail('bridge handshake route must not select secrets or connector base URLs');
  for (const token of ['createActionBridgeBridgeScript', 'application/javascript', 'nosniff']) {
    if (!bridgeScriptRoute.includes(token)) fail(`bridge script route missing ${token}`);
  }
  for (const token of ['actionbridge_connector_verifications', 'createActionBridgeVerificationChallenge', 'verifyActionBridgeDomainChallenge', 'digestActionBridgeVerificationToken', 'strongVerification', 'network_execution_enabled: false', "safety_status: strongVerification ? 'pass' : 'untested'", "permission_status: 'active'", ".eq('user_id', user!.id)"]) {
    if (!connectorVerifyRoute.includes(token)) fail(`connector verification route missing ${token}`);
  }
  for (const token of ['actionbridge_capability_rules', 'normalizeActionBridgeCapabilityRuleInput', 'ACTIONBRIDGE_CAPABILITY_REQUIRES_VERIFIED_ACTIVE_CONNECTOR', "connector.safety_status !== 'pass'", "connector.permission_status !== 'active'", 'requires_approval', ".eq('user_id', user!.id)", 'createCoreServiceClient']) {
    if (!capabilitiesRoute.includes(token)) fail(`capabilities route missing ${token}`);
  }
  if (capabilitiesRoute.includes('secret_ref') || capabilitiesRoute.includes('base_url') || capabilitiesRoute.includes('riskLevel: body')) fail('capabilities route must not expose secrets/base URLs or accept client risk override');
  for (const token of ['actionbridge.agent-tools.v1', 'auth.getUser', 'actionbridge_connectors', 'actionbridge_actions', 'actionbridge_capability_rules', ".eq('user_id', user!.id)", ".eq('safety_status', 'pass')", ".eq('permission_status', 'active')", 'createActionBridgeWidgetToolCatalogs', "mode: 'catalog_only'", 'networkExecution: false']) {
    if (!agentToolsRoute.includes(token)) fail(`agent-tools route missing ${token}`);
  }
  if (agentToolsRoute.includes('secret_ref') || agentToolsRoute.includes('base_url') || agentToolsRoute.includes('token_digest') || agentToolsRoute.includes('config')) fail('agent-tools route must not expose secrets, base URLs, token digests, or raw config');
  if (!process.exitCode) pass('ActionBridge API routes are auth-gated and policy-driven');
}


const migrationFiles = fs.readdirSync(path.join(root, 'supabase/migrations')).filter((name) => name.includes('actionbridge'));
if (!migrationFiles.length) {
  fail('Missing ActionBridge core Supabase migration');
} else {
  pass(`ActionBridge migration exists: ${migrationFiles.join(', ')}`);
  const migration = migrationFiles.map((name) => read(`supabase/migrations/${name}`)).join('\n');
  for (const table of [
    'actionbridge_connectors',
    'actionbridge_actions',
    'actionbridge_approvals',
    'actionbridge_audit_logs',
  ]) {
    if (!migration.includes(table)) fail(`ActionBridge migration missing table ${table}`);
  }
  if (!migration.toLowerCase().includes('enable row level security')) fail('ActionBridge migration must enable RLS');
  if (!migration.includes('auth.uid()')) fail('ActionBridge migration policies must scope to auth.uid()');
  if (!migration.includes("type IN ('http', 'website')")) fail('ActionBridge migration must support website connector type');
  if (!migration.includes('redacted_input')) fail('ActionBridge audit log must use redacted_input, not raw secrets');
  if (migration.includes('CREATE POLICY actionbridge_approvals_owner_all')) fail('ActionBridge approvals must not expose direct owner FOR ALL mutations');
  if (migration.includes('CREATE POLICY actionbridge_connectors_owner_all')) fail('ActionBridge connectors must not expose direct owner FOR ALL mutations');
  if (!migration.includes('CREATE POLICY actionbridge_connectors_owner_select')) fail('ActionBridge connectors must allow owner SELECT only through RLS');
  if (migration.includes('CREATE POLICY actionbridge_actions_owner_all')) fail('ActionBridge actions must not expose direct owner FOR ALL mutations');
  if (migration.includes('ADD CONSTRAINT IF NOT EXISTS')) fail('ActionBridge migrations must not use invalid PostgreSQL ADD CONSTRAINT IF NOT EXISTS syntax');
  if (!migration.includes('pg_constraint') || !migration.includes('actionbridge_actions_non_read_requires_approval')) fail('ActionBridge action policy hardening must be idempotent via pg_constraint guard');
  if (!migration.includes('CREATE POLICY actionbridge_actions_owner_select')) fail('ActionBridge actions must allow owner SELECT only through RLS');
  if (!migration.includes("CHECK (risk_level = 'read' OR requires_approval = true)")) fail('ActionBridge actions must enforce non-read approval at DB level');
  if (!migration.includes('CREATE POLICY actionbridge_approvals_owner_select')) fail('ActionBridge approvals must allow owner SELECT only through RLS');
  if (!migration.includes('decide_actionbridge_approval_atomic')) fail('ActionBridge migration must define atomic approval decision RPC');
  if (!migration.includes('GRANT EXECUTE ON FUNCTION public.decide_actionbridge_approval_atomic(UUID, UUID, TEXT) TO service_role')) fail('ActionBridge atomic approval RPC must be executable by service_role');
  if (!process.exitCode) pass('ActionBridge migration defines scoped RLS tables and redacted audit log');
}


if (exists('src/frontend/lib/actionbridge/persistence.ts')) {
  const persistence = read('src/frontend/lib/actionbridge/persistence.ts');
  for (const fn of ['persistActionBridgeAuditEvent', 'createActionBridgeApproval']) {
    if (!persistence.includes(fn)) fail(`persistence.ts missing ${fn}`);
  }
  if (!persistence.includes('redactActionBridgeValue')) fail('persistence must redact before insert');
  if (!persistence.includes('actionbridge_audit_logs')) fail('persistence must write audit logs');
  if (!persistence.includes('actionbridge_approvals')) fail('persistence must write approvals');
  if (!persistence.includes('action_snapshot') || !persistence.includes('connector_id') || !persistence.includes('networkExecution: false')) fail('persistence must bind immutable approval snapshots with connector ownership context');
  if (!process.exitCode) pass('ActionBridge persistence helpers write approvals, immutable snapshots, and redacted audit logs');
} else {
  fail('Missing ActionBridge persistence helper: src/frontend/lib/actionbridge/persistence.ts');
}

if (exists('src/frontend/app/api/actionbridge/execute/route.ts')) {
  const executeRouteForPersistence = read('src/frontend/app/api/actionbridge/execute/route.ts');
  if (!executeRouteForPersistence.includes('persistActionBridgeAuditEvent')) fail('execute route must persist audit events');
  if (!executeRouteForPersistence.includes('createActionBridgeApproval')) fail('execute route must persist approval requests');
}


if (exists('src/frontend/lib/actionbridge/http-connector.ts')) {
  const httpConnectorSecurity = read('src/frontend/lib/actionbridge/http-connector.ts');
  const dnsIpGuardSecurity = read('src/frontend/lib/actionbridge/dns-ip-guard.ts');
  for (const token of ['isActionBridgeBlockedHost', 'isActionBridgePrivateIpAddress']) {
    if (!httpConnectorSecurity.includes(token)) fail(`HTTP connector must delegate SSRF/private-host guard to shared DNS/IP guard: ${token}`);
  }
  for (const token of ['localhost', '127.', '10.', '172.', '192.168', '169.254']) {
    if (!dnsIpGuardSecurity.includes(token)) fail(`DNS/IP guard missing SSRF/private-host marker: ${token}`);
  }
  if (!httpConnectorSecurity.includes('AbortSignal.timeout')) fail('HTTP connector must use bounded request timeout before network execution');
  if (!httpConnectorSecurity.includes("redirect: 'manual'") && !httpConnectorSecurity.includes('redirect: "manual"')) {
    fail('HTTP connector must not auto-follow redirects');
  }
  if (!process.exitCode) pass('ActionBridge HTTP connector delegates SSRF guard and keeps timeout/redirect guardrails');
}


if (exists('src/frontend/lib/actionbridge/tool-interface.ts')) {
  const toolInterface = read('src/frontend/lib/actionbridge/tool-interface.ts');
  for (const token of ['toActionBridgeToolDefinition', 'createActionBridgeToolCall', 'ActionBridgeToolDefinition', 'ActionBridgeToolCall']) {
    if (!toolInterface.includes(token)) fail(`tool-interface.ts missing ${token}`);
  }
  if (!toolInterface.includes('inputSchema') || !toolInterface.includes('riskLevel')) {
    fail('tool-interface.ts must expose input schema and risk level to agents');
  }
  if (toolInterface.includes('secretRef') || toolInterface.includes('secretValue')) {
    fail('tool-interface.ts must not expose connector secrets to agents');
  }
  if (!process.exitCode) pass('ActionBridge tool interface exposes agent-safe tool definitions');
} else {
  fail('Missing ActionBridge tool interface: src/frontend/lib/actionbridge/tool-interface.ts');
}


if (exists('src/frontend/app/api/actionbridge/execute/route.ts')) {
  const executeRouteSecurity = read('src/frontend/app/api/actionbridge/execute/route.ts');
  for (const forbidden of ['body.riskLevel', 'body.explicitAllow', 'body.approvalConfigured']) {
    if (executeRouteSecurity.includes(forbidden)) fail(`execute route must not trust client-controlled ${forbidden}`);
  }
  if (!executeRouteSecurity.includes('getServerActionBridgePolicy')) fail('execute route must derive policy from server-side action policy');
  if (!executeRouteSecurity.includes('approval.error')) fail('execute route must check approval persistence errors');
  if (!executeRouteSecurity.includes('ACTIONBRIDGE_APPROVAL_PERSIST_FAILED')) fail('execute route must fail closed if approval persistence fails');
}

if (migrationFiles.length) {
  const migration = migrationFiles.map((name) => read(`supabase/migrations/${name}`)).join('\n');
  for (const token of ['UNIQUE (id, user_id)', 'FOREIGN KEY (connector_id, user_id)', 'FOREIGN KEY (action_id, user_id)', 'FOREIGN KEY (approval_id, user_id)']) {
    if (!migration.includes(token)) fail(`ActionBridge migration missing tenant FK guard: ${token}`);
  }
  if (migration.includes('FOREIGN KEY (action_id, user_id)') && migration.includes('ON DELETE SET NULL')) {
    fail('Composite ActionBridge FKs must not use ON DELETE SET NULL because user_id is NOT NULL');
  }
  if (!process.exitCode) pass('ActionBridge migration enforces same-owner relationships via composite keys');
}



if (exists('src/frontend/lib/actionbridge/persistence.ts')) {
  const persistence = read('src/frontend/lib/actionbridge/persistence.ts');
  for (const fn of ['consumeApprovedActionBridgeExecution', 'persistActionBridgeExecutionResult']) {
    if (!persistence.includes(fn)) fail(`persistence.ts missing execution state helper ${fn}`);
  }
  for (const token of ['actionbridge_executions', 'idempotency_key', 'execution_id', 'approval_id', 'approved', 'executing', 'succeeded', 'failed', 'persistActionBridgeAuditEvent', 'executionResultPersisted']) {
    if (!persistence.includes(token)) fail(`persistence.ts missing execution state/audit token ${token}`);
  }
  if (!process.exitCode) pass('ActionBridge persistence supports consume-once execution state, idempotency, and final audit events');
}

if (exists('src/frontend/app/api/actionbridge/execute/route.ts')) {
  const executeRouteState = read('src/frontend/app/api/actionbridge/execute/route.ts');
  for (const token of ['approvalId', 'idempotencyKey', 'consumeApprovedActionBridgeExecution', 'persistActionBridgeExecutionResult', 'persistActionBridgeLeadSubmission', 'executionId', 'ACTIONBRIDGE_APPROVAL_NOT_EXECUTABLE', 'ACTIONBRIDGE_EXECUTION_RESULT_PERSIST_FAILED', 'dry_run_noop', 'networkExecution: false']) {
    if (!executeRouteState.includes(token)) fail(`execute route missing execution state/idempotency token ${token}`);
  }
  for (const token of ['createActionBridgeExecutionPlan', 'validateActionBridgeTarget', 'parseServerActionBridgeAllowlist', 'policy_check_succeeded_without_execution', 'decideActionBridgeNetworkExecutionControls', 'summarizeActionBridgeResponseLimitPolicy', 'actionBridgeAuditTaxonomy', "type: connectorForPlan.type || 'http'"]) {
    if (!executeRouteState.includes(token)) fail(`execute route missing dry-run planner guard ${token}`);
  }
  if (executeRouteState.includes('body.allowlist')) {
    fail('execute route must not trust caller-supplied body.allowlist for execution target allowlisting');
  }
  for (const token of ['allowed_origins', 'network_execution_enabled', 'safety_status', 'permission_status']) {
    if (!executeRouteState.includes(token)) fail(`execute route must select connector execution control field ${token}`);
  }
  if (!executeRouteState.includes('idempotencyKeyDigest') || executeRouteState.includes('idempotencyKey: consumed.execution.idempotencyKey')) {
    fail('execute route must return only a hashed idempotency key digest, not the raw key');
  }
  if (executeRouteState.includes('dry_run_succeeded') || executeRouteState.includes('approval_consumed_without_network_execution')) {
    fail('execute route must avoid ambiguous dry-run success/execution wording');
  }
  if (executeRouteState.includes('executeHttpActionConnector(')) fail('execute route must not enable real network ActionBridge execution yet');
  if (!process.exitCode) pass('ActionBridge execute route consumes approvals once and records a non-network dry-run result');
}

if (exists('src/frontend/app/api/actionbridge/connectors/route.ts')) {
  const connectorsRoute = read('src/frontend/app/api/actionbridge/connectors/route.ts');
  for (const token of ['normalizeActionBridgeAllowedOrigins', 'allowed_origins', 'network_execution_enabled: false', 'safety_status', 'permission_status']) {
    if (!connectorsRoute.includes(token)) fail(`connectors route missing server-owned execution control token ${token}`);
  }
  if (connectorsRoute.includes('network_execution_enabled: body')) {
    fail('connectors route must not let callers enable network_execution_enabled directly');
  }
  if (!process.exitCode) pass('ActionBridge connectors route stores server-owned allowlist and execution controls');
}

if (migrationFiles.length) {
  const migration = migrationFiles.map((name) => read(`supabase/migrations/${name}`)).join('\n');
  for (const token of [
    'actionbridge_setup_links',
    "status IN ('pending', 'opened', 'completed', 'revoked', 'expired')",
    'token_digest TEXT NOT NULL',
    'actionbridge_setup_links_owner_select',
    'actionbridge_capability_rules',
    "name IN ('site.knowledge.read', 'lead.prepare_draft', 'lead.submit', 'appointment.request.prepare_draft')",
    "CHECK (risk_level = 'read' OR requires_approval = true)",
    "name = 'site.knowledge.read' OR risk_level = 'write'",
    'actionbridge_capability_rules_owner_select',
    'actionbridge_bridge_installations',
    'actionbridge_bridge_installations_owner_select',
    "status IN ('connected', 'stale', 'revoked')",
    'FOREIGN KEY (setup_link_id, user_id)',
    'actionbridge_connector_verifications',
    "method IN ('human_attestation', 'well_known', 'meta_tag', 'dns_txt')",
    "status IN ('pending', 'verified', 'failed', 'revoked')",
    'FOREIGN KEY (connector_id, user_id)',
    'actionbridge_connector_verifications_owner_select',
    'actionbridge_executions',
    'idempotency_key',
    'execution_status',
    'connector_id UUID',
    'action_snapshot JSONB NOT NULL',
    'actionbridge_approvals_connector_owner_fk',
    'consume_actionbridge_approval_for_execution',
    "status = 'approved'",
    "status NOT IN ('rejected', 'expired')",
    'UNIQUE (user_id, approval_id, idempotency_key)',
    'execution_id',
    'approvalSnapshot',
  ]) {
    if (!migration.includes(token)) fail(`ActionBridge migration missing execution/idempotency/snapshot guard: ${token}`);
  }
  if (!migration.includes('GRANT EXECUTE ON FUNCTION public.consume_actionbridge_approval_for_execution(UUID, UUID, TEXT) TO service_role')) {
    fail('ActionBridge consume execution RPC must be executable by service_role');
  }
  for (const token of [
    'allowed_origins JSONB NOT NULL DEFAULT',
    'capabilities JSONB NOT NULL DEFAULT',
    'network_execution_enabled BOOLEAN NOT NULL DEFAULT false',
    'safety_status TEXT NOT NULL DEFAULT',
    "CHECK (safety_status IN ('untested', 'pass', 'fail'))",
    'permission_status TEXT NOT NULL DEFAULT',
    "CHECK (permission_status IN ('draft', 'active', 'paused', 'revoked'))",
  ]) {
    if (!migration.includes(token)) fail(`ActionBridge migration missing connector execution control: ${token}`);
  }
  if (migration.includes('dry_run_succeeded') || migration.includes('approval_consumed_without_network_execution')) {
    fail('ActionBridge migration must avoid ambiguous dry-run success/execution wording');
  }
  if (migration.includes("'idempotencyKey', p_idempotency_key") || migration.includes('idempotencyKeyPrefix') || migration.includes('left(p_idempotency_key')) {
    fail('ActionBridge migration audit summary must not store raw idempotency keys or prefixes');
  }
  if (!migration.includes('idempotencyKeyDigest') || !migration.includes("digest(p_idempotency_key, 'sha256')")) {
    fail('ActionBridge migration audit summary must store only idempotency key digest');
  }
  if (!process.exitCode) pass('ActionBridge migration defines consume-once approval execution state, immutable snapshots, and digest-only idempotency audit');
}

process.exit(process.exitCode || 0);
