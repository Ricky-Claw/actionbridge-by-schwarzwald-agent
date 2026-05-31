# ActionBridge Build and Verification Gates

## Current Gates
The focused ActionBridge repository has executable Next.js, TypeScript, ESLint, security, behavioral, route-core, smoke, and dependency-audit gates for the `src/frontend` snapshot.

Autopilot and release-prep checks must use the aggregate gate:

```bash
npm run check
```

`npm run check` currently runs:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:userflow-smoke
npm run audit:high
git diff --check
```

`npm test` currently runs:
- `test:contracts`
- `test:security`
- `test:behavioral-security`
- `test:behavioral-modules`
- `test:setup-domain-verification`
- `test:secret-manager-live-probe-route`
- `test:dns-ip`
- `test:visibility-sanitizer`
- `test:multi-target-registry`
- `test:demo-flow`

## Meaning
These gates verify the standalone ActionBridge product contract, security guardrails, SSRF/DNS handling, redaction/visibility behavior, setup-domain verification behavior, managed-secret live-probe route core, demo/userflow wiring, TypeScript soundness, lint hygiene, a real Next production build for the focused frontend snapshot, and absence of High/Critical dependency findings.

## Available Build Metadata
- `package-lock.json` and package dependencies.
- Root `tsconfig.json` for full snapshot typechecking.
- `src/frontend/tsconfig.json` for `next build src/frontend`.
- `next.config.mjs` with fail-on-type-error behavior.
- `eslint.config.mjs` for strict zero-warning lint.
- Supabase server/service client entrypoints required by API routes.
- `scripts/test-actionbridge-userflow-smoke.mjs`, which starts the built Next frontend locally and checks the core ActionBridge route journey and secret-leak invariants.

## Production Proof Gaps
The local gates are controlled-pilot gates, not broad-production approval. Production release still needs externally gathered evidence from the approved deployed environment:
- managed Secret Manager/KMS provisioning with least-privilege runtime identity/token issuance;
- live secret-manager probe evidence with `auditPersisted: true` and a matching redacted audit row;
- deployed staging setup → verification → bridge/adapter → capability → tool-catalog → approval → Webhook-v1 delivery smoke, with `ACTIONBRIDGE_PUBLIC_BASE_URL` pinned to the exact staging ActionBridge HTTPS origin;
- deployed SSRF/DNS/rebinding and pinned-connection tests against controlled staging domains;
- distributed production rate-limit configuration evidence;
- final Sentinel release review with no open Critical/High findings.

## Autopilot Rule
Autopilot must run the full `npm run check` gate before commit/push unless a narrower failed gate blocks the run and is explicitly documented. Do not mark production/broad rollout ready from local gates alone.

## Audit Note
`npm run audit:high` fails on High/Critical dependency findings. Current dependency audit still reports Moderate `postcss` findings through Next's dependency tree; no High/Critical dependency finding is present in this snapshot.
