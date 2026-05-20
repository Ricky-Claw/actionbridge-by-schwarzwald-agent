'use client';

import { useEffect, useMemo, useState } from 'react';

type ConnectorView = {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  safetyStatus: string;
  permissionStatus: string;
};

type QuarantineView = {
  id: string;
  connectorId: string;
  status: 'active' | 'resolved' | string;
  reasonCode: string;
  message: string;
  redactedContext: Record<string, unknown>;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

const statusTone: Record<string, string> = {
  active: 'border-red-300/30 bg-red-500/10 text-red-100',
  resolved: 'border-emerald-300/30 bg-emerald-500/10 text-emerald-100',
};

export default function ActionBridgeQuarantineOpsClient() {
  const [quarantines, setQuarantines] = useState<QuarantineView[]>([]);
  const [connectors, setConnectors] = useState<ConnectorView[]>([]);
  const [selectedConnectorId, setSelectedConnectorId] = useState('');
  const [message, setMessage] = useState('Connector paused for operator review.');
  const [status, setStatus] = useState('Loading owner-scoped quarantine state…');
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState(false);

  const connectorById = useMemo(() => new Map(connectors.map((connector) => [connector.id, connector])), [connectors]);

  async function loadQuarantines(nextShowResolved = showResolved) {
    setBusy(true);
    try {
      const response = await fetch(`/api/actionbridge/quarantine${nextShowResolved ? '' : '?status=active'}`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(typeof body.error === 'string' ? body.error : 'ACTIONBRIDGE_CONNECTOR_QUARANTINE_LIST_FAILED');
        setQuarantines([]);
        return;
      }
      setQuarantines(Array.isArray(body.quarantines) ? body.quarantines : []);
      setStatus(nextShowResolved ? 'Loaded active and resolved redacted connector quarantine records.' : 'Loaded active redacted connector quarantine records.');
    } catch {
      setStatus('Could not load quarantine state from /api/actionbridge/quarantine.');
    } finally {
      setBusy(false);
    }
  }

  async function loadConnectors() {
    try {
      const response = await fetch('/api/actionbridge/connectors', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return;
      setConnectors(Array.isArray(body.connectors) ? body.connectors : []);
    } catch {
      // Quarantine list is still useful when connector summaries cannot be loaded.
    }
  }

  async function pauseConnector() {
    const connectorId = selectedConnectorId.trim();
    if (!connectorId) {
      setStatus('Choose a connector or paste a connector id before pausing.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/actionbridge/quarantine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectorId, reasonCode: 'operator_pause', message }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(typeof body.error === 'string' ? body.error : 'ACTIONBRIDGE_CONNECTOR_QUARANTINE_CREATE_FAILED');
        return;
      }
      setStatus('Connector paused by durable operator quarantine.');
      await loadQuarantines(false);
    } catch {
      setStatus('Connector quarantine pause failed before completion.');
    } finally {
      setBusy(false);
    }
  }

  async function resolveQuarantine(quarantineId: string) {
    setBusy(true);
    try {
      const response = await fetch('/api/actionbridge/quarantine', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quarantineId, status: 'resolved' }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(typeof body.error === 'string' ? body.error : 'ACTIONBRIDGE_CONNECTOR_QUARANTINE_UPDATE_FAILED');
        return;
      }
      setQuarantines((current) => current.map((entry) => entry.id === quarantineId ? body.quarantine : entry));
      setStatus('Connector quarantine resolved. Normal execution gates still apply.');
    } catch {
      setStatus('Connector quarantine resolve failed before completion.');
    } finally {
      setBusy(false);
    }
  }

  function toggleResolved() {
    const next = !showResolved;
    setShowResolved(next);
    void loadQuarantines(next);
  }

  useEffect(() => { void loadConnectors(); void loadQuarantines(false); }, []);

  return (
    <section className="mt-8 rounded-3xl border border-fuchsia-300/20 bg-fuchsia-400/10 p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-fuchsia-200">Operator Quarantine Ops</p>
          <h2 className="mt-2 text-2xl font-black text-white">Durable connector pause state</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-300">
            Active quarantine blocks webhook-v1 delivery before signing and network execution. This UI only sends connector ids, bounded messages, and resolve commands.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button disabled={busy} onClick={() => loadQuarantines(showResolved)} className="rounded-xl bg-white px-3 py-2 text-sm font-bold text-stone-950 disabled:opacity-60">Refresh</button>
          <button disabled={busy} onClick={toggleResolved} className="rounded-xl bg-fuchsia-200 px-3 py-2 text-sm font-bold text-stone-950 disabled:opacity-60">{showResolved ? 'Active only' : 'Include resolved'}</button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 md:grid-cols-[1fr_2fr_auto]">
        <select value={selectedConnectorId} onChange={(event) => setSelectedConnectorId(event.target.value)} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white">
          <option value="">Select connector…</option>
          {connectors.map((connector) => <option key={connector.id} value={connector.id}>{connector.name} · {connector.type}</option>)}
        </select>
        <input value={message} maxLength={240} onChange={(event) => setMessage(event.target.value)} placeholder="Operator pause reason" className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-stone-500" />
        <button disabled={busy || !selectedConnectorId.trim()} onClick={pauseConnector} className="rounded-xl bg-red-300 px-3 py-2 text-sm font-bold text-stone-950 disabled:opacity-60">Pause connector</button>
      </div>

      <p className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-stone-200">{status}</p>

      <div className="mt-5 space-y-3">
        {quarantines.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-stone-400">No quarantine records loaded, or none exist for this operator.</div>
        ) : quarantines.map((entry) => {
          const connector = connectorById.get(entry.connectorId);
          return (
            <article key={entry.id} className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap gap-2 text-xs font-bold uppercase tracking-[0.12em]">
                    <span className={`rounded-full border px-2 py-1 ${statusTone[entry.status] || 'border-white/20 text-stone-200'}`}>{entry.status}</span>
                    <span className="rounded-full border border-white/10 px-2 py-1 text-stone-300">{entry.reasonCode}</span>
                    <span className="rounded-full border border-white/10 px-2 py-1 text-stone-300">failures: {entry.failureCount}</span>
                  </div>
                  <h3 className="mt-3 font-bold text-white">{connector ? `${connector.name} · ${connector.type}` : entry.connectorId}</h3>
                  <p className="mt-1 text-sm text-stone-300">{entry.message}</p>
                  <p className="mt-2 text-xs text-stone-500">Updated: {entry.updatedAt}{entry.resolvedAt ? ` · Resolved: ${entry.resolvedAt}` : ''}</p>
                </div>
                {entry.status === 'active' && <button disabled={busy} onClick={() => resolveQuarantine(entry.id)} className="rounded-xl border border-emerald-200/30 px-3 py-2 text-xs font-bold text-emerald-100 disabled:opacity-60">Resolve quarantine</button>}
              </div>
              <details className="mt-3 text-xs text-stone-400">
                <summary className="cursor-pointer text-stone-300">Show redacted context</summary>
                <pre className="mt-2 overflow-auto rounded-xl bg-black/30 p-3">{JSON.stringify(entry.redactedContext || {}, null, 2)}</pre>
              </details>
            </article>
          );
        })}
      </div>
    </section>
  );
}
