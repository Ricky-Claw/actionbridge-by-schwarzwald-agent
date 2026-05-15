const failureStates = [
  ['Setup', 'Invalid, expired, or closed setup links are logged with redacted context so operators can issue a new link safely.'],
  ['Verification', 'Domain verification failures show method, status, and safe evidence without exposing tokens or secrets.'],
  ['Approval', 'Rejected, expired, reused, or non-executable approvals are visible as approval errors.'],
  ['Execution', 'Failed executions carry an error code, severity, execution id, and redacted safe result.'],
  ['Webhook', 'Webhook delivery failures, throttles, and quarantine signals are visible without raw destination secrets.'],
  ['System', 'Service-client, persistence, and unexpected platform failures can be separated from customer mistakes.'],
];

export default function ActionBridgeFailuresPage() {
  return (
    <main className="min-h-screen bg-[#130f08] px-6 py-12 text-stone-100">
      <section className="mx-auto max-w-5xl">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-amber-300">Failure-State UX · Error Log & Failure Monitor</p>
        <h1 className="mt-4 text-4xl font-black">If ActionBridge blocks or fails, operators can see why.</h1>
        <p className="mt-4 max-w-3xl text-stone-300">
          The failure monitor is backed by <code className="rounded bg-black/30 px-1">/api/actionbridge/errors</code>. It lists only redacted, owner-scoped error events: category, severity, error code, status, linked connector/execution/approval ids, and safe context.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {failureStates.map(([title, body]) => (
            <article key={title} className="rounded-3xl border border-amber-200/15 bg-amber-300/10 p-5">
              <h2 className="font-bold text-amber-100">{title}</h2>
              <p className="mt-2 text-sm text-stone-300">{body}</p>
            </article>
          ))}
        </div>
        <div className="mt-8 rounded-3xl border border-red-300/20 bg-red-500/10 p-5">
          <h2 className="font-bold text-red-100">Production rule</h2>
          <p className="mt-2 text-sm text-stone-300">
            High/Critical errors must stop rollout decisions until Sentinel reviews the evidence. Error logs must never include raw tokens, idempotency keys, connector secrets, or unredacted personal data.
          </p>
        </div>
      </section>
    </main>
  );
}
