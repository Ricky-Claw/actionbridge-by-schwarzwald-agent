'use client';

import { useMemo, useState } from 'react';

type ConnectorType = 'website' | 'webhook' | 'whatsapp_business' | 'backend_bridge';

type SubmitState = {
  status: 'idle' | 'submitting' | 'success' | 'error';
  message: string;
  redactedPayload?: Record<string, unknown>;
};

const connectorCopy: Record<ConnectorType, { label: string; helper: string }> = {
  website: {
    label: 'Website',
    helper: 'Domain/URL eintragen. ActionBridge verifiziert Ownership und hält Ausführung read-only, bis Policies aktiv sind.',
  },
  webhook: {
    label: 'Webhook-v1',
    helper: 'HTTPS Origin und relativer Endpoint-Pfad. Signing Secrets bleiben server-owned.',
  },
  whatsapp_business: {
    label: 'WhatsApp Business',
    helper: 'Phone Number ID, WABA ID und API-Version. Meta Token/OAuth wird nicht im Kundenformular angenommen.',
  },
  backend_bridge: {
    label: 'WordPress / Backend Bridge',
    helper: 'Serverseitiges Plugin oder SDK verbinden. Pairing-Code wird einmal angezeigt; Execution bleibt bis Freigabe aus.',
  },
};

function isSafeHttpsUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    if (parsed.hostname === 'localhost' || parsed.hostname.endsWith('.local') || parsed.hostname.endsWith('.internal')) return false;
    return true;
  } catch {
    return false;
  }
}

function isSafeWebhookEndpointPath(value: string) {
  const candidate = value.trim() || '/';
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate) || candidate.startsWith('//')) return false;
  if (candidate.includes('?') || candidate.includes('#') || candidate.includes('\\')) return false;
  return true;
}

function isMetaNumericId(value: string) {
  return /^\d{5,32}$/.test(value.trim());
}

function isGraphApiVersion(value: string) {
  return /^v\d{2}\.\d$/.test(value.trim().toLowerCase());
}

function buildConnectorPayload(type: ConnectorType, form: FormData) {
  const name = String(form.get('name') || '').trim();
  if (!name) throw new Error('Connector Name fehlt.');
  if (type === 'website') {
    const baseUrl = String(form.get('websiteUrl') || '').trim();
    if (!isSafeHttpsUrl(baseUrl)) throw new Error('Website URL muss HTTPS sein und darf keine Userinfo/private Hostnames enthalten.');
    return { name, type, baseUrl };
  }
  if (type === 'webhook') {
    const baseUrl = String(form.get('webhookOrigin') || '').trim();
    const endpointPath = String(form.get('endpointPath') || '/').trim() || '/';
    if (!isSafeHttpsUrl(baseUrl)) throw new Error('Webhook Origin muss HTTPS sein und darf keine Userinfo/private Hostnames enthalten.');
    if (!isSafeWebhookEndpointPath(endpointPath)) throw new Error('Endpoint Path muss relativ sein und darf keine Query, Hash, Backslash oder absolute URL enthalten.');
    return { name, type, baseUrl, endpointPath };
  }
  if (type === 'backend_bridge') {
    const baseUrl = String(form.get('backendBaseUrl') || '').trim();
    const installMode = String(form.get('installMode') || 'admin_plugin').trim();
    if (!isSafeHttpsUrl(baseUrl)) throw new Error('Backend/WordPress URL muss HTTPS sein und darf keine Userinfo/private Hostnames enthalten.');
    return { name, type, baseUrl, installMode };
  }
  const phoneNumberId = String(form.get('phoneNumberId') || '').trim();
  const businessAccountId = String(form.get('businessAccountId') || '').trim();
  const apiVersion = String(form.get('apiVersion') || 'v20.0').trim();
  if (!isMetaNumericId(phoneNumberId)) throw new Error('Phone Number ID muss eine numerische Meta-ID sein.');
  if (!isMetaNumericId(businessAccountId)) throw new Error('WABA ID muss eine numerische Meta-ID sein.');
  if (!isGraphApiVersion(apiVersion)) throw new Error('Graph API Version muss dem Format v20.0 entsprechen.');
  return { name, type, phoneNumberId, businessAccountId, apiVersion };
}

function redactPayload(payload: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => {
    if (/token|secret|password|key/i.test(key)) return [key, '[redacted]'];
    return [key, value];
  }));
}

