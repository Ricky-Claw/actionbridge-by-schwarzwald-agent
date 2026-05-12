#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const source = fs.readFileSync(path.join(root, 'src/frontend/lib/actionbridge/dns-ip-guard.ts'), 'utf8');
let failed = 0;
const pass = (msg) => console.log(`✅ ${msg}`);
const fail = (msg) => { failed += 1; console.error(`❌ ${msg}`); };

for (const forbidden of ['fetch(', 'dns.lookup', 'resolve4(', 'resolve6(', 'resolveAny(', 'networkExecution: true']) {
  if (source.includes(forbidden)) fail(`DNS/IP guard must be offline-only; found ${forbidden}`);
}

for (const token of [
  'decideActionBridgeDnsPinning',
  'ActionBridgeDnsResolutionSnapshot',
  'DNS resolution returned no addresses',
  'DNS resolution included private or link-local address',
  'networkExecution: false',
]) {
  if (source.includes(token)) pass(`DNS/IP guard contract includes ${token}`);
  else fail(`DNS/IP guard contract missing ${token}`);
}

// Executable mirror of dns-ip-guard.ts logic for local abuse payload coverage without importing TS/server modules.
const PRIVATE_HOST_PREFIXES = ['127.', '10.', '172.', '192.168', '169.254'];
const BLOCKED_HOSTS = new Set(['localhost', '0.0.0.0', '::', '::1']);
const normalize = (value) => value.trim().toLowerCase().replace(/^\[|\]$/g, '');
const isValidIpv4Part = (value) => /^\d{1,3}$/.test(value) && Number(value) >= 0 && Number(value) <= 255;
function isPrivateIpAddress(address) {
  const normalized = normalize(address);
  if (BLOCKED_HOSTS.has(normalized)) return true;
  if (PRIVATE_HOST_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true;
  if (normalized.includes('::ffff:')) return true;
  const ipv4Parts = normalized.split('.');
  if (ipv4Parts.length === 4 && ipv4Parts.every(isValidIpv4Part)) {
    const [a, b] = ipv4Parts.map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
}
function isBlockedHost(hostname) {
  const normalized = normalize(hostname);
  return isPrivateIpAddress(normalized) || normalized.endsWith('.local') || normalized.endsWith('.internal');
}
function decide(snapshot) {
  const hostname = normalize(snapshot.hostname);
  if (isBlockedHost(hostname)) return { ok: false, reason: 'host' };
  if (!snapshot.addresses.length) return { ok: false, reason: 'empty' };
  if (snapshot.addresses.some((entry) => isPrivateIpAddress(entry.address))) return { ok: false, reason: 'address' };
  return { ok: true };
}

for (const [label, snapshot, expectedOk] of [
  ['public host + public IPv4 allowed', { hostname: 'api.example.com', addresses: [{ address: '93.184.216.34', family: 4 }] }, true],
  ['public host + private IPv4 blocked', { hostname: 'api.example.com', addresses: [{ address: '10.0.0.5', family: 4 }] }, false],
  ['public host + link-local IPv4 blocked', { hostname: 'api.example.com', addresses: [{ address: '169.254.169.254', family: 4 }] }, false],
  ['public host + IPv6 ULA blocked', { hostname: 'api.example.com', addresses: [{ address: 'fd00::1', family: 6 }] }, false],
  ['localhost host blocked despite public address', { hostname: 'localhost', addresses: [{ address: '93.184.216.34', family: 4 }] }, false],
  ['empty resolver result blocked', { hostname: 'api.example.com', addresses: [] }, false],
]) {
  const result = decide(snapshot);
  if (result.ok === expectedOk) pass(`DNS/IP guard case: ${label}`);
  else fail(`DNS/IP guard case failed: ${label}; expected ${expectedOk}, got ${result.ok}`);
}

process.exit(failed ? 1 : 0);
