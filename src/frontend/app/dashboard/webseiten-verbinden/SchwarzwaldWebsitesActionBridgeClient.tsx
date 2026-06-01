'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import ActionBridgeSetupLinksClient from '../../actionbridge/operator/ActionBridgeSetupLinksClient';

type TargetStatus = 'pending' | 'connected' | 'unverified' | 'missing_script' | 'unreachable' | 'error';

type ActionBridgeTargetView = {
  id: string;
  tenantId: string;
  url: string;
  origin: string;
  hostname: string;
  bridgeOrigin: string;
  ownershipStatus: string;
  scriptStatus: string;
  connectionStatus: TargetStatus;
  capabilities: string[];
};

type ConnectorView = {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  capabilities: string[];
  networkExecutionEnabled: boolean;
  safetyStatus: string;
  permissionStatus: string;
};

type SubmitState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  message: string;
};

const statusCopy: Record<TargetStatus, { label: string; tone: string; icon: string }> = {
  connected: { label: 'verbunden', tone: 'border-emerald-300/40 bg-emerald-300/10 text-emerald-100', icon: '✅' },
  missing_script: { label: 'Script fehlt', tone: 'border-rose-300/40 bg-rose-300/10 text-rose-100', icon: '❌' },
  unverified: { label: 'nicht verifiziert', tone: 'border-amber-300/40 bg-amber-300/10 text-amber-100', icon: '⚠️' },
  unreachable: { label: 'nicht erreichbar', tone: 'border-orange-300/40 bg-orange-300/10 text-orange-100', icon: '⛔' },
  error: { label: 'Fehler', tone: 'border-red-400/40 bg-red-400/10 text-red-100', icon: '🛑' },
  pending: { label: 'wartet', tone: 'border-slate-300/20 bg-white/5 text-slate-200', icon: '⏳' },
};

const typeLabel: Record<string, string> = {
  website: 'Website',
  webhook: 'Webhook-v1',
  whatsapp_business: 'WhatsApp Business',
  backend_bridge: 'WordPress / Backend Bridge',
  http: 'HTTP',
};

function splitUrls(value: string) {
  return value.split(/[\n,;\s]+/).map((entry) => entry.trim()).filter(Boolean);
}

function isSafeCssColor(value: string) {
  return /^#[0-9a-f]{3,8}$/i.test(value) || /^rgba?\([0-9.,%\s]+\)$/i.test(value) || /^[a-z]+$/i.test(value);
}

function connectorTone(connector: ConnectorView) {
  if (connector.permissionStatus === 'paused' || connector.permissionStatus === 'revoked') return 'border-amber-300/40 bg-amber-300/10 text-amber-100';
  if (connector.safetyStatus === 'fail') return 'border-red-300/40 bg-red-300/10 text-red-100';
  if (connector.safetyStatus === 'pass' && connector.permissionStatus === 'active') return 'border-emerald-300/40 bg-emerald-300/10 text-emerald-100';
  return 'border-slate-300/20 bg-white/5 text-slate-200';
}

function deriveWorkspaceFromHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  if (!normalized.endsWith('.schwarzwald-agent.de')) return 'dfs';
  const firstLabel = normalized.split('.')[0];
  return /^[a-z0-9][a-z0-9_-]{1,63}$/.test(firstLabel) ? firstLabel : 'dfs';
}

