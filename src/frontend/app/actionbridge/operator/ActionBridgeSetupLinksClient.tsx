'use client';

import { useEffect, useMemo, useState } from 'react';

type ConnectorOption = {
  id: string;
  name: string;
  type: string;
  permissionStatus: string;
  safetyStatus: string;
};

type SetupLinkView = {
  id: string;
  connectorId: string | null;
  targetOrigin: string;
  status: string;
  allowedMethods: string[];
  createdAt: string;
  expiresAt: string;
};

type CreatedSetupLinkView = SetupLinkView & {
  url: string;
  token: string;
};

const statusTone: Record<string, string> = {
  pending: 'border-amber-300/30 bg-amber-300/10 text-amber-100',
  opened: 'border-cyan-300/30 bg-cyan-300/10 text-cyan-100',
  completed: 'border-emerald-300/30 bg-emerald-300/10 text-emerald-100',
  revoked: 'border-red-300/30 bg-red-300/10 text-red-100',
  expired: 'border-slate-300/20 bg-slate-300/10 text-slate-300',
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('de-DE');
}

function absoluteSetupUrl(relativeUrl: string) {
  if (typeof window === 'undefined') return relativeUrl;
  try {
    return new URL(relativeUrl, window.location.origin).toString();
  } catch {
    return relativeUrl;
  }
}

function maskToken(token: string) {
  return token.startsWith('absl_') ? `${token.slice(0, 10)}…shown-once` : 'shown-once-token';
}

