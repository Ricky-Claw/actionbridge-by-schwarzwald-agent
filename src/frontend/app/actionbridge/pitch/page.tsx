const pillars = [
  ['Verify', 'Customer proves control with DNS, meta tag, or .well-known.'],
  ['Bridge', 'A tiny connected-only script confirms the approved origin.'],
  ['Translate', 'ActionBridge turns allowed capabilities into agent-language tools.'],
  ['Control', 'Approval, audit, redaction, rate limits, and kill switches stay between agent and business system.'],
];

export default function ActionBridgePitchPage() {
  return (
    <main className="min-h-screen bg-[#07130f] text-stone-100">
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="rounded-[2rem] border border-emerald-300/20 bg-gradient-to-br from-emerald-950 via-[#0b1712] to-black p-8 shadow-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.35em] text-emerald-300">ActionBridge Connector Layer</p>
          <h1 className="mt-5 max-w-4xl text-5xl font-black tracking-tight">Every approved website becomes a safe agent tool.</h1>
          <p className="mt-5 max-w-3xl text-lg text-stone-300">ActionBridge is the permissioned connector layer: customers verify their site, install a lightweight bridge when needed, choose allowed actions, and an agent runtime receives safe tools instead of raw access.</p>
          <div className="mt-10 grid gap-4 md:grid-cols-4">
            {pillars.map(([title, body]) => <div key={title} className="rounded-3xl border border-white/10 bg-white/[0.04] p-5"><h2 className="font-bold text-emerald-200">{title}</h2><p className="mt-2 text-sm text-stone-300">{body}</p></div>)}
          </div>
          <p className="mt-8 rounded-2xl bg-amber-300/10 p-4 text-sm text-amber-100">MVP promise: no login bypass, no hidden scraping, no destructive writes, no broad network execution by default.</p>
        </div>
      </section>
    </main>
  );
}
