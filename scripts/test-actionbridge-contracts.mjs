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
  if (!connector.includes('http:') || !connector.includes('https:')) {
    fail('HTTP connector must validate allowed URL protocols');
  }
  if (!process.exitCode) pass('ActionBridge HTTP connector is server-only and validates protocols');
}


const routeFiles = [
  'src/frontend/app/api/actionbridge/actions/route.ts',
  'src/frontend/app/api/actionbridge/connectors/route.ts',
  'src/frontend/app/api/actionbridge/execute/route.ts',
  'src/frontend/app/api/actionbridge/approvals/route.ts',
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
  for (const [name, source] of [['actions', actionsRoute], ['connectors', connectorsRoute], ['execute', executeRoute], ['approvals', approvalsRoute]]) {
    if (!source.includes('createClient')) fail(`${name} route must use Supabase server auth`);
    if (!source.includes('auth.getUser')) fail(`${name} route must require authenticated user`);
    if (!source.includes('UNAUTHORIZED')) fail(`${name} route must fail closed when unauthenticated`);
  }
  if (!connectorsRoute.includes('actionbridge_connectors')) fail('connectors route must persist/list actionbridge_connectors');
  if (!connectorsRoute.includes(".eq('user_id', user!.id)")) fail('connectors route must scope reads to authenticated owner');
  if (!connectorsRoute.includes('createCoreServiceClient')) fail('connectors route must use server-only service client for connector creation');
  if (!connectorsRoute.includes('ACTIONBRIDGE_CONNECTOR_CREATE_FAILED')) fail('connectors route must fail closed on connector creation errors');
  if (!connectorsRoute.includes('parsedUrl.username') || !connectorsRoute.includes('parsedUrl.password')) fail('connectors route must reject URL userinfo secrets');
  if (connectorsRoute.includes('secret_ref:') && !connectorsRoute.includes('ACTIONBRIDGE_SECRET_STORAGE_NOT_CONFIGURED')) fail('connectors route must not accept client-supplied secret_ref');
  if (!connectorsRoute.includes('redactActionBridgeValue')) fail('connectors route must redact invalid connector payloads');
  if (actionsRoute.includes('demoActions')) fail('actions route must not serve demo-only actions');
  if (!actionsRoute.includes('actionbridge_actions')) fail('actions route must persist/list actionbridge_actions');
  if (!actionsRoute.includes(".eq('user_id', user!.id)")) fail('actions route must scope action reads/writes to authenticated owner');
  if (!actionsRoute.includes('ACTIONBRIDGE_ACTION_CREATE_FAILED')) fail('actions route must fail closed on action creation errors');
  if (actionsRoute.includes('requiresApproval ===')) fail('actions route must not trust client-controlled requiresApproval');
  if (actionsRoute.includes('requires_approval ===')) fail('actions route must not trust client-controlled requires_approval');
  if (!actionsRoute.includes("ActionBridgeRiskLevel = 'write'") && !actionsRoute.includes("riskLevel: 'write'")) fail('actions route must default client-created actions to write risk');
  if (!actionsRoute.includes('createCoreServiceClient')) fail('actions route must use server-only service client for action creation');
  if (!actionsRoute.includes('requires_approval: true')) fail('actions route must force approval for client-created actions');
  if (!actionsRoute.includes('connector_id')) fail('actions route must persist connector_id relationship');
  if (!executeRoute.includes('decideActionBridgePolicy')) fail('execute route must call policy decision layer');
  if (!executeRoute.includes('approval_required')) fail('execute route must support approval_required decision');
  if (!executeRoute.includes('redactActionBridgeValue')) fail('execute route must redact inputs before returning/logging');
  if (!approvalsRoute.includes('export async function POST')) fail('approvals route must support approve/reject decisions');
  if (!approvalsRoute.includes('p_user_id: user!.id')) fail('approvals route must scope decisions to authenticated owner');
  if (!approvalsRoute.includes('ACTIONBRIDGE_APPROVAL_DECISION_FAILED')) fail('approvals route must fail closed if decision persistence fails');
  if (!approvalsRoute.includes('decide_actionbridge_approval_atomic')) fail('approvals route must use atomic approval decision RPC with audit');
  if (!approvalsRoute.includes('createCoreServiceClient')) fail('approvals route must use server-only service client for approval status transitions');
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
  if (!process.exitCode) pass('ActionBridge persistence helpers write approvals and redacted audit logs');
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
  for (const token of ['isPrivateActionBridgeHost', 'localhost', '127.', '10.', '172.', '192.168', '169.254']) {
    if (!httpConnectorSecurity.includes(token)) fail(`HTTP connector missing SSRF/private-host guard marker: ${token}`);
  }
  if (!httpConnectorSecurity.includes('AbortSignal.timeout')) fail('HTTP connector must use bounded request timeout before network execution');
  if (!httpConnectorSecurity.includes("redirect: 'manual'") && !httpConnectorSecurity.includes('redirect: "manual"')) {
    fail('HTTP connector must not auto-follow redirects');
  }
  if (!process.exitCode) pass('ActionBridge HTTP connector includes SSRF, timeout, and redirect guardrails');
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
  for (const token of ['actionbridge_executions', 'idempotency_key', 'execution_id', 'approval_id', 'approved', 'executing', 'succeeded', 'failed']) {
    if (!persistence.includes(token)) fail(`persistence.ts missing execution state token ${token}`);
  }
  if (!process.exitCode) pass('ActionBridge persistence supports consume-once execution state and idempotency');
}

if (exists('src/frontend/app/api/actionbridge/execute/route.ts')) {
  const executeRouteState = read('src/frontend/app/api/actionbridge/execute/route.ts');
  for (const token of ['approvalId', 'idempotencyKey', 'consumeApprovedActionBridgeExecution', 'persistActionBridgeExecutionResult', 'executionId', 'ACTIONBRIDGE_APPROVAL_NOT_EXECUTABLE', 'ACTIONBRIDGE_EXECUTION_RESULT_PERSIST_FAILED', 'dry_run_succeeded', 'networkExecution: false']) {
    if (!executeRouteState.includes(token)) fail(`execute route missing execution state/idempotency token ${token}`);
  }
  if (executeRouteState.includes('executeHttpActionConnector(')) fail('execute route must not enable real network ActionBridge execution yet');
  if (!process.exitCode) pass('ActionBridge execute route consumes approvals once and records a non-network dry-run result');
}

if (migrationFiles.length) {
  const migration = migrationFiles.map((name) => read(`supabase/migrations/${name}`)).join('\n');
  for (const token of [
    'actionbridge_executions',
    'idempotency_key',
    'execution_status',
    'consume_actionbridge_approval_for_execution',
    "status = 'approved'",
    "status NOT IN ('rejected', 'expired')",
    'UNIQUE (user_id, approval_id, idempotency_key)',
    'execution_id',
  ]) {
    if (!migration.includes(token)) fail(`ActionBridge migration missing execution/idempotency guard: ${token}`);
  }
  if (!migration.includes('GRANT EXECUTE ON FUNCTION public.consume_actionbridge_approval_for_execution(UUID, UUID, TEXT) TO service_role')) {
    fail('ActionBridge consume execution RPC must be executable by service_role');
  }
  if (!process.exitCode) pass('ActionBridge migration defines consume-once approval execution state and idempotency');
}

process.exit(process.exitCode || 0);
