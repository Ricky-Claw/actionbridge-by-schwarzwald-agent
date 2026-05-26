'use client';

import { useEffect, useMemo, useState } from 'react';

type ConnectorView = {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  endpointPath: string;
  webhookSigningMode: string;
  webhookSecretRefDigest: string | null;
  permissionStatus: string;
  safetyStatus: string;
};

type RotationResult = {
  status?: string;
  error?: string;
  currentSecretRefDigest?: string | null;
  expectedCurrentDigest?: string | null;
  resultSummary?: Record<string, unknown>;
  connector?: { id: string; webhookSigningMode: string; updatedAt: string };
};

const SECRET_REF_HELP = 'actionbridge:webhook-signing:<server-owned-ref>';

export default function ActionBridgeWebhookSecretRotationClient() {
  const [connectors, setConnectors] = useState<ConnectorView[]>([]);
  const [connectorId, setConnectorId] = useState('');
  const [nextSecretRef, setNextSecretRef] = useState('');
  const [expectedCurrentDigest, setExpectedCurrentDigest] = useState('');
  const [result, setResult] = useState<RotationResult | null>(null);
  const [status, setStatus] = useState('Loading webhook connectors…');
  const [busy, setBusy] = useState(false);

  const selectedConnector = useMemo(
    () => connectors.find((connector) => connector.id === connectorId) || null,
    [connectors, connectorId],
  );

  async function loadConnectors() {
    setBusy(true);
    try {
      const response = await fetch('/api/actionbridge/connectors', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(typeof body.error === 'string' ? body.error : 'ACTIONBRIDGE_CONNECTORS_LIST_FAILED');
        setConnectors([]);
        return;
      }
      const webhookConnectors = Array.isArray(body.connectors)
        ? body.connectors.filter((connector: ConnectorView) => connector.type === 'webhook')
        : [];
      setConnectors(webhookConnectors);
      setConnectorId((current) => current || webhookConnectors[0]?.id || '');
      setStatus(webhookConnectors.length ? 'Webhook connectors loaded. Run dry-run before apply.' : 'No webhook connectors available for rotation.');
    } catch {
      setStatus('Could not load webhook connectors.');
    } finally {
      setBusy(false);
    }
  }

  async function rotate(dryRun: boolean) {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch('/api/actionbridge/ops/webhook-secret-rotation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(dryRun ? {} : { 'x-actionbridge-rotation-confirm': 'apply-webhook-signing-ref' }),
        },
        body: JSON.stringify({
          connectorId,
          nextSecretRef,
          expectedCurrentDigest: expectedCurrentDigest.trim() || undefined,
          dryRun,
        }),
      });
      const body = await response.json().catch(() => ({}));
      setResult(body);
      if (!response.ok) {
        setStatus(typeof body.error === 'string' ? body.error : 'ACTIONBRIDGE_WEBHOOK_ROTATION_FAILED');
        return;
      }
      setStatus(dryRun ? 'Dry-run passed. Receiver smoke test and monitoring are required before apply.' : 'Webhook signing ref applied and audited.');
      if (!dryRun) await loadConnectors();
    } catch {
      setStatus('Webhook signing rotation failed before completion.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void loadConnectors(); }, []);

  return (
    <section className="rounded-3xl border border-cyan-300/20 bg-cyan-400/10 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-200">Sentinel control</p>
          <h2 className="mt-2 text-2xl font-black text-white">Webhook signing secret rotation</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
            Operator UI for the existing dry-run-first rotation route. It never displays raw stored secret refs; it shows only digests returned by server-owned APIs.
          </p>
        </div>
        <button disabled={busy} onClick={loadConnectors} className="rounded-xl bg-white px-3 py-2 text-sm font-bold text-slate-950 disabled:opacity-60">Refresh connectors</button>
      </div>

      <p className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-slate-200">{status}</p>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="space-y-2">
          <span className="text-sm font-semibold text-slate-200">Webhook connector</span>
          <select value={connectorId} onChange={(event) => setConnectorId(event.target.value)} className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100">
            {connectors.length === 0 ? <option value="">No webhook connectors</option> : connectors.map((connector) => (
              <option key={connector.id} value={connector.id}>{connector.name} · {connector.webhookSecretRefDigest || 'no current digest'}</option>
            ))}
          </select>
        </label>
        <label className="space-y-2">
          <span className="text-sm font-semibold text-slate-200">Expected current digest (optional CAS)</span>
          <input value={expectedCurrentDigest} onChange={(event) => setExpectedCurrentDigest(event.target.value)} placeholder="sha256:0123456789abcdef" className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" />
        </label>
        <label className="space-y-2 md:col-span-2">
          <span className="text-sm font-semibold text-slate-200">Next server-owned secret ref</span>
          <input value={nextSecretRef} onChange={(event) => setNextSecretRef(event.target.value)} placeholder={SECRET_REF_HELP} className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" />
        </label>
      </div>

      {selectedConnector && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-slate-300">
          <p><strong className="text-slate-100">Current digest:</strong> {selectedConnector.webhookSecretRefDigest || 'none'}</p>
          <p><strong className="text-slate-100">Signing mode:</strong> {selectedConnector.webhookSigningMode}</p>
          <p><strong className="text-slate-100">Target:</strong> {selectedConnector.baseUrl}{selectedConnector.endpointPath}</p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <button disabled={busy || !connectorId || !nextSecretRef} onClick={() => rotate(true)} className="rounded-xl bg-cyan-200 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-60">Dry-run rotation</button>
        <button disabled={busy || !connectorId || !nextSecretRef} onClick={() => rotate(false)} className="rounded-xl bg-red-300 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-60">Apply after receiver smoke</button>
      </div>

      <p className="mt-4 text-xs leading-5 text-amber-100">
        Production rule: apply only after the receiver accepts the new secret and after dry-run returns monitoring markers. Rollback is rerun with the previous server-owned ref.
      </p>

      {result && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4">
          <h3 className="font-bold text-cyan-100">Rotation response</h3>
          <pre className="mt-3 max-h-80 overflow-auto text-xs text-slate-300">{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </section>
  );
}
