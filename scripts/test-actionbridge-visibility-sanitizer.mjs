#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const source = fs.readFileSync(path.join(root, 'src/frontend/app/api/actionbridge/visibility-sanitizer.ts'), 'utf8');
const fail = (msg) => { console.error(`❌ ${msg}`); process.exitCode = 1; };
const pass = (msg) => console.log(`✅ ${msg}`);

const sensitiveKeys = ['idempotencyKey', 'idempotencyKeyPrefix', 'apiKey', 'token', 'clientSecret', 'authorization', 'password'];
const safeKeys = ['status', 'mode', 'reason', 'networkExecution', 'auditCode', 'responseLimits', 'executionControls'];

for (const key of safeKeys) {
  if (!source.includes(`'${key}'`)) fail(`visibility sanitizer allowlist missing safe key ${key}`);
}

for (const token of ['SAFE_RESULT_KEYS', 'SENSITIVE_KEY_PATTERN', 'sanitizeActionBridgeVisibilityResult', 'networkExecution: false']) {
  if (!source.includes(token)) fail(`visibility sanitizer missing ${token}`);
}

for (const key of ['idempotency', 'secret', 'token', 'password', 'authorization', 'credential', 'api[-_]?', 'client[-_]?secret']) {
  if (!source.includes(key)) fail(`visibility sanitizer sensitive pattern missing ${key}`);
}

const auditRoute = fs.readFileSync(path.join(root, 'src/frontend/app/api/actionbridge/audit/route.ts'), 'utf8');
const executionsRoute = fs.readFileSync(path.join(root, 'src/frontend/app/api/actionbridge/executions/route.ts'), 'utf8');

if (!auditRoute.includes('sanitizeActionBridgeVisibilityResult(entry.result_summary)')) {
  fail('audit route must sanitize result_summary before returning it');
}
if (executionsRoute.includes('...result')) {
  fail('executions route must not spread stored safe_result JSON into responses');
}
if (!executionsRoute.includes('sanitizeActionBridgeVisibilityResult(value)')) {
  fail('executions route must sanitize safe_result before returning it');
}

const forbiddenRoutePatterns = sensitiveKeys.map((key) => `${key}:`);
for (const pattern of forbiddenRoutePatterns) {
  if (auditRoute.includes(pattern) || executionsRoute.includes(pattern)) {
    fail(`visibility routes must not construct sensitive response field ${pattern}`);
  }
}

if (!process.exitCode) pass('ActionBridge visibility sanitizer strips sensitive stored JSON by allowlist before route responses');
process.exit(process.exitCode || 0);
