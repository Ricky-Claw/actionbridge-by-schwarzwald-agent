import 'server-only';

import { isPrivateActionBridgeHost } from './http-connector';
import { redactActionBridgeValue } from './redaction';
import { sanitizeActionBridgeSchemaText } from './schema-safety';
import type { ActionBridgeConnector, ActionBridgeInputField, ActionBridgeRiskLevel } from './types';

export interface ActionBridgeSetupInput {
  name?: unknown;
  type?: unknown;
  baseUrl?: unknown;
  base_url?: unknown;
  allowedOrigins?: unknown;
  allowed_origins?: unknown;
  purpose?: unknown;
}

export interface ActionBridgeSuggestedAction {
  name: string;
  description: string;
  riskLevel: ActionBridgeRiskLevel;
  requiresApproval: boolean;
  inputSchema: ActionBridgeInputField[];
  outputDescription: string;
  executorType: 'profile_draft' | 'website_public_read' | 'website_form_draft';
  networkExecution: false;
}

export interface ActionBridgeConnectorProfile {
  name: string;
  type: ActionBridgeConnector['type'];
  baseUrl: string;
  allowedOrigins: string[];
  capabilities: string[];
  suggestedActions: ActionBridgeSuggestedAction[];
  authMode: 'none';
  networkExecutionEnabled: false;
  safetyStatus: 'untested';
  permissionStatus: 'draft';
  redactedInput: unknown;
  networkExecution: false;
}

function normalizeSetupText(value: unknown, fallback: string, maxLength = 120): string | null {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return null;
  const text = sanitizeActionBridgeSchemaText(value, maxLength);
  if (!text) return null;
  return text;
}

function normalizeOrigin(value: string): string | null {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value);
  } catch {
    return null;
  }
  if (parsedUrl.protocol !== 'https:') return null;
  if (parsedUrl.username || parsedUrl.password) return null;
  if (parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) return null;
  if (isPrivateActionBridgeHost(parsedUrl.hostname)) return null;
  return parsedUrl.origin;
}

function normalizeBaseUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value);
  } catch {
    return null;
  }
  if (parsedUrl.protocol !== 'https:') return null;
  if (parsedUrl.username || parsedUrl.password) return null;
  if (isPrivateActionBridgeHost(parsedUrl.hostname)) return null;
  return parsedUrl;
}

function normalizeAllowedOrigins(value: unknown, defaultOrigin: string): string[] | null {
  if (value === undefined || value === null) return [defaultOrigin];
  if (!Array.isArray(value)) return null;
  const origins = new Set<string>([defaultOrigin]);
  for (const entry of value) {
    if (typeof entry !== 'string') return null;
    const origin = normalizeOrigin(entry);
    if (!origin) return null;
    origins.add(origin);
  }
  return [...origins];
}

export function normalizeActionBridgeSetupProfile(input: ActionBridgeSetupInput): ActionBridgeConnectorProfile | null {
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? input.base_url);
  if (!baseUrl) return null;

  const type = input.type === 'http' ? 'http' : 'website';
  const name = normalizeSetupText(input.name, baseUrl.hostname);
  if (!name) return null;

  const allowedOrigins = normalizeAllowedOrigins(input.allowedOrigins ?? input.allowed_origins, baseUrl.origin);
  if (!allowedOrigins) return null;

  const capabilities = type === 'website'
    ? ['public_page_extract', 'same_origin_route_discovery', 'metadata_extract', 'form_inventory', 'no_form_submit', 'networkExecution:false']
    : ['http_action_draft', 'networkExecution:false'];

  return {
    name,
    type,
    baseUrl: baseUrl.toString(),
    allowedOrigins,
    capabilities,
    suggestedActions: [
      {
        name: type === 'website' ? 'website.public.read' : 'connector.public.read',
        description: 'Read public/approved information through an ActionBridge dry-run profile. No live execution is enabled in this setup slice.',
        riskLevel: 'read',
        requiresApproval: false,
        inputSchema: [
          { name: 'query', type: 'string', required: false, description: 'Question or lookup intent for the approved connector profile.' },
        ],
        outputDescription: 'Agent-safe public/profile answer draft with redacted output.',
        executorType: type === 'website' ? 'website_public_read' : 'profile_draft',
        networkExecution: false,
      },
      {
        name: type === 'website' ? 'website.contact.prepare_draft' : 'connector.request.prepare_draft',
        description: 'Prepare a customer request draft. The action does not submit forms or send network requests.',
        riskLevel: 'write',
        requiresApproval: true,
        inputSchema: [
          { name: 'name', type: 'string', required: true, description: 'Customer name.' },
          { name: 'email', type: 'string', required: true, description: 'Customer email address.' },
          { name: 'message', type: 'string', required: true, description: 'Request details.' },
        ],
        outputDescription: 'Draft payload for human review; no submit/send execution.',
        executorType: type === 'website' ? 'website_form_draft' : 'profile_draft',
        networkExecution: false,
      },
    ],
    authMode: 'none',
    networkExecutionEnabled: false,
    safetyStatus: 'untested',
    permissionStatus: 'draft',
    redactedInput: redactActionBridgeValue(input),
    networkExecution: false,
  };
}
