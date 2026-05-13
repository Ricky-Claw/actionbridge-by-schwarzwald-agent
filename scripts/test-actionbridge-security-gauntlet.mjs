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
if (executeRoute.includes('idempotencyKeyDigest') && !executeRoute.includes('idempotencyKey: consumed.execution.idempotencyKey')) pass('idempotency response redacts raw key');
else fail('idempotency leak', 'raw key may be returned');
if (executeRoute.includes('policy_check_succeeded_without_execution') && executeRoute.includes('networkExecution: false')) pass('execution status is explicitly non-network dry-run');
else fail('misleading execution status', 'missing explicit non-network dry-run wording');
if (!executeRoute.includes('body.allowlist') && executeRoute.includes('allowed_origins') && executeRoute.includes('parseServerActionBridgeAllowlist(connectorForPlan?.allowed_origins)')) pass('execute route uses server-owned connector allowlist only');
else fail('caller allowlist trust', 'execute route may not be using connector-owned allowed_origins');
if (executeRoute.includes('network_execution_enabled') && executeRoute.includes('networkExecution: false') && !executeRoute.includes('executeHttpActionConnector(')) pass('execution controls selected while network remains disabled');
else fail('network execution control invariant', 'missing controls or network may be enabled');

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
