'use client';

import { useEffect, useMemo, useState } from 'react';

type ConnectorView = {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  capabilities: string[];
  networkExecutionEnabled: boolean;
  safetyStatus: 'untested' | 'pass' | 'fail' | string;
  permissionStatus: 'draft' | 'active' | 'paused' | 'revoked' | string;
  webhookSigningMode?: string;
  webhookSecretRefDigest?: string | null;
  embeddedSetup?: { status?: string; customerLabel?: string; operatorLabel?: string };
  backendBridge?: { installMode?: string; requiredControls?: string[] };
  updatedAt?: string;
};

const typeLabel: Record<string, string> = {
  website: 'Website Script',
  webhook: 'Webhook-v1',
  whatsapp_business: 'WhatsApp Business',
  backend_bridge: 'WordPress / Backend Bridge',
  http: 'HTTP Connector',
};

function bridgeStage(connector: ConnectorView) {
  if (connector.permissionStatus === 'revoked') return { label: 'widerrufen', tone: 'border-red-300/40 bg-red-400/10 text-red-100', detail: 'Connector wurde widerrufen.' };
  if (connector.permissionStatus === 'paused') return { label: 'pausiert', tone: 'border-amber-300/40 bg-amber-400/10 text-amber-100', detail: 'Kill switch/Quarantine aktiv oder manuell pausiert.' };
  if (connector.safetyStatus === 'fail') return { label: 'fehlgeschlagen', tone: 'border-red-300/40 bg-red-400/10 text-red-100', detail: 'Safety/Health Check ist fehlgeschlagen.' };
  if (connector.type === 'backend_bridge' && connector.safetyStatus === 'pass' && connector.permissionStatus === 'draft') {
    return { label: 'verbunden · wartet auf Freigabe', tone: 'border-emerald-300/40 bg-emerald-400/10 text-emerald-100', detail: 'Signed Health wurde bestätigt. Actions bleiben aus, bis Permissions aktiviert sind.' };
  }
  if (connector.safetyStatus === 'pass' && connector.permissionStatus === 'active') {
    return { label: connector.networkExecutionEnabled ? 'aktiv mit Execution' : 'aktiv · Execution aus', tone: 'border-cyan-300/40 bg-cyan-400/10 text-cyan-100', detail: 'Connector ist freigegeben. Network Execution wird separat kontrolliert.' };
  }
  if (connector.type === 'backend_bridge' && connector.permissionStatus === 'draft') {
    return { label: 'Pairing nötig', tone: 'border-amber-300/40 bg-amber-400/10 text-amber-100', detail: 'Pairing-Code im Plugin/SDK einfügen. Danach sendet die Bridge Signed Health.' };
  }
  return { label: 'Draft', tone: 'border-slate-300/20 bg-white/5 text-slate-200', detail: 'Connector ist angelegt, aber noch nicht verifiziert/freigegeben.' };
}

function safeCapabilities(capabilities: string[]) {
  return capabilities.filter((item) => !/secret|token|password|key/i.test(item)).slice(0, 8);
}