export default function EmbeddedSetupWizardClient() {
  const [connectorType, setConnectorType] = useState<ConnectorType>('website');
  const [submitState, setSubmitState] = useState<SubmitState>({ status: 'idle', message: 'Noch kein Connector erstellt.' });
  const selectedCopy = connectorCopy[connectorType];
  const safeFields = useMemo(() => {
    if (connectorType === 'website') return ['name', 'websiteUrl'];
    if (connectorType === 'webhook') return ['name', 'webhookOrigin', 'endpointPath'];
    if (connectorType === 'backend_bridge') return ['name', 'backendBaseUrl', 'installMode'];
    return ['name', 'phoneNumberId', 'businessAccountId', 'apiVersion'];
  }, [connectorType]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    let payload: Record<string, unknown>;
    try {
      payload = buildConnectorPayload(connectorType, form);
    } catch (error) {
      setSubmitState({ status: 'error', message: error instanceof Error ? error.message : 'Ungültige Connector-Werte.' });
      return;
    }
    setSubmitState({ status: 'submitting', message: 'Connector wird sicher als Draft angelegt …', redactedPayload: redactPayload(payload) });
    try {
      const response = await fetch('/api/actionbridge/connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSubmitState({
          status: 'error',
          message: typeof body.error === 'string' ? body.error : 'ACTIONBRIDGE_CONNECTOR_CREATE_FAILED',
          redactedPayload: redactPayload(payload),
        });
        return;
      }
      let pairing: Record<string, unknown> | undefined;
      if (connectorType === 'backend_bridge' && body.connector?.id) {
        const pairingResponse = await fetch('/api/actionbridge/backend-bridge/pairing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectorId: body.connector.id }),
        });
        const pairingBody = await pairingResponse.json().catch(() => ({}));
        if (!pairingResponse.ok) {
          setSubmitState({
            status: 'error',
            message: typeof pairingBody.error === 'string' ? pairingBody.error : 'ACTIONBRIDGE_BACKEND_BRIDGE_PAIRING_CREATE_FAILED',
            redactedPayload: { id: body.connector.id, type: body.connector.type },
          });
          return;
        }
        pairing = {
          id: pairingBody.pairing?.id,
          code: pairingBody.pairing?.code,
          expiresAt: pairingBody.pairing?.expiresAt,
          warning: pairingBody.pairing?.warning,
        };
      }
      setSubmitState({
        status: 'success',
        message: connectorType === 'backend_bridge'
          ? 'Backend-Bridge Draft erstellt. Pairing-Code jetzt im WordPress Plugin/SDK einfügen. Nach Signed Health: verbunden, aber noch nicht aktiv.'
          : 'Connector-Draft erstellt. Network Execution bleibt aus, bis Verifizierung/Policy/Safety bereit sind.',
        redactedPayload: {
          id: body.connector?.id,
          type: body.connector?.type,
          embeddedStatus: body.connector?.embeddedSetup?.status,
          networkExecutionEnabled: body.connector?.networkExecutionEnabled,
          pairing,
        },
      });
    } catch {
      setSubmitState({ status: 'error', message: 'Netzwerkfehler beim Erstellen des Connector-Drafts.', redactedPayload: redactPayload(payload) });
    }
  }

  return (
    <section className="mt-10 rounded-[1.5rem] border border-emerald-300/15 bg-emerald-950/20 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-300">Live Draft Form</p>
          <h2 className="mt-3 text-2xl font-black">Connector sicher anlegen</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-300">
            Dieses Formular sendet nur nicht-geheime Setup-Werte an <code>/api/actionbridge/connectors</code>. Keine Tokens, keine Secrets, keine automatische Network Execution.
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xs text-stone-300">
          Safe fields: {safeFields.join(', ')}
        </div>
      </div>

      <form onSubmit={onSubmit} className="mt-6 grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="space-y-3">
          {(Object.keys(connectorCopy) as ConnectorType[]).map((type) => (
            <label key={type} className={`block cursor-pointer rounded-2xl border p-4 ${connectorType === type ? 'border-emerald-300 bg-emerald-300/10' : 'border-white/10 bg-black/20'}`}>
              <input
                className="sr-only"
                type="radio"
                name="connectorType"
                checked={connectorType === type}
                onChange={() => setConnectorType(type)}
              />
              <span className="font-bold text-white">{connectorCopy[type].label}</span>
              <span className="mt-1 block text-sm leading-6 text-stone-400">{connectorCopy[type].helper}</span>
            </label>
          ))}
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
          <label className="block text-sm font-semibold text-stone-200">
            Connector Name
            <input required name="name" placeholder={`${selectedCopy.label} Connector`} className="mt-2 w-full rounded-xl border border-white/10 bg-stone-950 px-3 py-3 text-sm outline-none ring-emerald-300/30 focus:ring" />
          </label>

          {connectorType === 'website' && (
            <label className="mt-4 block text-sm font-semibold text-stone-200">
              Website URL
              <input required name="websiteUrl" placeholder="https://kunde.de" className="mt-2 w-full rounded-xl border border-white/10 bg-stone-950 px-3 py-3 text-sm outline-none ring-emerald-300/30 focus:ring" />
            </label>
          )}

          {connectorType === 'webhook' && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold text-stone-200">
                HTTPS Origin
                <input required name="webhookOrigin" placeholder="https://api.kunde.de" className="mt-2 w-full rounded-xl border border-white/10 bg-stone-950 px-3 py-3 text-sm outline-none ring-emerald-300/30 focus:ring" />
              </label>
              <label className="block text-sm font-semibold text-stone-200">
                Endpoint Path
                <input name="endpointPath" placeholder="/hooks/actionbridge" className="mt-2 w-full rounded-xl border border-white/10 bg-stone-950 px-3 py-3 text-sm outline-none ring-emerald-300/30 focus:ring" />
              </label>
            </div>
          )}

          {connectorType === 'backend_bridge' && (
            <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_220px]">
              <label className="block text-sm font-semibold text-stone-200">
                WordPress / Backend URL
                <input required name="backendBaseUrl" placeholder="https://kunde.de" className="mt-2 w-full rounded-xl border border-white/10 bg-stone-950 px-3 py-3 text-sm outline-none ring-emerald-300/30 focus:ring" />
              </label>
              <label className="block text-sm font-semibold text-stone-200">
                Installationsweg
                <select name="installMode" defaultValue="admin_plugin" className="mt-2 w-full rounded-xl border border-white/10 bg-stone-950 px-3 py-3 text-sm outline-none ring-emerald-300/30 focus:ring">
                  <option value="admin_plugin">WordPress Plugin</option>
                  <option value="server_sdk">Server SDK</option>
                  <option value="database_proxy">DB Proxy</option>
                </select>
              </label>
              <p className="sm:col-span-2 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100">
                Pairing-Code wird einmal angezeigt. Nach dem Einfügen im Plugin meldet Signed Health die Verbindung. Aktionen bleiben deaktiviert, bis Permissions explizit freigegeben sind.
              </p>
            </div>
          )}

          {connectorType === 'whatsapp_business' && (
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <label className="block text-sm font-semibold text-stone-200">
                Phone Number ID
                <input required name="phoneNumberId" inputMode="numeric" placeholder="123456789012345" className="mt-2 w-full rounded-xl border border-white/10 bg-stone-950 px-3 py-3 text-sm outline-none ring-emerald-300/30 focus:ring" />
              </label>
              <label className="block text-sm font-semibold text-stone-200">
                WABA ID
                <input required name="businessAccountId" inputMode="numeric" placeholder="123456789012345" className="mt-2 w-full rounded-xl border border-white/10 bg-stone-950 px-3 py-3 text-sm outline-none ring-emerald-300/30 focus:ring" />
              </label>
              <label className="block text-sm font-semibold text-stone-200">
                Graph API Version
                <input name="apiVersion" defaultValue="v20.0" className="mt-2 w-full rounded-xl border border-white/10 bg-stone-950 px-3 py-3 text-sm outline-none ring-emerald-300/30 focus:ring" />
              </label>
            </div>
          )}

          <button type="submit" disabled={submitState.status === 'submitting'} className="mt-6 rounded-xl bg-emerald-300 px-5 py-3 text-sm font-black text-stone-950 disabled:opacity-60">
            Draft Connector erstellen
          </button>

          <div className="mt-5 rounded-2xl border border-white/10 bg-stone-950 p-4">
            <p className={`text-sm font-bold ${submitState.status === 'error' ? 'text-rose-200' : submitState.status === 'success' ? 'text-emerald-200' : 'text-stone-300'}`}>{submitState.message}</p>
            {submitState.redactedPayload && (
              <pre className="mt-3 overflow-auto rounded-xl bg-black/40 p-3 text-xs text-stone-400">{JSON.stringify(submitState.redactedPayload, null, 2)}</pre>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}
