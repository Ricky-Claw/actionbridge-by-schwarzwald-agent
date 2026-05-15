# ActionBridge Scope Plan

## Zielbild
ActionBridge wird standalone als sicherer Connector-/Execution-Control-Layer fertig, bevor es in Schwarzwald-Agent integriert wird.

## Phase 1 — Controlled Pilot MVP
**Ziel:** Ein Kunde kann Domain/App verifizieren, Bridge/Connector aktivieren, ein Agent-Tool nutzen, Approval geben und eine kontrollierte Connector-Aktion auslösen.

Scope:
- Setup-Link + Token-Digest + Status/Replay-Schutz
- Domain Verification: DNS TXT, Meta Tag, `.well-known`
- Bridge connected-only handshake
- Capability Gates
- Tool Catalog ohne Secrets
- Approval Flow
- Audit/Redaction
- Pilot Rate-Limit Gates
- `lead.submit` als Connector-Delivery-State
- Webhook-v1 als erster echter externer Connector-Adapter

Exit Criteria:
- `npm test` grün
- `git diff --check` grün
- Sentinel GO für Pilot
- Kein High/Critical offen
- Runbook vorhanden

## Phase 2 — Standalone Usability
**Ziel:** Operator/Kunde versteht und nutzt ActionBridge ohne meine Erklärung.

Scope:
- Setup UX Texte schärfen
- Failure States klarer machen
- Trust/Permission Screens produktnäher
- Smoke-Test-Flow dokumentieren
- Build/Typecheck-Gate klären oder herstellen

Exit Criteria:
- Setup Flow ist in Docs/UI klar
- Demo/Skeleton ist nicht als Production getarnt
- Verifikations-/Approval-/Execution-Fehler sind verständlich

## Phase 3 — Production Safety
**Ziel:** ActionBridge kann sicher in echten Umgebungen laufen.

Scope:
- Distributed Rate Limits: Redis/KV/CDN/WAF
- trusted proxy header policy
- per tenant/connector/action/token throttles
- staging SSRF/DNS tests
- retention/GDPR policy
- monitoring/quarantine/kill-switch docs

Exit Criteria:
- Sentinel Production-Safety GO
- keine process-local-only Controls als Production verkauft

## Phase 4 — Connector Expansion
**Ziel:** Mehr Kundensysteme anbinden, ohne Produkt-Scope zu verwässern.

Scope:
- Webhook-v1 hardening
- CRM-v1 oder Forms-v1 Adapter
- OAuth/API Adapter Pattern
- Plugin/SDK Contract

Exit Criteria:
- Jeder Adapter hat Spec, Tests, Sentinel Review, Audit, Rate Limit, Failure State

## Phase 5 — Integration Readiness
**Ziel:** Erst wenn standalone DoD erfüllt ist, Integration in Schwarzwald-Agent vorbereiten.

Scope:
- Runtime auth/signing
- Tool Consumption Contract finalisieren
- Dashboard embedding plan
- Operator setup link generation from dashboard

Exit Criteria:
- ActionBridge standalone Pilot/MVP ist nach DoD grün
- Integration fügt nur UI/Distribution hinzu, keine unfertige Core-Logik

## Top 5 aktuelle Tasks
1. Webhook-v1 Implementation finalisieren: Sentinel GO, Fixes, Commit/Push.
2. Webhook-v1 Failure/Delivery Audit schärfen, falls Sentinel NO-GO gibt.
3. Production Rate-Limit Design für Redis/KV/CDN/WAF dokumentieren.
4. Setup/UX Screens weiter connector-only machen.
5. Build/Typecheck-Metadaten prüfen oder fehlenden Gate als Blocker dokumentieren.

## Nicht tun
- Keine Lead-Inbox bauen.
- Keine CRM-UI bauen.
- Keine Schwarzwald-Agent Integration vor standalone DoD.
- Kein beliebiges externes Formular-Submit.
- Kein Production-Write ohne Sentinel GO.
