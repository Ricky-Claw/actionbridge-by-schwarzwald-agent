# ActionBridge Build and Verification Gates

## Current Gates
The current focused ActionBridge repository has no visible Next.js build metadata (`tsconfig.json`, `next.config.*`, lockfile, or frontend package install context). Because of that, the reliable gates today are script-based product/security contracts:

```bash
npm test
git diff --check
```

`npm test` runs:
- `test:contracts`
- `test:security`
- `test:dns-ip`
- `test:visibility-sanitizer`
- `test:demo-flow`

## Meaning
These tests verify the standalone ActionBridge product contract, security guardrails, SSRF/DNS handling, redaction/visibility behavior, and demo/userflow wiring.

## Not Yet Available
The following are not currently executable from this repo snapshot:
- `npm run build`
- TypeScript `tsc --noEmit`
- framework lint
- browser E2E

Reason: build metadata/dependencies are not present in this focused repo snapshot.

## Required Before Production
Before production release, add or restore:
- `tsconfig.json`
- Next.js config if frontend remains Next-based
- lockfile and install instructions
- `npm run build`
- `npm run lint`
- at least one smoke/userflow test that exercises setup-link → verification → bridge → capability → approval → connector execution in a controlled environment

## Autopilot Rule
Until build metadata exists, Autopilot must use:

```bash
npm test && git diff --check
```

Once build/lint scripts exist, Autopilot must include them before commit/push.
