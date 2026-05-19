# ActionBridge Multi-Target Archipel Connector Spec

Date: 2026-05-19
Status: Approved for MVP implementation

## Goal

ActionBridge remains the connector layer, but can manage many connected URLs for one Schwarzwald-Agent tenant/workspace. The Archipel Hub and Schwarzwald-Agent agents can list and inspect those targets through ActionBridge, while all higher-level SEO, content, deployment, monetization, and cross-site strategy stays outside ActionBridge.

## Scope

Pilot tenant:

- `provider_id`: `schwarzwald-agent`
- `tenant_id`: `archipel`
- Bridge origin: `https://bridge.schwarzwald-agent.de`

Pilot targets:

1. `https://pflasterarbeiten24.de`
2. `https://briefe-beschriften.de`
3. `https://porto-rechner24.de`
4. `https://vorlage-quittung.de`
5. `https://rechnung-ohne-mehrwertsteuer.de`
6. `https://brutto-netto-rechner-teilzeit.de`
7. `https://lebenslauf-vorlage-kostenlos.de`
8. `https://projekt-archipel.de` — hub, live webroot not yet confirmed

## Non-Goals

ActionBridge does not become the Archipel Hub. It does not plan SEO, write content, trigger deployments, create monetization decisions, or connect sites directly to each other. It only registers targets, proves ownership/connectivity, exposes per-target read-only tools, and enforces tenant isolation, policy, audit, rate limit, and kill-switch boundaries.

## Tenant Model

ActionBridge must enforce isolation at its own layer:

- `provider_id`: integration provider, initially `schwarzwald-agent`
- `tenant_id`: Schwarzwald-Agent customer/workspace, initially `archipel`
- `user_id`: operator/user/agent within that tenant
- `target_id`: individual URL/island

No query or agent catalog may return targets across tenant boundaries.

## Target Registry

Each target stores:

- stable `target_id`
- `provider_id`
- `tenant_id`
- optional `owner_user_id`
- normalized `url`, `origin`, and `hostname`
- `bridge_origin`
- ownership status: `pending`, `verified`, `unverified`, `failed`
- script status: `unknown`, `connected`, `missing_script`, `script_found_no_handshake`, `unreachable`, `error`
- connection status: `pending`, `connected`, `unverified`, `missing_script`, `unreachable`, `error`
- capabilities, defaulting to read-only target inspection
- timestamps and redacted status metadata

## Multi-URL Intake

The MVP accepts multiple URLs, normalizes them to HTTPS origins, rejects private/internal/local hosts, rejects unsupported schemes, deduplicates by tenant+origin, and creates one target per accepted URL.

## Ownership and Script Checks

The MVP models status safely without high-impact scanning. For each target, ActionBridge can represent:

- domain reachable or not
- ownership challenge pending/verified/unverified
- bridge script found/missing
- handshake connected/not connected

The bridge script origin defaults to `https://bridge.schwarzwald-agent.de`. Future bridge origins such as `https://bridge.actionbridge.de` or customer-owned white-label origins can be configured per target/tenant.

## Agent Tool Catalog

The first catalog is read-only and tenant-scoped:

- `actionbridge.targets.list`
- `actionbridge.target.status`
- `actionbridge.target.capabilities`
- `actionbridge.target.health_check`

Every tool requires `tenant_id`. Per-target tools require `target_id`. Write/deploy/cross-site actions are excluded from this MVP.

## Safety Requirements

- Tenant isolation is enforced in types, helper functions, and database constraints.
- Raw secrets, setup token digests, and private connector data are never exposed to tool catalogs.
- Target checks are bounded and human-scale.
- Read-only catalog tools must not perform writes.
- Connection between multiple sites means shared tenant visibility to the agent, not direct site-to-site trust.

## Acceptance Criteria

- A deterministic seed can create the 8 Archipel pilot targets.
- Bulk intake normalizes, validates, and deduplicates URLs.
- Target connection status can show green/connected or red/missing script/unverified/unreachable.
- Tool catalog returns only targets for the requested tenant.
- Cross-tenant access attempts return no target.
- Tests prove tenant isolation and script-status classification.
