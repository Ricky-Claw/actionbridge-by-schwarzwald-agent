const connectorCards = [
  {
    type: 'website',
    title: 'Website verbinden',
    body: 'Domain eintragen, Besitz verifizieren, Bridge-Script installieren und sichere Read-/Draft-Fähigkeiten freischalten.',
    fields: ['Website URL', 'Verifizierungsmethode', 'Erlaubte Aktionen'],
  },
  {
    type: 'webhook',
    title: 'Webhook-v1 verbinden',
    body: 'HTTPS Origin und relativen Endpoint-Pfad hinterlegen. HMAC bleibt server-owned; keine Secrets im Kundenformular.',
    fields: ['HTTPS Origin', 'Endpoint Path', 'Receiver Guide'],
  },
  {
    type: 'whatsapp_business',
    title: 'WhatsApp Business verbinden',
    body: 'Phone Number ID, WABA ID und Graph API Version eintragen. Live-Senden bleibt blockiert bis Meta/OAuth/Token-Gates bereit sind.',
    fields: ['Phone Number ID', 'WABA ID', 'Graph API Version'],
  },
];

const wizardSteps = [
  ['connector.choose', 'Connector auswählen', 'Website, Webhook oder WhatsApp Business.'],
  ['values.enter', 'Werte eintragen', 'Nur nicht-geheime Werte: IDs, Domain, Origin, Pfad.'],
  ['authorization.verify', 'Autorisierung prüfen', 'DNS, Meta, Bridge-Script, OAuth oder Operator-Prüfung.'],
  ['permissions.choose', 'Berechtigungen wählen', 'Klare Toggles statt Policy-Wand. Writes bleiben approval-gated.'],
  ['connection.test', 'Verbindung testen', 'Dry-run oder sicherer Smoke-Test mit redacted Ergebnis.'],
  ['connector.activate', 'Aktivieren', 'Erst wenn Status, Safety und Permission sauber sind.'],
];

const statuses = [
  ['draft', 'Entwurf', 'Noch nicht bereit. Kunde kann Werte ergänzen.'],
  ['waiting', 'Wartet', 'Verifizierung, Secret-Bootstrap oder Operator-Freigabe fehlt.'],
  ['connected', 'Verbunden', 'Connector ist geprüft und aktivierbar/aktiv.'],
  ['needs_attention', 'Aktion nötig', 'Fehler oder Sicherheitsstatus blockiert Aktivierung.'],
  ['paused', 'Pausiert', 'Kunde oder Operator hat Ausführung gestoppt.'],
];

export default function ActionBridgeWizardPage() {
  return (
    <main className="min-h-screen bg-[#090b09] px-4 py-8 text-stone-100 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-6xl rounded-[2rem] border border-emerald-300/15 bg-stone-950/80 p-5 shadow-2xl shadow-emerald-950/30 sm:p-8">
        <div className="flex flex-col gap-5 border-b border-white/10 pb-7 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-300">Customer Setup Wizard · ActionBridge Embedded Setup</p>
            <h1 className="mt-4 max-w-3xl text-4xl font-black tracking-tight text-white md:text-5xl">
              Ein Setup-Plugin, kein weiteres Dashboard.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-stone-300">
              Kunden verbinden Fähigkeiten in wenigen Schritten. Operator-Details, Secrets, Audit und Kill-Switch bleiben getrennt im Kontrollbereich.
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-100">
            API-ready: <code>embeddedSetup</code> aus <code>/setup-session</code> und <code>/connectors</code>
          </div>
        </div>

        <div className="mt-8 grid gap-3 lg:grid-cols-6">
          {wizardSteps.map(([id, title, body], index) => (
            <article key={id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-300 text-sm font-black text-stone-950">{index + 1}</span>
                <code className="text-[10px] text-stone-500">{id}</code>
              </div>
              <h2 className="mt-4 font-bold text-emerald-50">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-stone-400">{body}</p>
            </article>
          ))}
        </div>

        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {connectorCards.map((connector) => (
            <article key={connector.type} className="rounded-[1.5rem] border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.03] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">{connector.type}</p>
                  <h2 className="mt-3 text-xl font-black text-white">{connector.title}</h2>
                </div>
                <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-100">network off</span>
              </div>
              <p className="mt-4 min-h-24 text-sm leading-6 text-stone-300">{connector.body}</p>
              <div className="mt-5 space-y-2">
                {connector.fields.map((field) => (
                  <div key={field} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-stone-300">
                    {field}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>

        <div className="mt-10 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-300">Customer View</p>
            <h2 className="mt-3 text-2xl font-black">Nur einfache Zustände.</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {statuses.map(([id, title, body]) => (
                <div key={id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <code className="text-xs text-stone-500">{id}</code>
                  <h3 className="mt-2 font-bold text-white">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-stone-400">{body}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[1.5rem] border border-rose-300/15 bg-rose-950/20 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-rose-200">Operator-only</p>
            <h2 className="mt-3 text-2xl font-black">Nicht im Kunden-Wizard.</h2>
            <ul className="mt-5 space-y-3 text-sm leading-6 text-stone-300">
              <li>• Raw Secrets, Secret Refs, Token Digests und Idempotency Keys</li>
              <li>• Service-role Details, interne Audit-Tabellen und rohe Error-Kontexte</li>
              <li>• Network Execution Flags ohne Safety-/Permission-Gates</li>
              <li>• Kill Switch, Quarantine, Retention und High/Critical Error Review</li>
            </ul>
          </section>
        </div>
      </section>
    </main>
  );
}