function ActionBridgeTargetsClient({ workspaceId, primaryColor, cardColor }: { workspaceId: string; primaryColor: string; cardColor: string }) {
  const [urlsText, setUrlsText] = useState('');
  const [targets, setTargets] = useState<ActionBridgeTargetView[]>([]);
  const [state, setState] = useState<SubmitState>({ status: 'idle', message: 'Noch keine Webseiten geladen.' });

  async function loadTargets() {
    setState({ status: 'loading', message: 'Webseiten werden aus ActionBridge geladen …' });
    const query = new URLSearchParams({ tenantId: workspaceId, primaryColor, cardColor, density: 'compact', language: 'de' });
    const response = await fetch(`/api/actionbridge/targets?${query.toString()}`, { cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setTargets([]);
      setState({ status: 'error', message: typeof body.error === 'string' ? body.error : 'ACTIONBRIDGE_TARGETS_LIST_FAILED' });
      return;
    }
    setTargets(Array.isArray(body.targets) ? body.targets : []);
    setState({ status: 'success', message: `${body.targets?.length || 0} Webseiten geladen.` });
  }

  async function importTargets() {
    const urls = splitUrls(urlsText);
    if (!urls.length) {
      setState({ status: 'error', message: 'Bitte mindestens eine HTTPS URL einfügen.' });
      return;
    }
    setState({ status: 'loading', message: 'Webseiten werden workspace-sicher registriert …' });
    const response = await fetch('/api/actionbridge/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: workspaceId, urls }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setState({ status: 'error', message: typeof body.error === 'string' ? body.error : 'ACTIONBRIDGE_TARGETS_CREATE_FAILED' });
      return;
    }
    setTargets(Array.isArray(body.targets) ? body.targets : []);
    setUrlsText('');
    setState({ status: 'success', message: `${body.targets?.length || 0} Webseiten im Dashboard aktualisiert. Rejected: ${body.rejected?.length || 0}.` });
  }

  async function runLiveCheck(target: ActionBridgeTargetView) {
    setState({ status: 'loading', message: `${target.hostname}: sicherer Live Check läuft …` });
    const response = await fetch('/api/actionbridge/targets', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: workspaceId, targetId: target.id }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setState({ status: 'error', message: typeof body.error === 'string' ? body.error : 'ACTIONBRIDGE_TARGET_LIVE_CHECK_FAILED' });
      return;
    }
    setTargets((current) => current.map((entry) => entry.id === target.id ? body.target : entry));
    setState({ status: 'success', message: `${target.hostname}: ${body.target.connectionStatus} nach bounded Live Check.` });
  }

  return (
    <section className="rounded-[2rem] border border-emerald-300/15 bg-black/25 p-5" data-actionbridge-targets-client="dashboard-embedded">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-emerald-300">Webseiten im Workspace</p>
          <h2 className="mt-2 text-2xl font-black text-white">Domains verbinden und Script-Status prüfen</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-300">
            Die UI sitzt im Schwarzwald-Agent Dashboard; Validierung, Tenant-Grenzen, Live Check und Tool-Katalog bleiben bei ActionBridge.
          </p>
        </div>
        <button type="button" onClick={loadTargets} disabled={state.status === 'loading'} className="rounded-2xl bg-emerald-300 px-4 py-2 text-sm font-black text-stone-950 disabled:opacity-60">Status laden</button>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="space-y-4">
          <label className="block text-sm font-bold text-stone-200">
            Webseiten URLs
            <textarea value={urlsText} onChange={(event) => setUrlsText(event.target.value)} rows={8} placeholder="https://kunde.de\nhttps://shop.kunde.de" className="mt-2 w-full rounded-2xl border border-white/10 bg-stone-950 px-4 py-3 text-sm text-stone-100 outline-none ring-emerald-300/30 focus:ring" />
          </label>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={importTargets} disabled={state.status === 'loading'} className="rounded-2xl bg-emerald-300 px-5 py-3 text-sm font-black text-stone-950 disabled:opacity-60">URLs hinzufügen</button>
            <button type="button" onClick={loadTargets} disabled={state.status === 'loading'} className="rounded-2xl border border-white/15 px-5 py-3 text-sm font-bold text-stone-100 disabled:opacity-60">Neu laden</button>
          </div>
          <p className={`rounded-2xl border p-3 text-sm ${state.status === 'error' ? 'border-rose-300/40 bg-rose-300/10 text-rose-100' : 'border-white/10 bg-black/30 text-stone-300'}`}>{state.message}</p>
          <p className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100">
            Schutzkante: Browser sendet nur Workspace-Kontext und URLs. Keine Service-Credentials, keine internen Digests, keine automatische Ausführung.
          </p>
        </div>

        <div className="space-y-3">
          {targets.length === 0 ? <p className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-stone-400">Noch keine Webseiten in diesem Workspace geladen.</p> : null}
          {targets.map((target) => {
            const copy = statusCopy[target.connectionStatus] || statusCopy.pending;
            return (
              <article key={target.id} className="rounded-3xl border border-white/10 bg-stone-950/75 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="text-lg font-black text-white">{target.hostname}</h3>
                    <p className="mt-1 font-mono text-xs text-stone-500">{target.id}</p>
                    <p className="mt-2 text-xs text-stone-400">Ownership: {target.ownershipStatus} · Script: {target.scriptStatus}</p>
                  </div>
                  <span className={`w-fit rounded-full border px-3 py-1 text-xs font-black ${copy.tone}`}>{copy.icon} {copy.label}</span>
                </div>
                <p className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-3 text-xs leading-5 text-cyan-100">
                  Registry- und Statusansicht: Die Installations-Zeile kommt aus der Setup-Session, sobald Domain-Verifikation und Capabilities gespeichert sind.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => runLiveCheck(target)} className="rounded-xl border border-emerald-300/30 px-3 py-2 text-xs font-black text-emerald-100">Live Check</button>
                  {target.capabilities.slice(0, 4).map((capability) => <span key={capability} className="rounded-full border border-white/10 px-3 py-1 text-xs text-stone-300">{capability}</span>)}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ActionBridgeConnectorsPanel() {
  const [connectors, setConnectors] = useState<ConnectorView[]>([]);
  const [state, setState] = useState<SubmitState>({ status: 'idle', message: 'Connectoren noch nicht geladen.' });

  async function loadConnectors() {
    setState({ status: 'loading', message: 'Connectoren werden geladen …' });
    const response = await fetch('/api/actionbridge/connectors', { cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setConnectors([]);
      setState({ status: 'error', message: typeof body.error === 'string' ? body.error : 'ACTIONBRIDGE_CONNECTORS_LIST_FAILED' });
      return;
    }
    setConnectors(Array.isArray(body.connectors) ? body.connectors : []);
    setState({ status: 'success', message: `${body.connectors?.length || 0} Connectoren geladen.` });
  }

  return (
    <section className="rounded-[2rem] border border-cyan-300/15 bg-cyan-400/10 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.25em] text-cyan-200">Connector-Status</p>
          <h2 className="mt-2 text-2xl font-black text-white">Freigaben, Safety und Execution getrennt sehen</h2>
        </div>
        <button type="button" onClick={loadConnectors} disabled={state.status === 'loading'} className="rounded-2xl bg-cyan-200 px-4 py-2 text-sm font-black text-slate-950 disabled:opacity-60">Connectoren laden</button>
      </div>
      <p className={`mt-4 rounded-2xl border p-3 text-sm ${state.status === 'error' ? 'border-rose-300/40 bg-rose-300/10 text-rose-100' : 'border-white/10 bg-black/25 text-stone-300'}`}>{state.message}</p>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {connectors.length === 0 ? <p className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-stone-400">Keine Connectoren geladen.</p> : null}
        {connectors.map((connector) => (
          <article key={connector.id} className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">{typeLabel[connector.type] || connector.type}</p>
                <h3 className="mt-2 font-black text-white">{connector.name}</h3>
                <p className="mt-1 break-all text-xs text-stone-500">{connector.baseUrl}</p>
              </div>
              <span className={`w-fit rounded-full border px-3 py-1 text-xs font-black ${connectorTone(connector)}`}>{connector.safetyStatus} · {connector.permissionStatus}</span>
            </div>
            <p className="mt-3 text-xs text-stone-400">Execution: {connector.networkExecutionEnabled ? 'on' : 'off'} · Capabilities: {connector.capabilities?.slice(0, 3).join(', ') || 'none'}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function SchwarzwaldWebsitesActionBridgeClient() {
  const [workspace, setWorkspace] = useState('dfs');
  const [primaryColor, setPrimaryColor] = useState('#34d399');
  const [cardColor, setCardColor] = useState('rgba(6, 17, 13, 0.78)');

  const cssVars = useMemo(() => ({
    '--ab-primary': isSafeCssColor(primaryColor) ? primaryColor : '#34d399',
    '--ab-card': isSafeCssColor(cardColor) ? cardColor : 'rgba(6, 17, 13, 0.78)',
  } as CSSProperties), [primaryColor, cardColor]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setWorkspace((current) => current === 'dfs' ? deriveWorkspaceFromHostname(window.location.hostname) : current);
  }, []);

  return (
    <div style={cssVars} className="space-y-6" data-schwarzwald-actionbridge-embedded="true">
      <section className="rounded-[2rem] border border-white/10 bg-[var(--ab-card)] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.3em] text-[var(--ab-primary)]">Dashboard Embed</p>
            <h2 className="mt-2 text-2xl font-black text-white">ActionBridge läuft hier eingebettet</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-300">
              Beispiel: <strong>dfs.schwarzwald-agent.de</strong> öffnet direkt dieses Modul. Der Kunde steuert Webseiten und Verbindungen im normalen Schwarzwald-Agent Kontrollzentrum.
            </p>
          </div>
          <div className="grid gap-2 text-xs text-stone-300 sm:grid-cols-3">
            <label className="space-y-1">
              <span>Workspace</span>
              <input value={workspace} onChange={(event) => setWorkspace(event.target.value)} className="w-full rounded-xl border border-white/10 bg-stone-950 px-3 py-2 text-stone-100 outline-none" />
            </label>
            <label className="space-y-1">
              <span>Primary Token</span>
              <input value={primaryColor} onChange={(event) => setPrimaryColor(event.target.value)} className="w-full rounded-xl border border-white/10 bg-stone-950 px-3 py-2 text-stone-100 outline-none" />
            </label>
            <label className="space-y-1">
              <span>Card Token</span>
              <input value={cardColor} onChange={(event) => setCardColor(event.target.value)} className="w-full rounded-xl border border-white/10 bg-stone-950 px-3 py-2 text-stone-100 outline-none" />
            </label>
          </div>
        </div>
      </section>

      <ActionBridgeTargetsClient workspaceId={workspace} primaryColor={primaryColor} cardColor={cardColor} />

      <section className="rounded-[2rem] border border-white/10 bg-stone-950/70 p-5">
        <div className="mb-5">
          <p className="text-xs font-black uppercase tracking-[0.25em] text-emerald-300">Setup-Link</p>
          <h2 className="mt-2 text-2xl font-black text-white">Kunden-Link direkt aus dem Dashboard erzeugen</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-300">
            Das ist derselbe sichere ActionBridge-Flow: Setup-Token nur einmal sichtbar, serverseitig nur Digest, Connector-Bindung origin-locked.
          </p>
        </div>
        <ActionBridgeSetupLinksClient />
      </section>

      <ActionBridgeConnectorsPanel />
    </div>
  );
}
