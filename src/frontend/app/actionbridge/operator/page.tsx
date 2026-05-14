export const dynamic = 'force-dynamic';

export default function ActionBridgeOperatorPage() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <section className="mx-auto max-w-5xl space-y-8">
        <header className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">Schwarzwald-Agent Operator</p>
          <h1 className="text-4xl font-bold tracking-tight">Create an ActionBridge customer setup link.</h1>
          <p className="max-w-3xl text-slate-300">
            Minimal MVP cockpit for Ricky/operator: create a scoped setup link, hand it to the customer,
            then watch verification, bridge connection, capabilities, agent tools, dry-run execution, and audit state.
          </p>
        </header>

        <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
          <h2 className="text-xl font-semibold">Setup link generator</h2>
          <form className="mt-5 grid gap-4 md:grid-cols-[1fr_auto]" action="/api/actionbridge/setup-links" method="post">
            <label className="space-y-2">
              <span className="text-sm text-slate-300">Customer origin</span>
              <input
                name="targetOrigin"
                type="url"
                required
                placeholder="https://customer.example"
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none focus:border-cyan-300"
              />
            </label>
            <button className="self-end rounded-2xl bg-cyan-300 px-5 py-3 font-semibold text-slate-950" type="submit">
              Create setup link
            </button>
          </form>
          <p className="mt-4 text-sm text-amber-100">
            Production note: the raw setup token may be shown once after creation only. Stored state must stay digest-only.
          </p>
        </section>

        <section className="grid gap-5 md:grid-cols-2">
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="font-semibold text-cyan-200">MVP status ladder</h2>
            <ol className="mt-4 space-y-2 text-sm text-slate-300">
              <li>1. Setup-Link pending/opened/completed/revoked/expired</li>
              <li>2. Domain-Verifikation method and trust level</li>
              <li>3. Bridge-Handshake connected_only</li>
              <li>4. Capability rules enabled/disabled</li>
              <li>5. Agent Tool-Catalog catalog_only</li>
              <li>6. Dry-run Execution and approval decision</li>
              <li>7. Redacted audit event trail</li>
            </ol>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="font-semibold text-cyan-200">Operator no-go checks</h2>
            <ul className="mt-4 space-y-2 text-sm text-slate-300">
              <li>• No live third-party target without written scope.</li>
              <li>• No broad network execution from setup flow.</li>
              <li>• No write/transactional/destructive tools in v1 demo.</li>
              <li>• No raw secrets, token digests, service-role data, or private tenant fields.</li>
              <li>• Draft actions remain approval-required.</li>
            </ul>
          </div>
        </section>
      </section>
    </main>
  );
}
