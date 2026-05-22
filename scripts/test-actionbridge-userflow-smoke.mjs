#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const port = Number(process.env.ACTIONBRIDGE_USERFLOW_PORT ?? 4317);
const baseUrl = `http://127.0.0.1:${port}`;

const routes = [
  {
    path: '/actionbridge',
    mustContain: ['ActionBridge Experience Map', '/actionbridge/operator', '/actionbridge/wizard'],
  },
  {
    path: '/actionbridge/pitch',
    mustContain: ['ActionBridge Connector Layer', 'safe agent tool'],
  },
  {
    path: '/actionbridge/operator',
    mustContain: ['Operator', 'setup'],
  },
  {
    path: '/actionbridge/wizard',
    mustContain: ['Customer Setup Wizard', 'Autorisierung'],
  },
  {
    path: '/actionbridge/permissions',
    mustContain: ['Permission', 'approval'],
  },
  {
    path: '/actionbridge/tool-preview',
    mustContain: ['Tool', 'secret'],
  },
  {
    path: '/actionbridge/audit-preview',
    mustContain: ['Audit', 'redact'],
  },
  {
    path: '/actionbridge/failures',
    mustContain: ['fail', 'closed'],
  },
  {
    path: '/actionbridge/trust',
    mustContain: ['Trust Center', 'customer boundary'],
  },
  {
    path: '/actionbridge/connectors',
    mustContain: ['Connector', 'ActionBridge'],
  },
  {
    path: '/actionbridge/targets',
    mustContain: ['Target', 'ActionBridge'],
  },
];

const forbiddenPatterns = [
  /sk-[a-z0-9_-]{16,}/i,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/,
  /secret_ref\s*[:=]\s*['\"][^'\"]+/i,
  /token_digest\s*[:=]\s*['\"][^'\"]+/i,
  /idempotency_key\s*[:=]\s*['\"][^'\"]+/i,
];

function fail(message) {
  console.error(`❌ ${message}`);
  process.exitCode = 1;
}

async function waitForServer(child) {
  const deadline = Date.now() + 30_000;
  let lastError = null;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`next start exited early with code ${child.exitCode}`);
    }

    try {
      const response = await fetch(`${baseUrl}/actionbridge`);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await delay(500);
  }

  throw new Error(`Timed out waiting for ${baseUrl}: ${lastError?.message ?? 'no response'}`);
}

async function run() {
  const child = spawn('npx', ['next', 'start', 'src/frontend', '-p', String(port), '-H', '127.0.0.1'], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port) },
  });

  let logs = '';
  child.stdout.on('data', (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk.toString();
  });

  try {
    await waitForServer(child);

    for (const route of routes) {
      const response = await fetch(`${baseUrl}${route.path}`);
      const body = await response.text();

      if (response.status !== 200) {
        fail(`${route.path} returned HTTP ${response.status}`);
        continue;
      }

      for (const expected of route.mustContain) {
        if (!body.toLowerCase().includes(expected.toLowerCase())) {
          fail(`${route.path} is missing expected copy: ${expected}`);
        }
      }

      for (const pattern of forbiddenPatterns) {
        if (pattern.test(body)) {
          fail(`${route.path} exposed forbidden secret-like pattern: ${pattern}`);
        }
      }
    }

    if (process.exitCode) {
      console.error('ActionBridge userflow smoke failed.');
      return;
    }

    console.log(`✅ ActionBridge userflow smoke passed for ${routes.length} routes on ${baseUrl}`);
  } finally {
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }
    await delay(250);
    if (child.exitCode === null && child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }

    if (process.exitCode) {
      console.error('\nnext start logs:');
      console.error(logs.trim());
    }
  }
}

run().catch((error) => {
  console.error(`❌ ActionBridge userflow smoke could not run: ${error.message}`);
  process.exit(1);
});
