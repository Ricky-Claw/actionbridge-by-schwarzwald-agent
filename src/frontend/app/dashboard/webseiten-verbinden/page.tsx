export const dynamic = 'force-dynamic';

import SchwarzwaldWebsitesActionBridgeClient from './SchwarzwaldWebsitesActionBridgeClient';

export default function DashboardWebseitenVerbindenPage() {
  return (
    <main className="min-h-screen bg-[#06110d] px-4 py-6 text-stone-100 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-[2rem] border border-emerald-300/20 bg-gradient-to-br from-emerald-950/80 via-slate-950 to-black p-6 shadow-2xl shadow-emerald-950/30 sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.35em] text-emerald-300">Schwarzwald-Agent · Webseiten verbinden</p>
              <h1 className="mt-4 max-w-4xl text-4xl font-black tracking-tight text-white md:text-5xl">
                ActionBridge eingebettet im Kunden-Dashboard.
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-6 text-stone-300">
                Dieses Modul ist das Kontrollzentrum für Domains, Setup-Links, Bridge-Script, Connector-Status und sichere Freigaben — ohne ActionBridge als separate Insel zu öffnen.
              </p>
            </div>
            <a href="/dashboard" className="rounded-2xl border border-white/15 px-4 py-2 text-sm font-bold text-stone-100 hover:border-emerald-300/50">Zurück zum Dashboard</a>
          </div>
        </header>

        <SchwarzwaldWebsitesActionBridgeClient />
      </section>
    </main>
  );
}
