export const dynamic = 'force-dynamic';

import ActionBridgeSetupSessionClient from './ActionBridgeSetupSessionClient';

type SearchParams = Promise<{ token?: string }>;

export default async function ActionBridgeCustomerSetupPage({ searchParams }: { searchParams: SearchParams }) {
  const { token = '' } = await searchParams;

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
      <section className="mx-auto max-w-5xl space-y-8">
        <header className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-emerald-300">ActionBridge Setup</p>
          <h1 className="text-4xl font-bold tracking-tight">Connect your approved website safely.</h1>
          <p className="max-w-3xl text-neutral-300">
            Verify ownership, install the connected-only bridge script, then choose exactly which safe capabilities
            Schwarzwald-Agent may use. No scraping, no credentials, no automatic writes.
          </p>
        </header>

        <ActionBridgeSetupSessionClient token={token} />

        <p className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
          Security rule: the UI must never display token digests, service-role data, raw connector internals,
          idempotency keys, secrets, or private tenant fields.
        </p>

        <div className="grid gap-5 md:grid-cols-3">
          <section className="rounded-3xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="font-semibold text-emerald-200">2. Domain verification</h2>
            <p className="mt-2 text-sm text-neutral-300">Choose DNS TXT, meta tag, or .well-known verification.</p>
            <ul className="mt-4 space-y-2 text-sm text-neutral-400">
              <li>• HTTPS only</li>
              <li>• DNS/IP guard required</li>
              <li>• Human attestation cannot unlock broad execution</li>
            </ul>
          </section>

          <section className="rounded-3xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="font-semibold text-emerald-200">3. Bridge install</h2>
            <p className="mt-2 text-sm text-neutral-300">Install one connected-only script on the approved origin.</p>
            <p className="mt-4 rounded-2xl bg-neutral-950 p-3 text-xs text-neutral-300">
              The live API session above returns the exact bridge snippet with the setup token masked in the UI.
            </p>
          </section>

          <section className="rounded-3xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="font-semibold text-emerald-200">4. Capabilities</h2>
            <p className="mt-2 text-sm text-neutral-300">Enable only safe read/draft capabilities for the demo.</p>
            <ul className="mt-4 space-y-2 text-sm text-neutral-400">
              <li>• site.knowledge.read</li>
              <li>• lead.prepare_draft needs approval</li>
              <li>• appointment.request.prepare_draft needs approval</li>
            </ul>
          </section>
        </div>

        <section className="rounded-3xl border border-neutral-800 bg-neutral-900/70 p-6">
          <h2 className="text-xl font-semibold">Demo-ready control chain</h2>
          <ol className="mt-4 grid gap-3 text-sm text-neutral-300 md:grid-cols-2">
            <li>Setup-Link created with digest-only storage.</li>
            <li>Domain-Verifikation activates trust but not broad execution.</li>
            <li>Bridge-Handshake requires exact Origin match.</li>
            <li>Tool-Catalog exposes only safe agent fields.</li>
            <li>Dry-run Execution proves approval boundaries.</li>
            <li>Audit and kill switch stay visible throughout the demo.</li>
          </ol>
        </section>
      </section>
    </main>
  );
}
