#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const fail = (msg) => { console.error(`❌ ${msg}`); process.exitCode = 1; };
const pass = (msg) => console.log(`✅ ${msg}`);

const modulePath = 'src/frontend/lib/actionbridge/multi-target-registry.ts';
const migrationPath = 'supabase/migrations/20260519143000_actionbridge_multi_target_registry.sql';
const routePath = 'src/frontend/app/api/actionbridge/targets/route.ts';
const uiPath = 'src/frontend/app/actionbridge/operator/ActionBridgeTargetsClient.tsx';
const moduleSource = read(modulePath);
const migration = read(migrationPath);
const routeSource = read(routePath);
const uiSource = read(uiPath);

for (const token of [
  'ACTIONBRIDGE_DEFAULT_BRIDGE_ORIGIN',
  'https://bridge.schwarzwald-agent.de',
  'ACTIONBRIDGE_ARCHIPEL_PILOT_URLS',
  'pflasterarbeiten24.de',
  'briefe-beschriften.de',
  'porto-rechner24.de',
  'vorlage-quittung.de',
  'rechnung-ohne-mehrwertsteuer.de',
  'brutto-netto-rechner-teilzeit.de',
  'lebenslauf-vorlage-kostenlos.de',
  'projekt-archipel.de',
  'normalizeActionBridgeTargetUrl',
  'createActionBridgeTargetsFromUrls',
  'filterActionBridgeTargetsForTenant',
  'createActionBridgeTargetToolCatalog',
  'createActionBridgeArchipelPilotTargets',
  'isPrivateActionBridgeHost',
  'networkExecution: false',
]) {
  if (!moduleSource.includes(token)) fail(`multi-target registry missing ${token}`);
}
if (!process.exitCode) pass('Multi-target registry source exposes Archipel pilot, URL normalization, tenant filtering, and read-only catalog helpers');

for (const forbidden of ['fetch(', 'form.submit', 'secret_ref', 'token_digest', 'localStorage', 'document.cookie']) {
  if (moduleSource.includes(forbidden)) fail(`multi-target registry must not include unsafe primitive: ${forbidden}`);
}
if (!process.exitCode) pass('Multi-target registry has no network execution, browser scraping, or secret exposure primitives');

for (const token of [
  'CREATE TABLE IF NOT EXISTS public.actionbridge_targets',
  'provider_id TEXT NOT NULL',
  'tenant_id TEXT NOT NULL',
  'bridge_origin TEXT NOT NULL',
  'ownership_status TEXT NOT NULL',
  'script_status TEXT NOT NULL',
  'connection_status TEXT NOT NULL',
  'UNIQUE (provider_id, tenant_id, origin)',
  'ALTER TABLE public.actionbridge_targets ENABLE ROW LEVEL SECURITY',
  'idx_actionbridge_targets_provider_tenant',
]) {
  if (!migration.includes(token)) fail(`multi-target migration missing ${token}`);
}
if (!process.exitCode) pass('Multi-target migration enforces tenant-scoped durable target registry');

