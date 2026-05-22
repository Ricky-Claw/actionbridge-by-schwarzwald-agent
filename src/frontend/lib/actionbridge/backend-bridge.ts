import 'server-only';

export type ActionBridgeBackendBridgeInstallMode = 'admin_plugin' | 'server_sdk' | 'database_proxy';

export interface ActionBridgeBackendBridgeDraft {
  baseUrl: string;
  allowedOrigins: string[];
  capabilities: string[];
}

const BACKEND_BRIDGE_CAPABILITY_PREFIXES = [
  'backend.read:',
  'backend.write_draft:',
  'workflow.trigger:',
  'database.read_model:',
];

export function normalizeActionBridgeBackendBridgeInstallMode(value: unknown): ActionBridgeBackendBridgeInstallMode {
  if (value === 'server_sdk' || value === 'database_proxy') return value;
  return 'admin_plugin';
}

export function sanitizeActionBridgeBackendBridgeCapability(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim().slice(0, 96);
  if (!candidate) return null;
  if (!BACKEND_BRIDGE_CAPABILITY_PREFIXES.some((prefix) => candidate.startsWith(prefix))) return null;
  if (!/^[a-z0-9_.:-]+$/i.test(candidate)) return null;
  return candidate;
}

export function createActionBridgeBackendBridgeCapabilities(input: {
  installMode?: unknown;
  requestedCapabilities?: unknown;
} = {}): string[] {
  const installMode = normalizeActionBridgeBackendBridgeInstallMode(input.installMode);
  const capabilities = new Set<string>([
    'backend_bridge.v1',
    `install_mode:${installMode}`,
    'customer_consent_required',
    'server_secret_ref_required',
    'approval_required_for_writes',
    'no_browser_secrets',
    'least_privilege_scopes',
  ]);

  if (Array.isArray(input.requestedCapabilities)) {
    for (const item of input.requestedCapabilities) {
      const capability = sanitizeActionBridgeBackendBridgeCapability(item);
      if (capability) capabilities.add(capability);
    }
  }

  return [...capabilities];
}

export function createActionBridgeBackendBridgeSetupContract(input: {
  connectorId: string;
  installMode?: ActionBridgeBackendBridgeInstallMode;
}) {
  const installMode = input.installMode || 'admin_plugin';
  return {
    version: 'actionbridge.backend_bridge_setup.v1' as const,
    connectorId: input.connectorId,
    installMode,
    browserScriptPurpose: 'Domain/admin-panel presence, setup handoff, and UI context only; never stores backend secrets.',
    serverSideRequirement: installMode === 'admin_plugin'
      ? 'Install the ActionBridge platform plugin in the customer admin panel and approve least-privilege scopes.'
      : installMode === 'server_sdk'
        ? 'Install the ActionBridge server SDK in the customer backend and exchange a server-owned secret reference.'
        : 'Create a read-model/database proxy with customer-approved tables/views and server-owned credentials.',
    forbiddenClientData: ['raw_database_credentials', 'api_tokens', 'session_cookies', 'admin_passwords', 'secret_ref_values', 'private_customer_data_without_scope'],
    requiredControls: ['customer_consent_evidence', 'scope_selection', 'approval_for_writes', 'audit_log', 'kill_switch', 'quarantine', 'redaction'],
  };
}
