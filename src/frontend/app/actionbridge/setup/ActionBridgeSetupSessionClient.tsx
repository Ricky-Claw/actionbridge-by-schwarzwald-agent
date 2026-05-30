'use client';

import { useEffect, useMemo, useState } from 'react';

type SetupSessionView = {
  id: string;
  targetOrigin: string;
  status: string;
  verification: Array<{ method: string; label: string; description: string }>;
  bridgeInstall: { snippet: string; status?: string; mode?: string; lastSeenAt?: string | null };
  connector?: {
    id: string | null;
    type: string | null;
    enabled: boolean;
    safetyStatus: string;
    permissionStatus: string;
    networkExecutionEnabled: false;
  };
  connectionTest?: {
    status: 'waiting_for_connector' | 'waiting_for_verification' | 'waiting_for_permissions' | 'waiting_for_bridge' | 'ready_catalog_only' | 'needs_attention';
    verified: boolean;
    bridgeConnected: boolean;
    enabledCapabilities: string[];
    networkExecution: false;
  };
  canIssueVerificationChallenge: boolean;
  capabilityChoices: Array<{ name: string; label: string; riskLevel: 'read' | 'write'; requiresApproval: boolean; enabled?: boolean }>;
  expiresAt: string;
};

type EmbeddedSetupDescriptor = {
  version: 'actionbridge.embedded_setup.v1';
  status: 'draft' | 'waiting' | 'connected' | 'needs_attention' | 'paused';
  steps: Array<{ id: string; label: string; operatorOnly: false }>;
  customerControls: Array<'pause' | 'remove' | 'retry'>;
  operatorControlsExcluded: true;
};

type VerificationChallengeView = {
  id: string;
  status: string;
  origin: string;
  hostname: string;
  method: string;
  challengePath?: string;
  dnsRecordName?: string;
  token?: string | null;
  instructions: string[];
  expiresAt: string;
};

type VerificationUiState = {
  status: 'idle' | 'loading' | 'challenge' | 'verified' | 'failed' | 'error';
  message: string;
  challenge?: VerificationChallengeView;
  evidence?: Record<string, unknown>;
};

type CapabilitySaveState = {
  status: 'idle' | 'saving' | 'saved' | 'error';
  message: string;
  rules?: Array<{ name: string; enabled: boolean }>;
};

type LoadState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; setupSession: SetupSessionView; embeddedSetup?: EmbeddedSetupDescriptor }
  | { status: 'error'; message: string };