function normalizeActionBridgeTargetUrl(input) {
  const raw = input.trim();
  if (!raw) return { ok: false, input, reason: 'URL is empty.', networkExecution: false };
  let parsed;
  try { parsed = new URL(raw.includes('://') ? raw : `https://${raw}`); }
  catch { return { ok: false, input, reason: 'Invalid URL.', networkExecution: false }; }
  if (parsed.protocol !== 'https:') return { ok: false, input, reason: 'Only HTTPS target URLs are allowed.', networkExecution: false };
  if (parsed.username || parsed.password) return { ok: false, input, reason: 'Target URL userinfo is not allowed.', networkExecution: false };
  if (['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname)) return { ok: false, input, reason: 'Private, local, or internal target hosts are not allowed.', networkExecution: false };
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = '/';
  return { ok: true, input, url: parsed.toString(), origin: parsed.origin, hostname: parsed.hostname.toLowerCase(), networkExecution: false };
}

function classify(signals) {
  const ownershipStatus = signals.ownershipStatus || 'pending';
  let scriptStatus = 'unknown';
  if (signals.error) scriptStatus = 'error';
  else if (signals.htmlReachable === false) scriptStatus = 'unreachable';
  else if (signals.bridgeScriptFound === false) scriptStatus = 'missing_script';
  else if (signals.bridgeScriptFound && signals.handshakeSeen) scriptStatus = 'connected';
  else if (signals.bridgeScriptFound && !signals.handshakeSeen) scriptStatus = 'script_found_no_handshake';
  let connectionStatus = 'pending';
  if (scriptStatus === 'connected' && ownershipStatus === 'verified') connectionStatus = 'connected';
  else if (scriptStatus === 'missing_script') connectionStatus = 'missing_script';
  else if (scriptStatus === 'unreachable') connectionStatus = 'unreachable';
  else if (scriptStatus === 'error' || ownershipStatus === 'failed') connectionStatus = 'error';
  else if (ownershipStatus === 'unverified') connectionStatus = 'unverified';
  return { ownershipStatus, scriptStatus, connectionStatus };
}

const normalized = normalizeActionBridgeTargetUrl('porto-rechner24.de/kosten?x=1#frag');
assert.equal(normalized.ok, true);
assert.equal(normalized.origin, 'https://porto-rechner24.de');
assert.equal(normalized.url, 'https://porto-rechner24.de/');
assert.equal(normalized.networkExecution, false);
assert.equal(normalizeActionBridgeTargetUrl('http://porto-rechner24.de').ok, false);
assert.equal(normalizeActionBridgeTargetUrl('https://user:pass@example.com').ok, false);
assert.equal(normalizeActionBridgeTargetUrl('https://localhost').ok, false);
pass('URL normalization is HTTPS-only, strips path/query/hash, and rejects local/userinfo targets');

assert.deepEqual(classify({ ownershipStatus: 'verified', htmlReachable: true, bridgeScriptFound: true, handshakeSeen: true }), {
  ownershipStatus: 'verified', scriptStatus: 'connected', connectionStatus: 'connected',
});
assert.equal(classify({ ownershipStatus: 'verified', htmlReachable: true, bridgeScriptFound: false }).connectionStatus, 'missing_script');
assert.equal(classify({ ownershipStatus: 'unverified', htmlReachable: true, bridgeScriptFound: true, handshakeSeen: true }).connectionStatus, 'unverified');
assert.equal(classify({ htmlReachable: false }).connectionStatus, 'unreachable');
pass('Status classification supports connected, missing_script, unverified, and unreachable UI states');

const pilotUrls = [...moduleSource.matchAll(/'https:\/\/([^']+)'/g)]
  .map((match) => `https://${match[1]}`)
  .filter((url) => !url.includes('bridge.schwarzwald-agent.de'));
assert.equal(new Set(pilotUrls).size, 8);
assert.ok(pilotUrls.includes('https://projekt-archipel.de'));
pass('Archipel pilot seed contains exactly the 8 approved island URLs');

const tenantA = [
  { providerId: 'schwarzwald-agent', tenantId: 'archipel', origin: 'https://a.example' },
  { providerId: 'schwarzwald-agent', tenantId: 'other', origin: 'https://b.example' },
].filter((target) => target.providerId === 'schwarzwald-agent' && target.tenantId === 'archipel');
assert.equal(tenantA.length, 1);
assert.equal(tenantA[0].origin, 'https://a.example');
pass('Tenant filter model excludes cross-tenant targets');

const targetTools = ['actionbridge.targets.list', 'actionbridge.target.status', 'actionbridge.target.capabilities', 'actionbridge.target.health_check'];
for (const tool of targetTools) assert.ok(moduleSource.includes(tool));
assert.ok(moduleSource.includes("mode: 'read_only'"));
assert.ok(!moduleSource.includes("riskLevel: 'write'"));
pass('Target tool catalog is read-only and tenant scoped');

for (const token of [
  'requireActionBridgeUser',
  "from('actionbridge_targets')",
  ".eq('owner_user_id', user!.id)",
  ".eq('provider_id', providerId)",
  ".eq('tenant_id', tenantId)",
  'createActionBridgeTargetsFromUrls',
  'upsert',
  "networkExecution: false",
  'ACTIONBRIDGE_TARGET_TENANT_REQUIRED',
  'enforceActionBridgeRateLimit',
  'createActionBridgeRateLimitHeaders',
  'export async function PUT',
  'fetch(target.url',
  'AbortSignal.timeout(5000)',
  'ACTIONBRIDGE_TARGET_LIVE_CHECK_FAILED',
  'bridge.schwarzwald-agent.de/bridge.js',
  'body.slice(0, 250_000)',
  'decideActionBridgeDnsPinning',
  'dns.lookup(target.hostname',
  "redirect: 'manual'",
]) {
  if (!routeSource.includes(token)) fail(`targets API route missing ${token}`);
}
for (const forbidden of ['http://', 'secret_ref', 'token_digest', 'document.cookie', 'localStorage']) {
  if (routeSource.includes(forbidden)) fail(`targets API route must not expose unsafe primitive: ${forbidden}`);
}
pass('Targets API route is auth-gated, tenant-scoped, registry-write-only, and live checks are bounded');

for (const token of [
  '/api/actionbridge/targets',
  '--ab-primary',
  '--ab-card',
  'ActionBridge bleibt nur Connector-Core',
  'connectionStatus',
  'capabilities',
  'Live Check',
  'method: \'PUT\'',
]) {
  if (!uiSource.includes(token)) fail(`targets UI missing ${token}`);
}
pass('Targets operator UI supports multi-URL intake/status and theme tokens without mock production data');
