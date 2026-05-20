import ActionBridgeQuarantineOpsClient from './ActionBridgeQuarantineOpsClient';

const controls = [
  ['Active pauses', 'Operators can see connector-level durable quarantine before another execution attempts network delivery.'],
  ['Manual pause', 'A connector can be paused by id with a bounded redacted operator reason. No secrets or destination credentials are accepted.'],
  ['Resolve only', 'The UI supports only active → resolved release; new execution still needs normal approval, policy, and connector gates.'],
  ['Audit trail', 'Pause and resolve actions are written through /api/actionbridge/quarantine audit events.'],
];

export default function ActionBridgeQuarantinePage() {
  return (
    <main className="min-h-screen bg-[#100f13] px-6 py-12 text-stone-100">
      <section className="mx-auto max-w-5xl">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-fuchsia-300">Connector Quarantine · Operator Control</p>
        <h1 className="mt-4 text-4xl font-black">Pause unsafe connectors before they can deliver again.</h1>
        <p className="mt-4 max-w-3xl text-stone-300">
          This operator view consumes <code className="rounded bg-black/30 px-1">/api/actionbridge/quarantine</code>. It lists owner-scoped, redacted durable connector pauses and lets operators pause or resolve a connector without exposing raw webhook URLs, secrets, tokens, or idempotency keys.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {controls.map(([title, body]) => (
            <article key={title} className="rounded-3xl border border-fuchsia-200/15 bg-fuchsia-300/10 p-5">
              <h2 className="font-bold text-fuchsia-100">{title}</h2>
              <p className="mt-2 text-sm text-stone-300">{body}</p>
            </article>
          ))}
        </div>

        <ActionBridgeQuarantineOpsClient />

        <div className="mt-8 rounded-3xl border border-red-300/20 bg-red-500/10 p-5">
          <h2 className="font-bold text-red-100">Production rule</h2>
          <p className="mt-2 text-sm text-stone-300">
            Resolving quarantine only removes the durable pause. It must not bypass approval, connector verification, rate limits, kill switches, webhook signing, DNS pinning, or Sentinel rollout blockers.
          </p>
        </div>
      </section>
    </main>
  );
}
