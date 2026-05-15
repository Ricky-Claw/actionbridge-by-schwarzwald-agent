# ACTIONBRIDGE_GOAL.md

## 1. Was ist ActionBridge?
ActionBridge ist der Universal Connector-, Übersetzungs- und Execution-Control-Layer für Schwarzwald-Agent. Es verbindet Schwarzwald-Agent-Agenten mit kundengeprüften Websites, Apps, Backends, APIs, Plugins und Workflows — aber immer über sichere, typisierte, policy-gesteuerte Agent-Tools.

ActionBridge ist kein Chatbot, kein CRM, kein Lead-Postfach und kein Automationsprodukt. ActionBridge ist die Brücke: Es prüft Berechtigung, übersetzt Fähigkeiten in Agent-Tool-Schemas, erzwingt Policies/Approvals, redacted Daten, schreibt Audit Logs und führt erlaubte Connector-Aktionen kontrolliert aus.

Kurz: **Schwarzwald-Agent spricht und verkauft. ActionBridge verbindet und kontrolliert. Kundensysteme empfangen/erledigen.**

## 2. Für wen ist es?
- **Schwarzwald-Agent intern / Ricky / Elvis:** damit Kunden schnell, wiederholbar und sicher angebunden werden können.
- **Operatoren im Schwarzwald-Agent Dashboard:** sie erstellen Setup-Links, sehen Verifikationsstatus und aktivieren erlaubte Connector-Fähigkeiten.
- **Kunden/KMU:** sie können ihre Website/App/Backend ohne komplexes API-Projekt agentenfähig machen.
- **Schwarzwald-Agent-Agenten:** sie erhalten saubere Tool-Catalogs statt Rohzugriff auf Websites, APIs oder Secrets.

## 3. Welches konkrete Problem löst es?
Agenten können leicht reden, aber nicht sicher mit echten Kundensystemen handeln. Kunden haben unterschiedliche Websites, Formulare, CRMs, Shops, Kalender und Backends. Direkter API-Key-Zugriff, Browser-Automation oder ungeprüftes Scraping wären riskant, teuer und nicht skalierbar.

ActionBridge löst das durch einen standardisierten Connector-Layer:
- Kunde beweist Domain-/Systemberechtigung.
- Operator/Kunde aktiviert explizit erlaubte Fähigkeiten.
- Schwarzwald-Agent sieht nur erlaubte Tool-Schemas, keine Secrets oder Rohsysteme.
- Riskante Aktionen brauchen Approval.
- Jede relevante Entscheidung wird auditiert und redacted.
- Execution ist fail-closed, rate-limitierbar und abschaltbar.

## 4. Was ist der wichtigste User-Flow?
1. Operator öffnet ActionBridge im Schwarzwald-Agent Dashboard.
2. Operator erstellt einen Setup-Link für eine Kunden-Website/App.
3. Kunde öffnet Setup-Link und verifiziert Domain/Origin per DNS TXT, Meta Tag oder `.well-known`.
4. Kunde installiert bei Bedarf Bridge-Script/Plugin/SDK oder verbindet API/OAuth/Webhook.
5. ActionBridge bestätigt den Bridge-/Connector-Handshake und schließt den Setup-Link.
6. Kunde/Operator aktiviert erlaubte Capabilities, z. B. Website-Wissen lesen oder Lead-Übergabe an ein Kundensystem.
7. Schwarzwald-Agent ruft den ActionBridge Tool-Catalog ab.
8. Agent nutzt ein Tool; ActionBridge prüft Policy, Risiko, Approval, Redaction und Zielsystem-Grenzen.
9. Falls nötig genehmigt ein Mensch.
10. ActionBridge führt die Connector-Aktion kontrolliert aus oder übergibt sie an einen geprüften Adapter/Kundensystem-Endpunkt und schreibt Audit/Result.

## 5. Was ist MVP?
MVP = ein sicherer, nutzbarer Connector-Pilot, der zeigt: Schwarzwald-Agent kann über ActionBridge ein Kundensystem anbinden und kontrolliert eine echte, begrenzte Aktion auslösen.

MVP-Umfang:
- Auth-gated Operator APIs.
- Setup-Link mit Token-Digest, Ablauf, Status und Replay-Schutz.
- Domain-Verifikation via DNS TXT, Meta Tag oder `.well-known`; keine Human-Attestation-Abkürzung.
- Bridge-Script v1: connected-only, keine Cookies, kein Scraping, kein Form-Submit.
- Capability-Regeln: `site.knowledge.read`, `lead.prepare_draft`, `lead.submit`, `appointment.request.prepare_draft`.
- Tool-Catalog für Schwarzwald-Agent ohne Secrets, Base URLs oder raw config.
- Approval-System für write-risk Aktionen.
- Erste echte ActionBridge-Aktion: `lead.submit` erzeugt nach Approval einen **Connector-Delivery-Auftrag** im ActionBridge-Ausführungspfad. Das ist interne Connector-State/Delivery-Plumbing, kein Lead-Postfach-Produkt.
- Audit/Redaction für Setup, Verification, Bridge, Capability, Approval und Execution.
- Tests grün.

