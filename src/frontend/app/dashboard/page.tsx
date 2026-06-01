const dashboardCards = [
  {
    href: '/dashboard/webseiten-verbinden',
    title: 'Webseiten verbinden',
    body: 'ActionBridge läuft hier eingebettet: Domains verbinden, Setup-Link senden, Script prüfen, Connector-Status sehen.',
    badge: 'ActionBridge',
  },
  {
    href: '/actionbridge/trust',
    title: 'Trust Center',
    body: 'Sicherheitslogik, Freigaben, Audit und Kill-Switches verständlich erklärt.',
    badge: 'Kontrollen',
  },
  {
    href: '/actionbridge/failures',
    title: 'Fehler & Blocker',
    body: 'Fail-closed Zustände, Quarantine und rote Linien für Operator sichtbar halten.',
    badge: 'Sentinel',
  },
];

export default function SchwarzwaldDashboardPage() {
  return (
    <main className="min-h-screen bg-[#050b08] px-5 py-8 text-stone-100 sm:px-8">
      <section className="mx-auto max-w-7xl space-y-8">
        <header className="rounded-[2rem] border border-emerald-300/20 bg-gradient-to-br from-emerald-950/80 via-slate-950 to-black p-8 shadow-2xl shadow-emerald-950/30">
          <p className="text-xs font-black uppercase tracking-[0.35em] text-emerald-300">Schwarzwald-Agent Kontrollzentrum</p>
          <h1 className="mt-4 max-w-4xl text-4xl font-black tracking-tight text-white md:text-6xl">
            Eine Zentrale für Kunden-Webseiten, Agenten und sichere Aktionen.
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-stone-300">
            ActionBridge ist nicht mehr als separates Kontrollzentrum gedacht. Die Bridge wird als Modul im Dashboard geführt,
            damit Operator oder Kunde die Verbindung direkt dort steuern, wo auch der Agent lebt.
          </p>
        </header>

        <section className="grid gap-5 md:grid-cols-3">
          {dashboardCards.map((card) => (
            <a key={card.href} href={card.href} className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 transition hover:border-emerald-300/50 hover:bg-emerald-300/10">
              <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-xs font-bold text-emerald-100">{card.badge}</span>
              <h2 className="mt-4 text-xl font-black text-white">{card.title}</h2>
              <p className="mt-2 text-sm leading-6 text-stone-300">{card.body}</p>
              <p className="mt-4 font-mono text-xs text-emerald-300">{card.href}</p>
            </a>
          ))}
        </section>
      </section>
    </main>
  );
}
