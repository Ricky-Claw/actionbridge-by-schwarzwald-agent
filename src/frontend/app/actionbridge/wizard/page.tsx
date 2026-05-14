const steps = [
  ['1', 'Website prüfen', 'HTTPS origin, no private host, no userinfo, no broad target.'],
  ['2', 'Domain verifizieren', 'DNS TXT, meta tag, or .well-known challenge.'],
  ['3', 'Bridge installieren', 'Connected-only bridge.js with exact Origin handshake.'],
  ['4', 'Fähigkeiten freischalten', 'Read tools immediately; draft/write tools only with approval.'],
];

export default function ActionBridgeWizardPage() {
  return (
    <main className="min-h-screen bg-stone-950 px-6 py-12 text-stone-100">
      <section className="mx-auto max-w-5xl">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-lime-300">Customer Setup Wizard</p>
        <h1 className="mt-4 text-4xl font-black">Four steps from website to controlled agent capability.</h1>
        <div className="mt-10 grid gap-5 md:grid-cols-4">
          {steps.map(([n, title, body]) => <article key={n} className="rounded-[1.7rem] border border-lime-200/15 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-5"><div className="grid h-11 w-11 place-items-center rounded-full bg-lime-300 font-black text-stone-950">{n}</div><h2 className="mt-5 font-bold text-lime-100">{title}</h2><p className="mt-2 text-sm text-stone-300">{body}</p></article>)}
        </div>
      </section>
    </main>
  );
}
