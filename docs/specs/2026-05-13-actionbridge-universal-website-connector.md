# ActionBridge Universal Website Connector

Date: 2026-05-13
Status: In progress — guarded MVP

## Definition of "Universal"

Universal means ActionBridge can accept any normal public HTTPS website as input and either:

1. build a safe public-read setup draft, or
2. block with a clear reason.

It does **not** mean bypassing login walls, paywalls, robots.txt, anti-abuse systems, checkout flows, private networks, or write protections.

## MVP Capability

The first universal connector capability is a website connector profile:

- connector type: `website`;
- exact HTTPS origin allowlist;
- public passive extraction plan;
- metadata/headings/link/form inventory classes;
- no form submit;
- no login bypass;
- no cross-origin crawl;
- no raw HTML/JavaScript exposure by default;
- `networkExecution:false` until Sentinel gates pass.

## Required Runtime Gates Before Live Scrapling Executor

A live Scrapling/stealth executor is release-blocked until these controls exist and tests pass:

1. server-side DNS resolution and IP classification;
2. DNS rebinding defense / resolved-IP pinning;
3. redirect target revalidation;
4. robots.txt and crawl-delay policy;
5. per-origin and per-tenant rate limits;
6. browser request interception allowing only GET/HEAD;
7. block forms, POST/PUT/PATCH/DELETE, beacons, websockets, uploads, downloads;
8. PII/secrets redaction before response and audit;
9. audit log with target, decision, page count, bytes, blocked request summary;
10. global, tenant, and origin kill switches.

## Monetizable Product Shape

### ActionBridge Website Setup Autopilot

Input: customer-owned/authorized website URL.

Output:

- business profile draft;
- public page inventory;
- FAQ/content summary;
- form inventory;
- safe ActionBridge connector draft;
- proposed read/assist actions;
- blocked-risk report for anything requiring approvals or future executor policy.

### Commercial Packaging

- **Starter**: one-time website setup draft.
- **Pro**: scheduled re-profile, broken route detection, content drift alerts.
- **Agency**: multi-client onboarding dashboard and connector-template exports.

## Current Implementation Slice

Implemented now:

- `website` connector type support;
- website dry-run extraction planner;
- website extraction guard contracts;
- migration allowing website connectors;
- contract tests requiring no live fetch/browser execution.

Deferred:

- real Scrapling runtime;
- browser sandbox;
- robots fetcher;
- rate-limit store;
- production executor approvals.
