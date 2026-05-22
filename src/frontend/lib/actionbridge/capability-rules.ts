import 'server-only';

import type { ActionBridgeInputField, ActionBridgeRiskLevel } from './types';
import { sanitizeActionBridgeInputSchema, sanitizeActionBridgeSchemaText } from './schema-safety';

export type ActionBridgeCapabilityName = 'site.knowledge.read' | 'lead.prepare_draft' | 'lead.submit' | 'appointment.request.prepare_draft';

export interface ActionBridgeCapabilityRule {
  id: string;
  tenantId: string;
  connectorId: string;
  name: ActionBridgeCapabilityName;
  riskLevel: Extract<ActionBridgeRiskLevel, 'read' | 'write'>;
  enabled: boolean;
  requiresApproval: boolean;
  config?: Record<string, unknown>;
}

export interface ActionBridgeCapabilityDefinition {
  name: ActionBridgeCapabilityName;
  description: string;
  riskLevel: Extract<ActionBridgeRiskLevel, 'read' | 'write'>;
  requiresApproval: boolean;
  inputSchema: ActionBridgeInputField[];
  outputDescription: string;
}

export const ACTIONBRIDGE_CAPABILITY_DEFINITIONS: Record<ActionBridgeCapabilityName, ActionBridgeCapabilityDefinition> = {
  'site.knowledge.read': {
    name: 'site.knowledge.read',
    description: 'Read approved public site knowledge from a verified ActionBridge origin.',
    riskLevel: 'read',
    requiresApproval: false,
    inputSchema: [
      { name: 'query', type: 'string', required: true, description: 'Customer question or public content lookup topic.' },
      { name: 'path', type: 'string', required: false, description: 'Optional same-origin public path to inspect.' },
    ],
    outputDescription: 'A redacted, public-knowledge answer with source path metadata. No private data or writes.',
  },
  'lead.prepare_draft': {
    name: 'lead.prepare_draft',
    description: 'Prepare a lead-capture draft for human/customer approval. Does not submit forms.',
    riskLevel: 'write',
    requiresApproval: true,
    inputSchema: [
      { name: 'name', type: 'string', required: true, description: 'Lead display name.' },
      { name: 'message', type: 'string', required: true, description: 'Lead request text to draft.' },
      { name: 'contact', type: 'string', required: false, description: 'Optional customer-provided contact detail, redacted in logs.' },
    ],
    outputDescription: 'Approval-gated draft payload only. No CRM write and no form submission.',
  },
  'lead.submit': {
    name: 'lead.submit',
    description: 'Submit an approved lead into the ActionBridge lead outbox. Does not post to arbitrary third-party forms.',
    riskLevel: 'write',
    requiresApproval: true,
    inputSchema: [
      { name: 'name', type: 'string', required: true, description: 'Lead display name.' },
      { name: 'contact', type: 'string', required: true, description: 'Customer-provided contact detail, redacted in logs.' },
      { name: 'message', type: 'string', required: true, description: 'Lead request text.' },
      { name: 'company', type: 'string', required: false, description: 'Optional company name.' },
    ],
    outputDescription: 'Approval-gated ActionBridge lead outbox record. No arbitrary external form submission.',
  },
  'appointment.request.prepare_draft': {
    name: 'appointment.request.prepare_draft',
    description: 'Prepare an appointment request draft for approval. Does not write to a calendar.',
    riskLevel: 'write',
    requiresApproval: true,
    inputSchema: [
      { name: 'requestedWindow', type: 'string', required: true, description: 'Requested appointment time window.' },
      { name: 'topic', type: 'string', required: true, description: 'Appointment topic.' },
      { name: 'notes', type: 'string', required: false, description: 'Optional context for the human approver.' },
    ],
    outputDescription: 'Approval-gated appointment draft only. No booking, payment, notification send, or event creation.',
  },
};

export function isActionBridgeCapabilityName(value: unknown): value is ActionBridgeCapabilityName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ACTIONBRIDGE_CAPABILITY_DEFINITIONS, value);
}

export function normalizeActionBridgeCapabilityRuleInput(input: {
  connectorId: unknown;
  name: unknown;
  enabled?: unknown;
  config?: unknown;
}): { connectorId: string; name: ActionBridgeCapabilityName; enabled: boolean; riskLevel: 'read' | 'write'; requiresApproval: boolean; config: Record<string, unknown> } | null {
  const connectorId = typeof input.connectorId === 'string' ? input.connectorId.trim() : '';
  if (!connectorId || !isActionBridgeCapabilityName(input.name)) return null;
  const definition = ACTIONBRIDGE_CAPABILITY_DEFINITIONS[input.name];
  const rawConfig = input.config && typeof input.config === 'object' && !Array.isArray(input.config) ? input.config as Record<string, unknown> : {};
  const config = Object.fromEntries(Object.entries(rawConfig).slice(0, 20).map(([key, value]) => [
    (sanitizeActionBridgeSchemaText(key, 80) || '').slice(0, 80),
    typeof value === 'string' ? (sanitizeActionBridgeSchemaText(value, 500) || '').slice(0, 500) : value,
  ]));
  return {
    connectorId,
    name: input.name,
    enabled: input.enabled === true,
    riskLevel: definition.riskLevel,
    requiresApproval: definition.riskLevel !== 'read' || definition.requiresApproval,
    config,
  };
}

export function compileActionBridgeCapabilityTool(input: {
  id: string;
  tenantId: string;
  connectorId: string;
  name: ActionBridgeCapabilityName;
  enabled: boolean;
}): {
  id: string;
  tenantId: string;
  connectorId: string;
  name: string;
  description: string;
  riskLevel: 'read' | 'write';
  requiresApproval: boolean;
  enabled: boolean;
  inputSchema: ActionBridgeInputField[];
  outputDescription: string;
} {
  const definition = ACTIONBRIDGE_CAPABILITY_DEFINITIONS[input.name];
  return {
    id: input.id,
    tenantId: input.tenantId,
    connectorId: input.connectorId,
    name: definition.name,
    description: definition.description,
    riskLevel: definition.riskLevel,
    requiresApproval: definition.riskLevel !== 'read' || definition.requiresApproval,
    enabled: input.enabled,
    inputSchema: sanitizeActionBridgeInputSchema(definition.inputSchema) || [],
    outputDescription: definition.outputDescription,
  };
}
