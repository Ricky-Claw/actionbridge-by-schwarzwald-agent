const screens = [
  ['/actionbridge/pitch', 'Pitch', 'The core ActionBridge promise in one screen.'],
  ['/actionbridge/operator', 'Operator cockpit', 'Create and track customer setup links.'],
  ['/actionbridge/targets', 'Multi-URL targets', 'Register many tenant-scoped URLs and track connected/missing-script status.'],
  ['/actionbridge/connectors', 'Connector status', 'See draft, paired, signed-health connected, waiting-for-permissions, active, and paused states.'],
  ['/actionbridge/wizard', 'Setup wizard', 'Customer flow from website to safe capability.'],
  ['/actionbridge/permissions', 'Permission matrix', 'Allowed, approval-required, and blocked actions.'],
  ['/actionbridge/demo-tenant', 'Demo tenant', 'Controlled example business for recordings.'],
  ['/actionbridge/trust', 'Trust center', 'Security controls customers can understand.'],
  ['/actionbridge/audit-preview', 'Audit timeline', 'Visible proof of safe execution.'],
  ['/actionbridge/tool-preview', 'Tool preview', 'What an agent runtime receives.'],
  ['/actionbridge/failures', 'Failure states', 'Unsafe paths stop with clear reasons.'],
  ['/actionbridge/sales', 'Sales narrative', 'One-page commercial framing.'],
];

export default function ActionBridgeExperienceIndexPage() {
  return (
    <main className="min-h-screen bg-[#06110d] px-6 py-12 text-stone-100">
      <section className="mx-auto max-w-6xl space-y-8">
        <header className="rounded-[2rem] border border-emerald-300/20 bg-gradient-to-br from-emerald-950/80 to-black p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.35em] text-emerald-300">ActionBridge Experience Map</p>
          <h1 className="mt-4 text-5xl font-black tracking-tight">The MVP is a trust journey, not a pile of endpoints.</h1>
          <p className="mt-4 max-w-3xl text-stone-300">
            Start here for the standalone connector path: pitch, operator cockpit, customer setup,
            permissions, trust proof, audit, tool preview, failure states, and sales framing.
          </p>
        </header>
        <div className="grid gap-4 md:grid-cols-2">
          {screens.map(([href, title, body]) => (
            <a key={href} href={href} className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 transition hover:border-emerald-300/50 hover:bg-emerald-300/10">
              <h2 className="font-bold text-emerald-100">{title}</h2>
              <p className="mt-2 text-sm text-stone-300">{body}</p>
              <p className="mt-4 font-mono text-xs text-emerald-300">{href}</p>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
