# ActionBridge Build and Verification Gates

## Current Gates
The focused ActionBridge repository now has executable Next.js/TypeScript/ESLint metadata for `src/frontend` plus package lock/install context.

Autopilot and release-prep checks must use:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run audit:high
git diff --check
```

`npm test` runs:
- `test:contracts`
- `test:security`
- `test:behavioral-security`
- `test:behavioral-modules`
- `test:dns-ip`
- `test:visibility-sanitizer`
- `test:multi-target-registry`
- `test:demo-flow`

## Meaning
These tests verify the standalone ActionBridge product contract, security guardrails, SSRF/DNS handling, redaction/visibility behavior, demo/userflow wiring, TypeScript soundness, lint hygiene, and a real Next production build for the focused frontend snapshot.

## Available Build Metadata
- `package-lock.json` and package dependencies.
- Root `tsconfig.json` for full snapshot typechecking.
- `src/frontend/tsconfig.json` for `next build src/frontend`.
- `next.config.mjs` with fail-on-type-error behavior.
- `eslint.config.mjs` for strict zero-warning lint.
- Supabase server/service client entrypoints required by API routes.

## Not Yet Available
The following production proof is not currently executable from this repo snapshot:
- browser E2E/userflow smoke test.

## Required Before Production
Before production release, add at least one browser/userflow smoke test that exercises setup-link → verification → bridge → capability → approval → connector execution in a controlled environment.

## Autopilot Rule
Autopilot must run the full `npm run check` gate before commit/push. If browser E2E is added, include it in `npm run check` before marking Gate 5 fully complete.

## Audit Note
`npm run audit:high` fails on High/Critical dependency findings. Current dependency audit still reports Moderate `postcss` findings through Next's dependency tree; no High/Critical dependency finding is present in this snapshot.