const connectionCopy: Record<string, { label: string; tone: string; message: string }> = {
  waiting_for_connector: {
    label: 'Connector fehlt',
    tone: 'border-amber-300/30 bg-amber-300/10 text-amber-100',
    message: 'Operator muss zuerst einen origin-locked Website-Connector binden.',
  },
  waiting_for_verification: {
    label: 'Verifizierung fehlt',
    tone: 'border-amber-300/30 bg-amber-300/10 text-amber-100',
    message: 'DNS, Meta Tag oder .well-known prüfen, bevor Capabilities aktiv werden.',
  },
  waiting_for_permissions: {
    label: 'Permissions wählen',
    tone: 'border-cyan-300/30 bg-cyan-300/10 text-cyan-100',
    message: 'Domain ist aktiv. Wähle jetzt die erlaubten Funktionen.',
  },
  waiting_for_bridge: {
    label: 'Bridge Script fehlt',
    tone: 'border-cyan-300/30 bg-cyan-300/10 text-cyan-100',
    message: 'Permissions sind gespeichert. Bridge-Script einbauen und Handshake auslösen.',
  },
  ready_catalog_only: {
    label: 'Pilot bereit',
    tone: 'border-emerald-300/30 bg-emerald-300/10 text-emerald-100',
    message: 'Verifiziert, Bridge verbunden, Capabilities gespeichert. Agent-Tools bleiben catalog_only/network off.',
  },
  needs_attention: {
    label: 'Blockiert',
    tone: 'border-rose-300/30 bg-rose-300/10 text-rose-100',
    message: 'Connector ist pausiert, widerrufen, quarantined oder Safety ist fehlgeschlagen.',
  },
};

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
  const [verificationState, setVerificationState] = useState<VerificationUiState>({ status: 'idle', message: 'Noch keine Domain-Challenge angefordert.' });
  const [selectedCapabilities, setSelectedCapabilities] = useState<string[]>([]);
  const [capabilitySaveState, setCapabilitySaveState] = useState<CapabilitySaveState>({ status: 'idle', message: 'Capabilities noch nicht gespeichert.' });
  const maskedToken = useMemo(() => maskToken(token), [token]);

  async function refreshSetupSession() {
    if (!token) return;
    const response = await fetch(`/api/actionbridge/setup-session?token=${encodeURIComponent(token)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'ACTIONBRIDGE_SETUP_SESSION_LOAD_FAILED');
    if (!body.setupSession) throw new Error('ACTIONBRIDGE_SETUP_SESSION_EMPTY');
    setState({ status: 'ready', setupSession: body.setupSession, embeddedSetup: parseEmbeddedSetupDescriptor(body.embeddedSetup) });
    const enabled = Array.isArray(body.setupSession.capabilityChoices)
      ? body.setupSession.capabilityChoices.filter((capability: { name?: string; enabled?: boolean }) => capability.enabled === true && typeof capability.name === 'string').map((capability: { name: string }) => capability.name)
      : [];
    setSelectedCapabilities(enabled);
  }

  function chooseVerification(method: string) {
    setSelectedVerification(method);
    setVerificationState({ status: 'idle', message: 'Challenge für diese Methode noch nicht angefordert.' });
  }

  async function issueVerificationChallenge() {
    if (!selectedVerification) {
      setVerificationState({ status: 'error', message: 'Wähle zuerst DNS TXT, Meta Tag oder .well-known.' });
      return;
    }
    setVerificationState({ status: 'loading', message: 'Domain-Challenge wird über die Setup-Session-API angefordert …' });
    try {
      const response = await fetch('/api/actionbridge/setup-session/verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ setupToken: token, method: selectedVerification }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.verification) {
        setVerificationState({ status: 'error', message: typeof body.error === 'string' ? body.error : 'ACTIONBRIDGE_SETUP_VERIFICATION_CREATE_FAILED' });
        return;
      }
      setVerificationState({
        status: body.verification.status === 'verified' ? 'verified' : 'challenge',
        message: body.verification.status === 'verified'
          ? 'Domain ist bereits verifiziert. Connector ist aktivierbar, Execution bleibt aus.'
          : 'Challenge erstellt. Wert beim Domain-/Website-System eintragen, dann prüfen.',
        challenge: body.verification,
      });
      if (body.verification.status === 'verified') await refreshSetupSession();
    } catch {
      setVerificationState({ status: 'error', message: 'Domain-Challenge konnte nicht angefordert werden.' });
    }
  }

  async function checkVerificationChallenge() {
    const challenge = verificationState.challenge;
    if (!challenge) {
      setVerificationState({ status: 'error', message: 'Keine Challenge zum Prüfen vorhanden.' });
      return;
    }
    if (!challenge.token) {
      setVerificationState({ status: 'verified', message: 'Domain ist bereits verifiziert. Keine erneute Prüfung nötig.', challenge });
      await refreshSetupSession();
      return;
    }
    setVerificationState({ ...verificationState, status: 'loading', message: 'Verifikation wird fail-closed geprüft …' });
    try {
      const response = await fetch('/api/actionbridge/setup-session/verification', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ setupToken: token, verificationId: challenge.id, verificationToken: challenge.token }),
      });
      const body = await response.json().catch(() => ({}));
      const verification = body.verification || {};
      setVerificationState({
        status: response.ok ? 'verified' : 'failed',
        message: response.ok ? 'Domain verifiziert. Connector aktiv, Network Execution bleibt aus.' : typeof body.error === 'string' ? body.error : 'ACTIONBRIDGE_SETUP_VERIFICATION_FAILED',
        challenge,
        evidence: verification.evidence,
      });
      if (response.ok) await refreshSetupSession();
    } catch {
      setVerificationState({ status: 'error', message: 'Verifikationsprüfung konnte nicht ausgeführt werden.', challenge });
    }
  }

  async function saveCapabilities() {
    setCapabilitySaveState({ status: 'saving', message: 'Capabilities werden serverseitig gespeichert …' });
    try {
      const response = await fetch('/api/actionbridge/setup-session/capabilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ setupToken: token, capabilities: selectedCapabilities }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setCapabilitySaveState({ status: 'error', message: typeof body.error === 'string' ? body.error : 'ACTIONBRIDGE_SETUP_CAPABILITIES_SAVE_FAILED' });
        return;
      }
      setCapabilitySaveState({
        status: 'saved',
        message: 'Capabilities gespeichert. Agent-Tool-Katalog kann sie lesen; Network Execution bleibt aus.',
        rules: Array.isArray(body.capabilityRules) ? body.capabilityRules : [],
      });
      await refreshSetupSession();
    } catch {
      setCapabilitySaveState({ status: 'error', message: 'Capabilities konnten nicht gespeichert werden.' });
    }
  }

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setState({ status: 'loading' });
    refreshSetupSession()
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ status: 'error', message: error instanceof Error ? error.message : 'ACTIONBRIDGE_SETUP_SESSION_LOAD_FAILED' });
      });
    return () => { cancelled = true; };
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
  const connection = setupSession.connectionTest || { status: 'waiting_for_verification', verified: false, bridgeConnected: false, enabledCapabilities: [], networkExecution: false as const };
  const connectionState = connectionCopy[connection.status] || connectionCopy.waiting_for_verification;
  const activeStepId = connection.bridgeConnected
    ? 'connector.activate'
    : selectedCapabilities.length || connection.enabledCapabilities.length
      ? 'connection.test'
      : connection.verified || verificationState.status === 'verified'
        ? 'permissions.choose'
        : selectedVerification
          ? 'authorization.verify'
          : 'connector.choose';
  const activeStepIndex = Math.max(0, setupSteps.findIndex((step) => step.id === activeStepId));
  const selectedCapabilityViews = setupSession.capabilityChoices.filter((capability) => selectedCapabilities.includes(capability.name));
  const canSaveCapabilities = Boolean(setupSession.connector?.id && (connection.verified || verificationState.status === 'verified') && capabilitySaveState.status !== 'saving');

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

      <div className="mt-6 grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Connector</p>
          <p className="mt-2 font-bold text-white">{setupSession.connector?.type || 'nicht gebunden'}</p>
          <p className="mt-1 text-xs text-neutral-400">Safety {setupSession.connector?.safetyStatus || 'untested'} · Permission {setupSession.connector?.permissionStatus || 'draft'}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Bridge</p>
          <p className="mt-2 font-bold text-white">{setupSession.bridgeInstall.status || 'script_pending'}</p>
          <p className="mt-1 text-xs text-neutral-400">Mode: {setupSession.bridgeInstall.mode || 'script_pending'}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Capabilities</p>
          <p className="mt-2 font-bold text-white">{connection.enabledCapabilities.length}</p>
          <p className="mt-1 text-xs text-neutral-400">Tool-Katalog, network off</p>
        </div>
        <div className={`rounded-2xl border p-4 ${connectionState.tone}`}>
          <p className="text-xs uppercase tracking-[0.2em] opacity-80">Verbindungstest</p>
          <p className="mt-2 font-black">{connectionState.label}</p>
          <p className="mt-1 text-xs opacity-80">{connectionState.message}</p>
        </div>
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
            <p className="mt-2 max-w-2xl text-sm text-neutral-400">Dieser Wizard sammelt nur lokale Auswahlentscheidungen, speichert erlaubte Funktionen nach Server-Verifikation und aktiviert keine Execution. Für 5–10 Pilotkunden: Bridge-Script verbinden, dann catalog_only nutzen.</p>
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
                  onClick={() => chooseVerification(item.method)}
                  className={`w-full rounded-xl border p-3 text-left text-sm ${selectedVerification === item.method ? 'border-emerald-300 bg-emerald-300/10 text-emerald-100' : 'border-white/10 bg-neutral-950 text-neutral-300'}`}
                >
                  <span className="font-semibold">{item.label}</span>
                  <span className="mt-1 block text-xs text-neutral-400">{item.description}</span>
                </button>
              ))}
            </div>

            {setupSession.canIssueVerificationChallenge ? (
              <div className="mt-4 rounded-xl border border-emerald-300/20 bg-emerald-300/10 p-3 text-xs text-emerald-50">
                <p className="font-semibold">Live Domain-Challenge</p>
                <p className="mt-1 text-emerald-100/80">Token-scoped API: keine Operator-Session nötig, kein Human-Attestation-Shortcut, kein Execution-Schalter.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={!selectedVerification || verificationState.status === 'loading'} onClick={issueVerificationChallenge} className="rounded-xl bg-emerald-300 px-3 py-2 font-black text-neutral-950 disabled:opacity-50">Challenge anfordern</button>
                  <button type="button" disabled={!verificationState.challenge?.token || verificationState.status === 'loading'} onClick={checkVerificationChallenge} className="rounded-xl border border-white/20 px-3 py-2 font-bold text-emerald-50 disabled:opacity-50">Verifikation prüfen</button>
                </div>
                <p className={`mt-3 font-semibold ${verificationState.status === 'error' || verificationState.status === 'failed' ? 'text-rose-200' : verificationState.status === 'verified' ? 'text-emerald-200' : 'text-emerald-50'}`}>{verificationState.message}</p>
                {verificationState.challenge && (
                  <div className="mt-3 rounded-xl border border-white/10 bg-neutral-950 p-3 text-neutral-300">
                    <p className="font-mono text-[11px] text-neutral-500">Verification ID: {verificationState.challenge.id}</p>
                    <ul className="mt-2 list-disc space-y-1 pl-4">
                      {verificationState.challenge.instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}
                    </ul>
                    <p className="mt-2 text-[11px] text-neutral-500">Prüfen startet einen begrenzten DNS/HTTPS-Check gegen die verknüpfte Kunden-Origin. Nur ausführen, wenn du diese Domain kontrollierst.</p>
                    {verificationState.evidence && <pre className="mt-2 overflow-auto rounded-lg bg-black/40 p-2 text-[11px] text-neutral-500">{JSON.stringify(verificationState.evidence, null, 2)}</pre>}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-xs text-amber-100">
                Bridge-preview only: Dieser Setup-Link ist nicht an einen Connector gebunden. Live Domain-Challenges bleiben verborgen, bis der Operator einen origin-locked Connector auswählt.
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <h4 className="font-semibold text-emerald-100">2. Capabilities speichern</h4>
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
                    <span className="mt-1 block text-xs text-neutral-400">Risk: {capability.riskLevel} · Approval: {capability.requiresApproval ? 'required' : 'not required'} · {capability.enabled ? 'server enabled' : 'off'}</span>
                  </label>
                );
              })}
            </div>
            <button type="button" disabled={!canSaveCapabilities} onClick={saveCapabilities} className="mt-4 rounded-xl bg-emerald-300 px-4 py-2 text-sm font-black text-neutral-950 disabled:opacity-50">Capabilities speichern</button>
            <p className={`mt-3 text-xs font-semibold ${capabilitySaveState.status === 'error' ? 'text-rose-200' : capabilitySaveState.status === 'saved' ? 'text-emerald-200' : 'text-neutral-400'}`}>{capabilitySaveState.message}</p>
            {capabilitySaveState.rules && <pre className="mt-2 overflow-auto rounded-lg bg-neutral-950 p-2 text-[11px] text-neutral-500">{JSON.stringify(capabilitySaveState.rules, null, 2)}</pre>}
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-neutral-950 p-4 text-sm text-neutral-300">
          <h4 className="font-semibold text-white">Wizard-Zusammenfassung</h4>
          <p className="mt-2">Verifikation: <span className="text-emerald-200">{connection.verified || verificationState.status === 'verified' ? 'verifiziert' : selectedVerification || 'noch nicht gewählt'}</span></p>
          <p className="mt-1">Capabilities: <span className="text-emerald-200">{selectedCapabilityViews.length ? selectedCapabilityViews.map((capability) => capability.name).join(', ') : 'noch nicht gewählt'}</span></p>
          <p className="mt-1">Connection Test: <span className="text-emerald-200">{connectionState.label}</span></p>
          <p className="mt-3 text-xs text-neutral-500">Aktivierung bleibt fail-closed: Tool-Katalog ja, Network Execution nein. Writes bleiben approval-gated und ohne Production Secret-Manager kein breiter Rollout.</p>
        </div>
      </div>
    </section>
  );
}
