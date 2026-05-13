import 'server-only';

import { digestActionBridgeSetupLinkToken } from './setup-links';
import type { ActionBridgeSetupVerificationMethod } from './setup-links';

export interface ActionBridgeSetupSessionRecord {
  id: string;
  target_origin: string;
  status: 'pending' | 'opened' | 'completed' | 'revoked' | 'expired';
  allowed_methods: ActionBridgeSetupVerificationMethod[];
  expires_at: string;
}

export interface ActionBridgeSetupSessionView {
  id: string;
  targetOrigin: string;
  status: ActionBridgeSetupSessionRecord['status'];
  allowedMethods: ActionBridgeSetupVerificationMethod[];
  verification: Array<{
    method: ActionBridgeSetupVerificationMethod;
    label: string;
    description: string;
  }>;
  bridgeInstall: {
    mode: 'script_pending';
    snippet: string;
  };
  capabilityChoices: Array<{
    name: string;
    label: string;
    riskLevel: 'read' | 'write';
    requiresApproval: boolean;
  }>;
  expiresAt: string;
}

export function digestActionBridgeSetupSessionToken(token: string): string {
  return digestActionBridgeSetupLinkToken(token);
}

export function createActionBridgeSetupSessionView(record: ActionBridgeSetupSessionRecord): ActionBridgeSetupSessionView {
  const allowedMethods = record.allowed_methods || ['meta_tag', 'dns_txt', 'well_known'];
  return {
    id: record.id,
    targetOrigin: record.target_origin,
    status: record.status,
    allowedMethods,
    verification: allowedMethods.map((method) => ({
      method,
      label: method === 'dns_txt' ? 'DNS TXT' : method === 'meta_tag' ? 'Meta Tag' : '.well-known Datei',
      description: method === 'dns_txt'
        ? 'DNS TXT Record setzen, um Domain-Kontrolle zu beweisen.'
        : method === 'meta_tag'
          ? 'Meta Tag in den HTML Head setzen, um Domain-Kontrolle zu beweisen.'
          : 'Verifikationsdatei unter /.well-known/actionbridge-verify.txt veröffentlichen.',
    })),
    bridgeInstall: {
      mode: 'script_pending',
      snippet: `<script src="https://actionbridge.schwarzwald-agent.de/bridge.js" data-site-id="${record.id}" async></script>`,
    },
    capabilityChoices: [
      { name: 'site.knowledge.read', label: 'Website-Wissen lesen', riskLevel: 'read', requiresApproval: false },
      { name: 'lead.prepare_draft', label: 'Lead/Kontaktanfrage vorbereiten', riskLevel: 'write', requiresApproval: true },
      { name: 'appointment.request.prepare_draft', label: 'Terminwunsch vorbereiten', riskLevel: 'write', requiresApproval: true },
    ],
    expiresAt: record.expires_at,
  };
}

export function isActionBridgeSetupSessionUsable(record: Pick<ActionBridgeSetupSessionRecord, 'status' | 'expires_at'>): boolean {
  if (record.status === 'revoked' || record.status === 'expired' || record.status === 'completed') return false;
  return new Date(record.expires_at).getTime() > Date.now();
}
