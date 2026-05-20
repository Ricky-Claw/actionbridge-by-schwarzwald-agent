#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));
let failed = 0;
const pass = (msg) => console.log(`✅ ${msg}`);
const fail = (msg) => { failed += 1; console.error(`❌ ${msg}`); };

const orderedDemoPages = [
  'src/frontend/app/actionbridge/page.tsx',
  'src/frontend/app/actionbridge/operator/page.tsx',
  'src/frontend/app/actionbridge/targets/page.tsx',
  'src/frontend/app/actionbridge/setup/page.tsx',
  'src/frontend/app/actionbridge/pitch/page.tsx',
  'src/frontend/app/actionbridge/wizard/page.tsx',
  'src/frontend/app/actionbridge/permissions/page.tsx',
  'src/frontend/app/actionbridge/demo-tenant/page.tsx',
  'src/frontend/app/actionbridge/trust/page.tsx',
  'src/frontend/app/actionbridge/audit-preview/page.tsx',
  'src/frontend/app/actionbridge/tool-preview/page.tsx',
  'src/frontend/app/actionbridge/failures/page.tsx',
  'src/frontend/app/actionbridge/quarantine/page.tsx',
  'src/frontend/app/actionbridge/sales/page.tsx',
];

for (const file of orderedDemoPages) {
  if (exists(file)) pass(`100k MVP page exists: ${file}`);
  else fail(`100k MVP page missing: ${file}`);
}

const orderedDemoRoutes = [
  'src/frontend/app/api/actionbridge/setup-links/route.ts',
  'src/frontend/app/api/actionbridge/setup-session/route.ts',
  'src/frontend/app/api/actionbridge/connectors/verify/route.ts',
  'src/frontend/app/actionbridge/bridge.js/route.ts',
  'src/frontend/app/api/actionbridge/bridge/handshake/route.ts',
  'src/frontend/app/api/actionbridge/capabilities/route.ts',
  'src/frontend/app/api/actionbridge/agent-tools/route.ts',
  'src/frontend/app/api/actionbridge/targets/route.ts',
  'src/frontend/app/api/actionbridge/execute/route.ts',
  'src/frontend/app/api/actionbridge/audit/route.ts',
];

for (const file of orderedDemoRoutes) {
  if (exists(file)) pass(`100k MVP route exists: ${file}`);
  else fail(`100k MVP route missing: ${file}`);
}

const demoDocPath = 'docs/demos/2026-05-14-actionbridge-100k-mvp-demo.md';
if (!exists(demoDocPath)) fail(`100k MVP demo doc missing: ${demoDocPath}`);
else {
  const doc = read(demoDocPath);
  for (const token of [
    'Setup-Link',
    'Domain-Verifikation',
    'Bridge-Handshake',
    'Tool-Catalog',
    'Dry-run Execution',
    'Kill switches',
  ]) {
    if (doc.toLowerCase().includes(token.toLowerCase())) pass(`100k MVP doc covers: ${token}`);
    else fail(`100k MVP doc missing: ${token}`);
  }
}

const uiSource = orderedDemoPages.map(read).join('\n');
for (const token of ['Setup-Link', 'Domain-Verifikation', 'Bridge-Handshake', 'Tool-Catalog', 'Dry-run Execution', 'Audit']) {
  if (uiSource.toLowerCase().includes(token.toLowerCase())) pass(`100k MVP UI covers: ${token}`);
  else fail(`100k MVP UI missing: ${token}`);
}
for (const token of ['ActionBridge Experience Map', 'Every approved website becomes a safe agent tool', 'Permission Matrix', 'Customer Setup Wizard', 'Controlled Demo Tenant', 'Trust Center', 'Audit Timeline', 'Agent Tool Preview', 'Failure-State UX', 'Connector Quarantine', 'One-page Sales Narrative']) {
  if (uiSource.toLowerCase().includes(token.toLowerCase())) pass(`ActionBridge experience covers: ${token}`);
  else fail(`ActionBridge experience missing: ${token}`);
}
for (const forbidden of ['token_digest', 'service_role', 'secret_ref', 'idempotency_key', 'document.cookie', 'localStorage']) {
  if (uiSource.includes(forbidden)) fail(`100k MVP UI contains forbidden sensitive/internal marker: ${forbidden}`);
}
if (read('src/frontend/app/actionbridge/operator/page.tsx').includes('method="post"')) {
  fail('Operator shell must not use native HTML POST because setup-links expects JSON');
} else pass('Operator shell avoids broken native POST to JSON endpoint');

const setupSession = read('src/frontend/lib/actionbridge/setup-session.ts');
const bridgeHandshake = read('src/frontend/lib/actionbridge/bridge-handshake.ts');
if (setupSession.includes('data-setup-token')) pass('Setup session snippet passes setup token to bridge script');
else fail('Setup session snippet must use data-setup-token; bridge script cannot handshake with data-site-id');

if (bridgeHandshake.includes("getAttribute('data-setup-token')")) pass('Bridge script reads data-setup-token');
else fail('Bridge script must read data-setup-token');

for (const forbidden of ['data-site-id', 'localStorage', 'document.cookie', 'querySelectorAll', 'submit()']) {
  if (bridgeHandshake.includes(forbidden)) fail(`Bridge script contains forbidden demo behavior: ${forbidden}`);
}
if (!failed) pass('100k MVP demo flow contract is wired without scraping, storage, cookies, or auto-submit');

process.exitCode = failed ? 1 : 0;