export default function ActionBridgeSetupLinksClient() {
  const [targetOrigin, setTargetOrigin] = useState('');
  const [connectorId, setConnectorId] = useState('');
  const [connectors, setConnectors] = useState<ConnectorOption[]>([]);
  const [setupLinks, setSetupLinks] = useState<SetupLinkView[]>([]);
  const [createdSetupLink, setCreatedSetupLink] = useState<CreatedSetupLinkView | null>(null);
  const [status, setStatus] = useState('Live setup link state not loaded yet.');
  const [busy, setBusy] = useState(false);

  const selectedConnector = useMemo(
    () => connectors.find((connector) => connector.id === connectorId) || null,
    [connectors, connectorId],
  );

  async function loadSetupLinks() {
    const response = await fetch('/api/actionbridge/setup-links', { cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'ACTIONBRIDGE_SETUP_LINKS_LIST_FAILED');
    setSetupLinks(Array.isArray(body.setupLinks) ? body.setupLinks : []);
  }

  async function loadConnectors() {
    const response = await fetch('/api/actionbridge/connectors', { cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setConnectors([]);
      return;
    }
    setConnectors(Array.isArray(body.connectors) ? body.connectors : []);
  }

  async function refresh() {
    setBusy(true);
    setCreatedSetupLink(null);
    try {
      await Promise.all([loadConnectors(), loadSetupLinks()]);
      setStatus('Owner-scoped setup links loaded. Tokens are not returned after creation.');
    } catch (error) {
      setSetupLinks([]);
      setStatus(error instanceof Error ? error.message : 'ACTIONBRIDGE_SETUP_LINKS_LOAD_FAILED');
    } finally {
      setBusy(false);
    }
  }

  async function createSetupLink() {
    const trimmedOrigin = targetOrigin.trim();
    if (!trimmedOrigin) {
      setStatus('Enter the customer HTTPS origin before creating a setup link.');
      return;
    }

    setBusy(true);
    setCreatedSetupLink(null);
    try {
      const response = await fetch('/api/actionbridge/setup-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetOrigin: trimmedOrigin,
          connectorId: connectorId || undefined,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(typeof body.error === 'string' ? body.error : 'ACTIONBRIDGE_SETUP_LINK_CREATE_FAILED');
        return;
      }
      if (!body.setupLink?.token || !body.setupLink?.url) {
        setStatus('ACTIONBRIDGE_SETUP_LINK_CREATE_EMPTY');
        return;
      }
      setCreatedSetupLink(body.setupLink);
      setTargetOrigin('');
      setStatus('Setup link created and audited. Copy the shown-once URL now.');
      await loadSetupLinks();
    } catch {
      setStatus('Setup link creation failed before completion.');
    } finally {
      setBusy(false);
    }
  }

  async function copyCreatedUrl() {
    if (!createdSetupLink || typeof navigator === 'undefined' || !navigator.clipboard) return;
    await navigator.clipboard.writeText(absoluteSetupUrl(createdSetupLink.url));
    setStatus('Shown-once setup URL copied. Do not paste it into logs or tickets.');
  }

  useEffect(() => { void refresh(); }, []);

  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6" data-actionbridge-live-setup-link-generator="true">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300">Operator control</p>
          <h2 className="mt-2 text-2xl font-bold text-white">Live setup link generator</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
            Calls the authenticated JSON setup-link API, stores only the token digest server-side, origin-locks connector bindings, and returns the raw customer token only for this creation response.
          </p>
        </div>
        <button disabled={busy} onClick={refresh} className="rounded-xl bg-white px-3 py-2 text-sm font-bold text-slate-950 disabled:opacity-60">Refresh</button>
      </div>

      <p className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-slate-200">{status}</p>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr_auto]">
        <label className="space-y-2">
          <span className="text-sm font-semibold text-slate-200">Customer HTTPS origin</span>
          <input
            value={targetOrigin}
            onChange={(event) => setTargetOrigin(event.target.value)}
            name="targetOrigin"
            type="url"
            inputMode="url"
            placeholder="https://customer-domain.tld"
            className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none placeholder:text-slate-600"
          />
          <span className="block text-xs text-slate-500">Origin only: no path, query, credentials, localhost, or internal host.</span>
        </label>

        <label className="space-y-2">
          <span className="text-sm font-semibold text-slate-200">Optional connector binding</span>
          <select value={connectorId} onChange={(event) => setConnectorId(event.target.value)} className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100">
            <option value="">No connector yet · bridge-only preview</option>
            {connectors.map((connector) => (
              <option key={connector.id} value={connector.id}>{connector.name} · {connector.type}</option>
            ))}
          </select>
          <span className="block text-xs text-slate-500">Binding is owner-scoped and origin-locked by the API before creation.</span>
        </label>

        <button disabled={busy || !targetOrigin.trim()} onClick={createSetupLink} className="self-end rounded-2xl bg-cyan-300 px-5 py-3 font-semibold text-slate-950 disabled:opacity-60" type="button">
          Create live setup link
        </button>
      </div>

      {selectedConnector && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-slate-300">
          <p><strong className="text-slate-100">Selected connector:</strong> {selectedConnector.name} · {selectedConnector.type}</p>
          <p><strong className="text-slate-100">State:</strong> permission {selectedConnector.permissionStatus}, safety {selectedConnector.safetyStatus}</p>
        </div>
      )}

      {createdSetupLink && (
        <div className="mt-5 rounded-2xl border border-emerald-300/30 bg-emerald-300/10 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200">Shown once setup URL</p>
          <h3 className="mt-2 text-lg font-bold text-white">Copy this customer link now</h3>
          <p className="mt-2 text-sm text-emerald-100">After refresh/listing, only link id, status, methods, and expiry remain visible — not the raw token.</p>
          <div className="mt-3 overflow-auto rounded-xl bg-slate-950 p-3 text-sm text-emerald-100">
            <code>{absoluteSetupUrl(createdSetupLink.url)}</code>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-emerald-100">
            <span className="rounded-full border border-emerald-200/30 px-3 py-1">Token: {maskToken(createdSetupLink.token)}</span>
            <span className="rounded-full border border-emerald-200/30 px-3 py-1">Expires: {formatDate(createdSetupLink.expiresAt)}</span>
            <button type="button" onClick={copyCreatedUrl} className="rounded-full bg-emerald-200 px-3 py-1 font-bold text-slate-950">Copy URL</button>
          </div>
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="font-semibold text-cyan-100">Recent setup links</h3>
          <p className="text-xs text-slate-500">List view intentionally excludes raw setup tokens.</p>
        </div>
        <div className="mt-4 space-y-3">
          {setupLinks.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-slate-400">No setup links loaded for this operator yet.</p>
          ) : setupLinks.slice(0, 6).map((link) => (
            <article key={link.id} className="rounded-xl border border-white/10 bg-slate-950/70 p-4 text-sm text-slate-300">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-semibold text-white">{link.targetOrigin}</p>
                  <p className="mt-1 text-xs text-slate-500">ID: {link.id}{link.connectorId ? ` · Connector: ${link.connectorId}` : ''}</p>
                </div>
                <span className={`w-fit rounded-full border px-3 py-1 text-xs font-bold ${statusTone[link.status] || 'border-white/20 text-slate-300'}`}>{link.status}</span>
              </div>
              <p className="mt-3 text-xs text-slate-500">Methods: {link.allowedMethods.join(', ') || 'none'} · Created: {formatDate(link.createdAt)} · Expires: {formatDate(link.expiresAt)}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
