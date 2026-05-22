#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const result = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8' });
if (!result.stdout) {
  console.error('npm audit did not return JSON output.');
  process.exit(result.status || 1);
}

const report = JSON.parse(result.stdout);
const vulnerabilities = report.metadata?.vulnerabilities || {};
const high = vulnerabilities.high || 0;
const critical = vulnerabilities.critical || 0;

console.log(JSON.stringify({
  low: vulnerabilities.low || 0,
  moderate: vulnerabilities.moderate || 0,
  high,
  critical,
  total: vulnerabilities.total || 0,
}));

if (high || critical) {
  console.error('High/Critical npm audit findings block ActionBridge release gates.');
  process.exit(1);
}
