'use client';

import { useMemo, useState, type CSSProperties } from 'react';

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

type SubmitState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  message: string;
};

const archipelPilotUrls = [
  'https://pflasterarbeiten24.de',
  'https://briefe-beschriften.de',
  'https://porto-rechner24.de',
  'https://vorlage-quittung.de',
  'https://rechnung-ohne-mehrwertsteuer.de',
  'https://brutto-netto-rechner-teilzeit.de',
  'https://lebenslauf-vorlage-kostenlos.de',
  'https://projekt-archipel.de',
].join('\n');

const statusCopy: Record<TargetStatus, { label: string; tone: string; icon: string }> = {
  connected: { label: 'verbunden', tone: 'border-emerald-300/40 bg-emerald-300/10 text-emerald-100', icon: '✅' },
  missing_script: { label: 'kein Script gefunden', tone: 'border-rose-300/40 bg-rose-300/10 text-rose-100', icon: '❌' },
  unverified: { label: 'Eigentümer nicht bestätigt', tone: 'border-amber-300/40 bg-amber-300/10 text-amber-100', icon: '⚠️' },
  unreachable: { label: 'nicht erreichbar', tone: 'border-orange-300/40 bg-orange-300/10 text-orange-100', icon: '⛔' },
  error: { label: 'Fehler', tone: 'border-red-400/40 bg-red-400/10 text-red-100', icon: '🛑' },
  pending: { label: 'wartet auf Check', tone: 'border-slate-300/20 bg-white/5 text-slate-200', icon: '⏳' },
};

function splitUrls(value: string) {
  return value.split(/[\n,;\s]+/).map((entry) => entry.trim()).filter(Boolean);
}

function isSafeCssColor(value: string) {
  return /^#[0-9a-f]{3,8}$/i.test(value) || /^rgba?\([0-9.,%\s]+\)$/i.test(value) || /^[a-z]+$/i.test(value);
}

