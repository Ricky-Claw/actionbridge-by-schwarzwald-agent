'use client';

import { useEffect, useMemo, useState } from 'react';

type SetupSessionView = {
  id: string;
  targetOrigin: string;
  status: string;
  verification: Array<{ method: string; label: string; description: string }>;
  bridgeInstall: { snippet: string };
  capabilityChoices: Array<{ name: string; label: string; riskLevel: 'read' | 'write'; requiresApproval: boolean }>;
  expiresAt: string;
};

type LoadState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; setupSession: SetupSessionView; embeddedSetup?: unknown }
  | { status: 'error'; message: string };

function maskToken(token: string) {
  return token.startsWith('absl_') ? `${token.slice(0, 9)}…shown-once` : '';
}

function safeBridgeSnippet(snippet: string, token: string) {
  return snippet.replace('SETUP_TOKEN_SHOWN_ONCE', maskToken(token) || 'absl_…');
}

export default function ActionBridgeSetupSessionClient({ token }: { token: string }) {
  const [state, setState] = useState<LoadState>({ status: token ? 'loading' : 'idle' });
  const maskedToken = useMemo(() => maskToken(token), [token]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetch(`/api/actionbridge/setup-session?token=${encodeURIComponent(token)}`, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'ACTIONBRIDGE_SETUP_SESSION_LOAD_FAILED');
        if (!body.setupSession) throw new Error('ACTIONBRIDGE_SETUP_SESSION_EMPTY');
        setState({ status: 'ready', setupSession: body.setupSession, embeddedSetup: body.embeddedSetup });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', message: error instanceof Error ? error.message : 'ACTIONBRIDGE_SETUP_SESSION_LOAD_FAILED' });
      });
    return () => controller.abort();
  }, [token]);

  if (!token) {
    return (
      <section className="rounded-3xl border border-amber-400/30 bg-amber-400/10 p-6 text-amber-100">
        <h2 className="text-xl font-semibold">Setup-Link fehlt</h2>
        <p className="mt-2 text-sm">Öffne diese Seite über den kundenspezifischen ActionBridge Setup-Link. Ohne Token wird keine Session geladen.</p>
      </section>
    );
  }

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <section className="rounded-3xl border border-neutral-800 bg-neutral-900/70 p-6">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-emerald-300">Live Setup Session</p>
        <h2 className="mt-3 text-xl font-semibold">Session wird über die echte Setup-API geladen …</h2>
        <code className="mt-4 inline-block rounded-full bg-neutral-950 px-4 py-2 text-sm text-emerald-200">{maskedToken}</code>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="rounded-3xl border border-rose-400/30 bg-rose-400/10 p-6 text-rose-100">
        <p className="text-sm font-semibold uppercase tracking-[0.25em]">Live Setup Session</p>
        <h2 className="mt-3 text-xl font-semibold">Session konnte nicht geladen werden.</h2>
        <p className="mt-2 text-sm">{state.message}</p>
        <p className="mt-4 text-xs text-rose-200/80">Fail-closed: Ohne gültige Session werden keine Capabilities oder Bridge-Schritte freigeschaltet.</p>
      </section>
    );
  }

  if (state.status !== 'ready') return null;

  const { setupSession } = state;
  return (
    <section className="rounded-3xl border border-emerald-300/20 bg-neutral-900/80 p-6 shadow-2xl">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-emerald-300">Live Setup Session</p>
          <h2 className="mt-3 text-2xl font-bold">{setupSession.targetOrigin}</h2>
          <p className="mt-2 text-sm text-neutral-400">Status: <span className="text-emerald-200">{setupSession.status}</span> · Ablauf: {new Date(setupSession.expiresAt).toLocaleString('de-DE')}</p>
        </div>
        <code className="rounded-full bg-neutral-950 px-4 py-2 text-sm text-emerald-200">{maskedToken}</code>
      </div>

      <div className="mt-6 grid gap-5 md:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <h3 className="font-semibold text-emerald-100">Verifikation aus API</h3>
          <ul className="mt-3 space-y-3 text-sm text-neutral-300">
            {setupSession.verification.map((item) => <li key={item.method}><strong>{item.label}</strong><br /><span className="text-neutral-400">{item.description}</span></li>)}
          </ul>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4 md:col-span-2">
          <h3 className="font-semibold text-emerald-100">Bridge Script</h3>
          <pre className="mt-3 overflow-auto rounded-xl bg-neutral-950 p-3 text-xs text-neutral-300">{safeBridgeSnippet(setupSession.bridgeInstall.snippet, token)}</pre>
          <p className="mt-3 text-xs text-neutral-500">Token wird nur maskiert angezeigt; Digest, Service-Daten und Secrets bleiben serverseitig.</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {setupSession.capabilityChoices.map((capability) => (
          <article key={capability.name} className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <code className="text-xs text-neutral-500">{capability.name}</code>
            <h3 className="mt-2 font-semibold text-white">{capability.label}</h3>
            <p className="mt-2 text-sm text-neutral-400">Risk: {capability.riskLevel} · Approval: {capability.requiresApproval ? 'required' : 'not required'}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
