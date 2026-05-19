'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';

type TargetView = {
  id: string;
  url: string;
  hostname: string;
  ownershipStatus: string;
  scriptStatus: string;
  connectionStatus: string;
  capabilities: string[];
};

const statusTone: Record<string, string> = {
  connected: 'border-emerald-300/40 bg-emerald-400/10 text-emerald-100',
  pending: 'border-sky-300/30 bg-sky-400/10 text-sky-100',
  missing_script: 'border-amber-300/40 bg-amber-400/10 text-amber-100',
  unverified: 'border-orange-300/40 bg-orange-400/10 text-orange-100',
  unreachable: 'border-red-300/40 bg-red-400/10 text-red-100',
  error: 'border-red-300/40 bg-red-400/10 text-red-100',
};

export default function ActionBridgeTargetsClient() {
  const [tenantId, setTenantId] = useState('archipel');
  const [urls, setUrls] = useState('');
  const [targets, setTargets] = useState<TargetView[]>([]);
  const [status, setStatus] = useState('Load tenant-scoped targets from ActionBridge.');
  const [busy, setBusy] = useState(false);

  const themeStyle = useMemo(() => ({
    '--ab-accent': 'var(--customer-accent, #67e8f9)',
    '--ab-panel': 'var(--customer-panel, rgba(15, 23, 42, 0.78))',
  }) as CSSProperties, []);

  async function loadTargets(nextTenant = tenantId) {
    setBusy(true);
    try {
      const response = await fetch(`/api/actionbridge/targets?tenant_id=${encodeURIComponent(nextTenant)}`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setTargets([]);
        setStatus(typeof body.error === 'string' ? body.error : 'ACTIONBRIDGE_TARGET_LIST_FAILED');
        return;
      }
      setTargets(Array.isArray(body.catalog?.targets) ? body.catalog.targets : []);
      setStatus(`Loaded ${body.catalog?.targets?.length || 0} target(s) for tenant ${nextTenant}.`);
    } catch {
      setTargets([]);
      setStatus('Could not load ActionBridge targets.');
    } finally {
      setBusy(false);
    }
  }

  async function runLiveCheck(target: TargetView) {
    setBusy(true);
    try {
      const response = await fetch('/api/actionbridge/targets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, targetId: target.id }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(typeof body.error === 'string' ? body.error : 'ACTIONBRIDGE_TARGET_LIVE_CHECK_FAILED');
        return;
      }
      setTargets((current) => current.map((entry) => entry.id === target.id ? body.target : entry));
      setStatus(`${target.hostname}: ${body.target?.connectionStatus || 'checked'} via bounded Live Check.`);
    } catch {
      setStatus('Could not run ActionBridge Live Check.');
    } finally {
      setBusy(false);
    }
  }

  async function submitTargets() {
    const list = urls.split(/\n|,/).map((item) => item.trim()).filter(Boolean);
    if (!list.length) {
      setStatus('Add at least one HTTPS URL.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/actionbridge/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, urls: list }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(typeof body.error === 'string' ? body.error : 'ACTIONBRIDGE_TARGET_INTAKE_FAILED');
        return;
      }
      setStatus(`Accepted ${body.accepted?.length || 0}, rejected ${body.rejected?.length || 0}, duplicate ${body.duplicates?.length || 0}. No network scan executed.`);
      setUrls('');
      await loadTargets(tenantId);
    } catch {
      setStatus('Could not submit ActionBridge targets.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void loadTargets('archipel'); }, []);

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100" style={themeStyle}>
      <section className="mx-auto max-w-6xl space-y-8">
        <header className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.3em]" style={{ color: 'var(--ab-accent)' }}>ActionBridge Targets</p>
          <h1 className="text-4xl font-bold tracking-tight">Multi-URL intake and connection status.</h1>
          <p className="max-w-3xl text-slate-300">Connector-only operator view: tenant-scoped URLs, status, read-only capabilities, and theme-token friendly surfaces. No scraping or external writes run from this page.</p>
        </header>

        <section className="rounded-3xl border border-slate-800 p-6" style={{ background: 'var(--ab-panel)' }}>
          <div className="grid gap-4 md:grid-cols-[220px_1fr_auto]">
            <label className="space-y-2"><span className="text-sm text-slate-300">Tenant</span><input value={tenantId} onChange={(event) => setTenantId(event.target.value)} className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3" /></label>
            <label className="space-y-2"><span className="text-sm text-slate-300">URLs, comma or line separated</span><textarea value={urls} onChange={(event) => setUrls(event.target.value)} rows={3} className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3" placeholder="https://example.de" /></label>
            <div className="flex flex-col justify-end gap-3"><button disabled={busy} onClick={submitTargets} className="rounded-2xl px-5 py-3 font-semibold text-slate-950 disabled:opacity-50" style={{ background: 'var(--ab-accent)' }}>Register</button><button disabled={busy} onClick={() => loadTargets()} className="rounded-2xl border border-slate-700 px-5 py-3 disabled:opacity-50">Refresh</button></div>
          </div>
          <p className="mt-4 text-sm text-slate-300">{status}</p>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          {targets.map((target) => (
            <article key={target.id} className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
              <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-slate-50">{target.hostname}</h2><p className="mt-1 break-all text-sm text-slate-400">{target.url}</p></div><span className={`rounded-full border px-3 py-1 text-xs ${statusTone[target.connectionStatus] || statusTone.pending}`}>{target.connectionStatus}</span></div>
              <dl className="mt-5 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-slate-500">Ownership</dt><dd>{target.ownershipStatus}</dd></div><div><dt className="text-slate-500">Script</dt><dd>{target.scriptStatus}</dd></div></dl>
              <p className="mt-4 text-xs text-slate-500">Capabilities: {target.capabilities.join(', ')}</p>
              <button disabled={busy} onClick={() => runLiveCheck(target)} className="mt-4 rounded-2xl border border-cyan-300/30 px-4 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-50">Live Check</button>
            </article>
          ))}
          {!targets.length && <div className="rounded-3xl border border-dashed border-slate-700 p-8 text-slate-400">No targets returned for this tenant/user scope.</div>}
        </section>
      </section>
    </main>
  );
}