export default function ActionBridgeTargetsClient() {
  const [tenantId, setTenantId] = useState('archipel');
  const [urlsText, setUrlsText] = useState(archipelPilotUrls);
  const [targets, setTargets] = useState<ActionBridgeTargetView[]>([]);
  const [state, setState] = useState<SubmitState>({ status: 'idle', message: 'Noch keine Targets geladen.' });
  const [primaryColor, setPrimaryColor] = useState('#67e8f9');
  const [cardColor, setCardColor] = useState('rgba(15, 23, 42, 0.72)');

  const cssVars = useMemo(() => ({
    '--ab-primary': isSafeCssColor(primaryColor) ? primaryColor : '#67e8f9',
    '--ab-card': isSafeCssColor(cardColor) ? cardColor : 'rgba(15, 23, 42, 0.72)',
  } as CSSProperties), [primaryColor, cardColor]);

  async function loadTargets() {
    setState({ status: 'loading', message: 'Targets werden geladen …' });
    const query = new URLSearchParams({ providerId: 'schwarzwald-agent', tenantId, primaryColor, cardColor });
    const response = await fetch(`/api/actionbridge/targets?${query.toString()}`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setState({ status: 'error', message: typeof body.error === 'string' ? body.error : 'ACTIONBRIDGE_TARGETS_LIST_FAILED' });
      return;
    }
    setTargets(body.targets || []);
    setState({ status: 'success', message: `${body.targets?.length || 0} Targets geladen.` });
  }

  async function importTargets() {
    const urls = splitUrls(urlsText);
    if (!urls.length) {
      setState({ status: 'error', message: 'Bitte mindestens eine HTTPS URL einfügen.' });
      return;
    }
    setState({ status: 'loading', message: 'URLs werden tenant-sicher registriert …' });
    const response = await fetch('/api/actionbridge/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: 'schwarzwald-agent',
        tenantId,
        urls,
        bridgeOrigin: 'https://bridge.schwarzwald-agent.de',
        theme: { primaryColor, cardColor, language: 'de', density: 'compact' },
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setState({ status: 'error', message: typeof body.error === 'string' ? `${body.error}${body.reason ? `: ${body.reason}` : ''}` : 'ACTIONBRIDGE_TARGETS_CREATE_FAILED' });
      return;
    }
    setTargets(body.targets || []);
    setState({ status: 'success', message: `${body.targets?.length || 0} Targets registriert/aktualisiert. Duplicates: ${body.duplicates?.length || 0}.` });
  }

  async function runLiveCheck(target: ActionBridgeTargetView) {
    setState({ status: 'loading', message: `${target.hostname}: Live Check läuft …` });
    const response = await fetch('/api/actionbridge/targets', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'schwarzwald-agent', tenantId, targetId: target.id }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setState({ status: 'error', message: typeof body.error === 'string' ? body.error : 'ACTIONBRIDGE_TARGET_LIVE_CHECK_FAILED' });
      return;
    }
    setTargets((current) => current.map((entry) => entry.id === target.id ? body.target : entry));
    setState({ status: 'success', message: `${target.hostname}: ${body.target.connectionStatus} via bounded Live Check.` });
  }


  return (
    <section style={cssVars} className="rounded-3xl border border-cyan-300/20 bg-[var(--ab-card)] p-6 shadow-2xl shadow-cyan-950/20">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--ab-primary)]">Multi-URL Connector</p>
          <h2 className="mt-3 text-2xl font-black">Archipel-Inseln verbinden</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
            ActionBridge bleibt nur Connector-Core: URLs registrieren, Eigentümer-/Scriptstatus halten, pro Tenant sichere read-only Tools liefern.
            Die Optik nutzt Host-Theme-Tokens via CSS Variablen, damit sie sich später in Kunden-Anwendungen einfügen kann.
          </p>
        </div>
        <div className="grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
          <label className="space-y-1">
            <span>Primary Token</span>
            <input value={primaryColor} onChange={(event) => setPrimaryColor(event.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 outline-none" />
          </label>
          <label className="space-y-1">
            <span>Card Token</span>
            <input value={cardColor} onChange={(event) => setCardColor(event.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 outline-none" />
          </label>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[0.7fr_1.3fr]">
        <div className="space-y-4">
          <label className="block text-sm font-semibold text-slate-200">
            Tenant / Workspace
            <input value={tenantId} onChange={(event) => setTenantId(event.target.value)} className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 outline-none ring-cyan-300/30 focus:ring" />
          </label>
          <label className="block text-sm font-semibold text-slate-200">
            URLs einfügen
            <textarea value={urlsText} onChange={(event) => setUrlsText(event.target.value)} rows={9} className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm outline-none ring-cyan-300/30 focus:ring" />
          </label>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={importTargets} disabled={state.status === 'loading'} className="rounded-2xl bg-[var(--ab-primary)] px-5 py-3 text-sm font-black text-slate-950 disabled:opacity-60">
              URLs registrieren
            </button>
            <button type="button" onClick={loadTargets} disabled={state.status === 'loading'} className="rounded-2xl border border-white/15 px-5 py-3 text-sm font-bold text-slate-100 disabled:opacity-60">
              Status laden
            </button>
          </div>
          <p className={`rounded-2xl border p-3 text-sm ${state.status === 'error' ? 'border-rose-300/40 bg-rose-300/10 text-rose-100' : 'border-white/10 bg-black/20 text-slate-300'}`}>{state.message}</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-bold text-slate-100">Verbindungsstatus</h3>
            <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">{targets.length} Targets</span>
          </div>
          <div className="mt-4 space-y-3">
            {targets.length === 0 && <p className="text-sm text-slate-400">Noch keine echten Targets aus der API geladen.</p>}
            {targets.map((target) => {
              const copy = statusCopy[target.connectionStatus] || statusCopy.pending;
              return (
                <article key={target.id} className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h4 className="font-bold text-white">{target.hostname}</h4>
                      <p className="mt-1 font-mono text-xs text-slate-400">{target.id}</p>
                      <p className="mt-2 text-xs text-slate-400">Bridge: {target.bridgeOrigin}</p>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-sm font-bold ${copy.tone}`}>{copy.icon} {copy.label}</span>
                  </div>
                  <div className="mt-4 grid gap-2 text-xs text-slate-300 sm:grid-cols-3">
                    <span>Ownership: {target.ownershipStatus}</span>
                    <span>Script: {target.scriptStatus}</span>
                    <span>Tenant: {target.tenantId}</span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => runLiveCheck(target)} className="rounded-xl border border-cyan-300/30 px-3 py-2 text-xs font-bold text-cyan-100">Live Check</button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
