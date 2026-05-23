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

type EmbeddedSetupDescriptor = {
  version: 'actionbridge.embedded_setup.v1';
  status: 'draft' | 'waiting' | 'connected' | 'needs_attention' | 'paused';
  steps: Array<{ id: string; label: string; operatorOnly: false }>;
  customerControls: Array<'pause' | 'remove' | 'retry'>;
  operatorControlsExcluded: true;
};

type LoadState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; setupSession: SetupSessionView; embeddedSetup?: EmbeddedSetupDescriptor }
  | { status: 'error'; message: string };

function maskToken(token: string) {
  return token.startsWith('absl_') ? `${token.slice(0, 9)}…shown-once` : '';
}

function safeBridgeSnippet(snippet: string, token: string) {
  return snippet.replace('SETUP_TOKEN_SHOWN_ONCE', maskToken(token) || 'absl_…');
}

function parseEmbeddedSetupDescriptor(value: unknown): EmbeddedSetupDescriptor | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<EmbeddedSetupDescriptor>;
  if (candidate.version !== 'actionbridge.embedded_setup.v1' || !Array.isArray(candidate.steps)) return undefined;
  return {
    version: 'actionbridge.embedded_setup.v1',
    status: candidate.status || 'draft',
    steps: candidate.steps.filter((step): step is { id: string; label: string; operatorOnly: false } => Boolean(step && typeof step.id === 'string' && typeof step.label === 'string' && step.operatorOnly === false)),
    customerControls: Array.isArray(candidate.customerControls) ? candidate.customerControls.filter((control): control is 'pause' | 'remove' | 'retry' => control === 'pause' || control === 'remove' || control === 'retry') : [],
    operatorControlsExcluded: true,
  };
}

export default function ActionBridgeSetupSessionClient({ token }: { token: string }) {
  const [state, setState] = useState<LoadState>({ status: token ? 'loading' : 'idle' });
  const [selectedVerification, setSelectedVerification] = useState<string>('');
  const [selectedCapabilities, setSelectedCapabilities] = useState<string[]>([]);
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
        setState({ status: 'ready', setupSession: body.setupSession, embeddedSetup: parseEmbeddedSetupDescriptor(body.embeddedSetup) });
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

  const { setupSession, embeddedSetup } = state;
  const setupSteps = embeddedSetup?.steps?.length ? embeddedSetup.steps : [
    { id: 'authorization.verify', label: 'Autorisierung prüfen', operatorOnly: false as const },
    { id: 'bridge.install', label: 'Bridge installieren', operatorOnly: false as const },
    { id: 'permissions.choose', label: 'Berechtigungen wählen', operatorOnly: false as const },
    { id: 'connection.test', label: 'Verbindung testen', operatorOnly: false as const },
  ];
  const activeStepId = selectedCapabilities.length ? 'connection.test' : selectedVerification ? 'permissions.choose' : 'authorization.verify';
  const activeStepIndex = Math.max(0, setupSteps.findIndex((step) => step.id === activeStepId));
  const selectedCapabilityViews = setupSession.capabilityChoices.filter((capability) => selectedCapabilities.includes(capability.name));

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

      <div className="mt-6 rounded-2xl border border-emerald-300/15 bg-emerald-950/20 p-4" data-actionbridge-embedded-setup-wizard="true">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-300">Embedded Setup Wizard</p>
            <h3 className="mt-2 text-xl font-bold">Kunden-Schritte aus echter Setup-Session</h3>
            <p className="mt-2 max-w-2xl text-sm text-neutral-400">Dieser Wizard sammelt nur lokale Auswahlentscheidungen für die nächste Freigabe. Er schreibt keine Secrets, aktiviert keine Execution und ersetzt keine Server-Verifikation.</p>
          </div>
          <span className="rounded-full border border-white/10 bg-black/20 px-3 py-2 text-xs text-neutral-300">Status: {embeddedSetup?.status || setupSession.status}</span>
        </div>

        <ol className="mt-5 grid gap-3 md:grid-cols-6">
          {setupSteps.map((step, index) => (
            <li key={step.id} className={`rounded-2xl border p-3 text-xs ${index <= activeStepIndex ? 'border-emerald-300/40 bg-emerald-300/10 text-emerald-100' : 'border-white/10 bg-black/20 text-neutral-500'}`}>
              <span className="block font-mono">{String(index + 1).padStart(2, '0')}</span>
              <span className="mt-1 block font-semibold">{step.label}</span>
            </li>
          ))}
        </ol>

        <div className="mt-5 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <h4 className="font-semibold text-emerald-100">1. Verifikationsweg wählen</h4>
            <div className="mt-3 space-y-2">
              {setupSession.verification.map((item) => (
                <button
                  key={item.method}
                  type="button"
                  onClick={() => setSelectedVerification(item.method)}
                  className={`w-full rounded-xl border p-3 text-left text-sm ${selectedVerification === item.method ? 'border-emerald-300 bg-emerald-300/10 text-emerald-100' : 'border-white/10 bg-neutral-950 text-neutral-300'}`}
                >
                  <span className="font-semibold">{item.label}</span>
                  <span className="mt-1 block text-xs text-neutral-400">{item.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <h4 className="font-semibold text-emerald-100">2. Capabilities vormerken</h4>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {setupSession.capabilityChoices.map((capability) => {
                const checked = selectedCapabilities.includes(capability.name);
                return (
                  <label key={capability.name} className={`cursor-pointer rounded-xl border p-3 text-sm ${checked ? 'border-emerald-300 bg-emerald-300/10' : 'border-white/10 bg-neutral-950'}`}>
                    <input
                      className="sr-only"
                      type="checkbox"
                      checked={checked}
                      onChange={() => setSelectedCapabilities((current) => checked ? current.filter((name) => name !== capability.name) : [...current, capability.name])}
                    />
                    <code className="text-xs text-neutral-500">{capability.name}</code>
                    <span className="mt-2 block font-semibold text-white">{capability.label}</span>
                    <span className="mt-1 block text-xs text-neutral-400">Risk: {capability.riskLevel} · Approval: {capability.requiresApproval ? 'required' : 'not required'}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-neutral-950 p-4 text-sm text-neutral-300">
          <h4 className="font-semibold text-white">Wizard-Zusammenfassung</h4>
          <p className="mt-2">Verifikation: <span className="text-emerald-200">{selectedVerification || 'noch nicht gewählt'}</span></p>
          <p className="mt-1">Capabilities: <span className="text-emerald-200">{selectedCapabilityViews.length ? selectedCapabilityViews.map((capability) => capability.name).join(', ') : 'noch nicht gewählt'}</span></p>
          <p className="mt-3 text-xs text-neutral-500">Aktivierung bleibt fail-closed: Erst Server-Verifikation, Bridge-Handshake, Capability-API, Approval-Regeln und Audit schalten echte Ausführung frei.</p>
        </div>
      </div>
    </section>
  );
}