export default function ActionBridgeConnectorsClient() {
  const [connectors, setConnectors] = useState<ConnectorView[]>([]);
  const [status, setStatus] = useState('Connector Status noch nicht geladen.');
  const [busy, setBusy] = useState(false);
  const [rotationDrafts, setRotationDrafts] = useState<Record<string, { nextSecretRef: string; apply: boolean }>>({});

  const summary = useMemo(() => {
    const backendConnected = connectors.filter((connector) => connector.type === 'backend_bridge' && connector.safetyStatus === 'pass').length;
    const active = connectors.filter((connector) => connector.permissionStatus === 'active').length;
    const blocked = connectors.filter((connector) => connector.permissionStatus === 'paused' || connector.permissionStatus === 'revoked' || connector.safetyStatus === 'fail').length;
    return { backendConnected, active, blocked, total: connectors.length };
  }, [connectors]);

  async function loadConnectors() {
    setBusy(true);
    setStatus('Connectoren werden geladen …');
    try {
      const response = await fetch('/api/actionbridge/connectors', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setConnectors([]);
        setStatus(typeof body.error === 'string' ? body.error : 'ACTIONBRIDGE_CONNECTORS_LIST_FAILED');
        return;
      }
      setConnectors(Array.isArray(body.connectors) ? body.connectors : []);
      setStatus(`${body.connectors?.length || 0} Connector(en) geladen.`);
    } catch {
      setConnectors([]);
      setStatus('Connector Status konnte nicht geladen werden.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void loadConnectors(); }, []);

  function updateRotationDraft(connectorId: string, patch: Partial<{ nextSecretRef: string; apply: boolean }>) {
    setRotationDrafts((current) => {
      const existing = current[connectorId];
      return {
        ...current,
        [connectorId]: {
          nextSecretRef: patch.nextSecretRef ?? existing?.nextSecretRef ?? '',
          apply: patch.apply ?? existing?.apply ?? false,
        },
      };
    });
  }

  async function rotateWebhookSecret(connector: ConnectorView) {
    const draft = rotationDrafts[connector.id] || { nextSecretRef: '', apply: false };
    setBusy(true);
    setStatus(draft.apply ? 'Webhook Signing Ref wird nach Dry-Run-Gate rotiert …' : 'Webhook Signing Ref Dry-Run läuft …');
    try {
      const response = await fetch('/api/actionbridge/ops/webhook-secret-rotation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(draft.apply ? { 'x-actionbridge-rotation-confirm': 'apply-webhook-signing-ref' } : {}),
        },
        body: JSON.stringify({
          connectorId: connector.id,
          nextSecretRef: draft.nextSecretRef,
          expectedCurrentDigest: connector.webhookSecretRefDigest || undefined,
          dryRun: !draft.apply,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(typeof body.error === 'string' ? body.error : 'ACTIONBRIDGE_WEBHOOK_ROTATION_FAILED');
        return;
      }
      setStatus(draft.apply ? 'Webhook Signing Ref rotiert. Smoke Delivery + Alerts prüfen.' : 'Dry-Run OK. Nur mit bewusster Apply-Bestätigung rotieren.');
      if (draft.apply) await loadConnectors();
    } catch {
      setStatus('Webhook Signing Rotation konnte nicht ausgeführt werden.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#080f0b] px-6 py-10 text-stone-100">
      <section className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-[2rem] border border-emerald-300/20 bg-gradient-to-br from-emerald-950/70 to-black p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-300">ActionBridge Connector Status</p>
          <h1 className="mt-4 text-4xl font-black tracking-tight">Verbinden soll sich für Kunden eindeutig anfühlen.</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-300">
            Diese Ansicht trennt bewusst: angelegt, Pairing nötig, Signed Health verbunden, wartet auf Permissions, aktiv, pausiert. Keine Secrets, keine versteckte Execution.
          </p>
        </header>

        <section className="grid gap-3 md:grid-cols-4">
          {[
            ['Gesamt', summary.total],
            ['Backend verbunden', summary.backendConnected],
            ['Aktiv', summary.active],
            ['Blockiert', summary.blocked],
          ].map(([label, value]) => (
            <article key={label} className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-stone-500">{label}</p>
              <p className="mt-2 text-3xl font-black text-emerald-100">{value}</p>
            </article>
          ))}
        </section>

        <section className="rounded-3xl border border-white/10 bg-black/30 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-stone-300">{status}</p>
            <div className="flex flex-wrap gap-3">
              <a href="/actionbridge/wizard" className="rounded-2xl bg-emerald-300 px-4 py-2 text-sm font-black text-stone-950">Neuen Connector verbinden</a>
              <button type="button" disabled={busy} onClick={loadConnectors} className="rounded-2xl border border-white/15 px-4 py-2 text-sm font-bold disabled:opacity-60">Refresh</button>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          {connectors.map((connector) => {
            const stage = bridgeStage(connector);
            return (
              <article key={connector.id} className="rounded-3xl border border-white/10 bg-stone-950/80 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">{typeLabel[connector.type] || connector.type}</p>
                    <h2 className="mt-2 text-xl font-black text-white">{connector.name}</h2>
                    <p className="mt-1 break-all text-xs text-stone-500">{connector.baseUrl}</p>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-bold ${stage.tone}`}>{stage.label}</span>
                </div>

                <p className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-3 text-sm text-stone-300">{stage.detail}</p>

                <dl className="mt-4 grid gap-3 text-xs text-stone-300 sm:grid-cols-3">
                  <div><dt className="text-stone-500">Safety</dt><dd>{connector.safetyStatus}</dd></div>
                  <div><dt className="text-stone-500">Permission</dt><dd>{connector.permissionStatus}</dd></div>
                  <div><dt className="text-stone-500">Execution</dt><dd>{connector.networkExecutionEnabled ? 'on' : 'off'}</dd></div>
                </dl>

                {connector.type === 'backend_bridge' && (
                  <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100">
                    WordPress/SDK Flow: Connector anlegen → Pairing-Code im Plugin einfügen → Signed Health bestätigt Verbindung → Permissions später bewusst aktivieren.
                  </div>
                )}

                {connector.type === 'webhook' && (
                  <div className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-3 text-xs leading-5 text-cyan-50">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <p className="font-bold">Webhook Signing: {connector.webhookSigningMode || 'unsigned_pilot'}</p>
                      <p className="text-cyan-200">Current ref digest: {connector.webhookSecretRefDigest || 'none'}</p>
                    </div>
                    <label className="mt-3 block text-cyan-100">
                      Neuer server-owned Secret Ref
                      <input
                        value={rotationDrafts[connector.id]?.nextSecretRef || ''}
                        onChange={(event) => updateRotationDraft(connector.id, { nextSecretRef: event.target.value })}
                        placeholder="actionbridge:webhook-signing:customer-ref-v2"
                        className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-stone-100 outline-none placeholder:text-stone-600"
                      />
                    </label>
                    <label className="mt-2 flex items-center gap-2 text-cyan-100">
                      <input
                        type="checkbox"
                        checked={rotationDrafts[connector.id]?.apply === true}
                        onChange={(event) => updateRotationDraft(connector.id, { apply: event.target.checked })}
                      />
                      Apply nach Resolver-Check ausführen (sonst nur Dry-Run)
                    </label>
                    <button
                      type="button"
                      disabled={busy || !(rotationDrafts[connector.id]?.nextSecretRef || '').trim()}
                      onClick={() => rotateWebhookSecret(connector)}
                      className="mt-3 rounded-xl border border-cyan-200/30 px-3 py-2 font-black text-cyan-50 disabled:opacity-50"
                    >
                      Signing Ref prüfen/rotieren
                    </button>
                    <p className="mt-2 text-cyan-200">UI sendet nie Roh-Secrets, nur server-owned Refs; Route auditiert redacted und blockt ohne Resolver-Erfolg.</p>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  {safeCapabilities(connector.capabilities || []).map((capability) => (
                    <span key={capability} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-stone-300">{capability}</span>
                  ))}
                </div>
              </article>
            );
          })}
          {!connectors.length && (
            <div className="rounded-3xl border border-dashed border-white/15 p-8 text-sm text-stone-400">
              Noch keine Connectoren geladen. Starte im Wizard und verbinde zuerst Website, Webhook oder WordPress/Backend Bridge.
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