## 6. Was ist Premium-Version?
Premium = produktionsreife Universal Connector Platform:
- Voll in Schwarzwald-Agent Dashboard eingebettet.
- Kunden können Setup-Link öffnen, Berechtigung beweisen, Plugin/API/OAuth/Webhook verbinden und erlaubte Aktionen bestätigen.
- Connector-Adapter für WordPress, Webflow, Shopify, Calendly, HubSpot, Pipedrive, Supabase, REST/OAuth, Webhooks.
- Connector-spezifische echte Delivery mit Schema-Mapping, Retries, Rate Limits, Idempotency, Failure-State, Audit und Kill-Switch.
- Setup Autopilot: Website analysieren, öffentliche Fähigkeiten erkennen, sichere Capabilities vorschlagen.
- Granulare Policies pro Tenant/Agent/Connector/Action/Risk/Volume.
- Step-up Approval/Auth für kritische Aktionen.
- Audit/Compliance-Export, Retention, GDPR-Minimierung.
- Signed runtime contract zwischen Schwarzwald-Agent und ActionBridge.
- Monitoring, Quarantine, Staging-SSRF/DNS-Test-Suite und Sentinel Release Gates.

## 7. Was ist NICHT Teil des Projekts?
- ActionBridge ist nicht der Chatbot.
- ActionBridge ist nicht das Schwarzwald-Agent Dashboard selbst.
- ActionBridge ist kein CRM, Lead-Inbox, Ticket-System, Kalender, Shop oder Kundenportal.
- Keine Lead-Outbox-UI als Produktfeature; interne Queues/Delivery-State nur als Connector-Infrastruktur.
- Kein beliebiges externes Formular-Submit ohne kundenspezifischen geprüften Adapter.
- Kein stealth scraping, Login-/Paywall-Bypass oder unauthorized automation.
- Keine Produktion-Schreibaktionen ohne Approval, Audit, Rate Limits und Sentinel-Freigabe.
- Keine Fake-Funktionalität oder Mock-Daten als echtes Produkt verkaufen.
- Keine Secrets in Agent-visible Tools, Logs, UI oder Reports.

## 8. Definition of Done
ActionBridge gilt als fertig, wenn:
- Hauptflow Setup-Link → Verifikation → Bridge/Adapter → Capability → Tool-Catalog → Approval → kontrollierte Connector-Execution funktioniert.
- Schwarzwald-Agent kann den Tool-Catalog nutzen und ActionBridge-Ausführung aufrufen.
- Mindestens ein echter, geprüfter Connector-Delivery-Pfad funktioniert ohne Mock-Fassade.
- Tests grün: contracts, security, DNS/IP, visibility sanitizer, demo/smoke flow.
- Build/Typecheck grün, sobald Build-Metadaten vorhanden sind.
- Keine kritischen/high Security Findings offen.
- Keine versteckten Demo-/Mock-Abhängigkeiten im Produktpfad.
- Setup und Pilot-Runbook sind dokumentiert.
- UX für Operator/Kunde ist verständlich, schnell und professionell.
- Fehlerzustände sind fail-closed und auditierbar.
- Sentinel gibt GO für Pilot; Produktion braucht separate GO.

## 9. Aktuelle Risiken / offene Entscheidungen
- `lead.submit` ist aktuell ein sicherer interner Connector-Delivery-State, noch kein geprüfter externer CRM/Formular/Webhook-Adapter.
- Kein Lead-/Inbox-Produkt bauen; Produktnutzen muss über Schwarzwald-Agent und Kundensysteme sichtbar werden.
- Pilot-Rate-Limit-Gates für öffentliche Setup-/Handshake-/Verification-Endpunkte sind vorhanden, aber nur process-local; Produktion braucht verteiltes Redis/KV/CDN/WAF Rate Limiting.
- Kein echter Next/TypeScript Build-Gate im Repo sichtbar (`tsconfig`/Next config fehlt).
- Production network/write execution braucht staging SSRF/DNS Tests und separate Freigabe.
- Dashboard UX ist Demo/Skeleton, noch nicht voll produktiv.
- Nächste Produktentscheidung: erster externer Delivery-Adapter wahrscheinlich **Webhook-v1**, weil er universell ist und ActionBridge als Connector beweist, ohne Schwarzwald-Agent Integration vorauszusetzen.

## 10. Nächste 10 Arbeitsschritte nach Priorität
1. Scope bereinigen: keine Lead-Outbox-UI/API als Produktziel; `lead.submit` nur als Connector-Delivery-State behandeln.
2. Pilot-Runbook schreiben: Setup, Domain Verification, Capability, Approval, Connector-Execution, Revoke/Kill-Switch.
3. Verteiltes Production-Rate-Limit-Konzept vorbereiten: Redis/KV/CDN/WAF, trusted proxy headers, tenant/connector/token scopes.
4. Ersten echten externen Adapter spezifizieren und bauen: Webhook-v1 mit Schema, Allowlist, Auth-Ref, Retry/Fallback, Rate Limit, Audit.
5. Setup/Operator UX aktualisieren: ActionBridge als Connector erklären, nicht als CRM/Lead-Inbox.
6. Typecheck/Build-Struktur definieren oder dokumentieren, warum aktuell nicht ausführbar.
7. Staging Demo Tenant Flow ohne externe Risiken dokumentieren und smoke-testbar machen.
8. Sentinel/Nexus Review-Artefakte für MVP-GO aktualisieren und offene Production-Gates trennen.
9. Danach erst Schwarzwald-Agent Integration vorbereiten, wenn ActionBridge standalone DoD erfüllt.
10. Production hardening: monitoring, quarantine, retention/GDPR export, staging SSRF/DNS tests.
