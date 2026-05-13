# ActionBridge Setup Autopilot Concept

Date: 2026-05-13
Owner: Breaker / ActionBridge
Status: Concept, not executor-live

## Goal

Turn a customer website into a safe ActionBridge setup draft: business context, public pages, visible offers, forms, FAQ signals, tone of voice, and proposed agent capabilities.

The autopilot should reduce customer onboarding from manual discovery to: paste website URL -> review extracted profile -> approve generated ActionBridge connector/actions.

## Core Product Promise

"Gib ActionBridge eine Website. ActionBridge erkennt, was öffentlich sichtbar ist, schlägt sichere Agent-Fähigkeiten vor und baut daraus einen überprüfbaren Setup-Entwurf."

## User Flow

1. User enters an owned/authorized website URL.
2. ActionBridge validates HTTPS origin, allowlist, SSRF/DNS rules, robots policy, and rate budget.
3. Autopilot extracts public passive data only:
   - titles, descriptions, canonical URLs;
   - headings and visible text summaries;
   - same-origin links;
   - form inventory without submission;
   - public pricing/offer/contact/FAQ signals;
   - social/profile links.
4. Autopilot generates a customer profile draft:
   - business summary;
   - services/offers;
   - target audience hints;
   - language/tone;
   - common questions;
   - contact/conversion paths.
5. Autopilot proposes ActionBridge capabilities:
   - public website read/search;
   - FAQ answer from extracted public content;
   - contact form draft preparation;
   - quote/reservation/order draft preparation when forms are present;
   - blocked capabilities for payment/login/submit until explicit policy exists.
6. Human reviews and approves each generated connector/action.
7. Sentinel gates decide which capabilities can become live.

## MVP Scope

MVP is setup/draft only. It does not submit forms, bypass login, reuse cookies, scrape private content, or execute stealth extraction in production.

Allowed MVP outputs:
- website profile JSON;
- proposed connectors;
- proposed read-only/assist actions;
- blocked-risk report;
- onboarding checklist.

Excluded from MVP:
- form submission;
- checkout/payment actions;
- account/login flows;
- third-party crawling beyond visible external link inventory;
- high-volume crawling;
- raw HTML/JS exposure to agents.

## Monetization Paths

### 1. ActionBridge SaaS Feature

Package as a paid onboarding accelerator:
- Starter: one website profile and generated setup draft.
- Pro: scheduled public re-profile, broken link/form drift detection, updated FAQ/capability suggestions.
- Agency: multi-client setup dashboard and exports.

### 2. Done-for-you Setup Audit

Sell a fixed-price report:
- public website capability map;
- agent-readiness score;
- form and conversion-path inventory;
- broken route/SEO metadata issues;
- safe ActionBridge implementation plan.

### 3. Connector Marketplace Seed

Use website profiles to generate reusable connector templates:
- restaurant booking draft;
- clinic appointment draft;
- agency lead intake draft;
- ecommerce product FAQ read-only;
- local service quote request draft.

## Security Model

Default posture: observe only.

Required before live network execution:
- exact-origin allowlist;
- server-side DNS resolution and IP classification;
- redirect validation;
- robots.txt respect;
- per-origin and per-tenant rate limits;
- browser network interception blocking non-GET/HEAD, beacon, websocket, form submit, uploads, downloads;
- PII/secrets redaction before response and audit;
- audit of target, decision, page count, byte count, blocked request summary;
- global, tenant, and origin kill switches.

## First ActionBridge Slice

Implement a safe Website Connector type and dry-run extraction plan:
- connector type: `website`;
- capabilities: `public_page_extract`, `same_origin_route_discovery`, `metadata_extract`, `form_inventory`, `no_form_submit`;
- `network_execution_enabled=false` by default;
- no Scrapling runtime wired yet;
- tests assert no `fetch`, no `StealthyFetcher`, and `networkExecution:false`.

## Success Criteria

- User can create a website connector draft.
- Dry-run execution summarizes allowed extraction scope and blocked behaviors.
- Audit/result summaries never imply real network extraction.
- Sentinel can block release of live executor until guardrails are implemented.
- Concept can become a sales page, onboarding wizard, or implementation plan.
