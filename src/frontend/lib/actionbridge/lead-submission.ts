import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { redactActionBridgeValue } from './redaction';

export interface ActionBridgeLeadSubmissionDraft {
  actionName: 'lead.submit';
  deliveryMode: 'actionbridge_outbox';
  redactedLead: Record<string, unknown>;
  sourceOrigin?: string | null;
  sourcePath?: string | null;
  networkExecution: false;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 1000) : '';
}

function normalizeLeadSourceOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function normalizeLeadSourcePath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//')) return null;
  const pathOnly = trimmed.split(/[?#]/, 1)[0] || '/';
  return pathOnly.startsWith('/') ? pathOnly.slice(0, 300) : `/${pathOnly}`.slice(0, 300);
}

export function createActionBridgeLeadSubmissionDraft(input: unknown): ActionBridgeLeadSubmissionDraft | null {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const name = asString(source.name);
  const message = asString(source.message);
  const contact = asString(source.contact);
  const company = asString(source.company);
  if (!name || !message || !contact) return null;

  return {
    actionName: 'lead.submit',
    deliveryMode: 'actionbridge_outbox',
    redactedLead: redactActionBridgeValue({
      name,
      company: company || undefined,
      contact,
      message,
      source: source.source && typeof source.source === 'object' ? source.source : undefined,
    }) as Record<string, unknown>,
    sourceOrigin: normalizeLeadSourceOrigin(source.sourceOrigin),
    sourcePath: normalizeLeadSourcePath(source.sourcePath),
    networkExecution: false,
  };
}

export async function persistActionBridgeLeadSubmission(
  supabase: SupabaseClient,
  input: {
    userId: string;
    connectorId?: string | null;
    actionId?: string | null;
    approvalId: string;
    executionId?: string | null;
    leadInput: unknown;
  }
): Promise<{ submissionId: string | null; safeResult: Record<string, unknown> | null; error: string | null }> {
  const draft = createActionBridgeLeadSubmissionDraft(input.leadInput);
  if (!draft) return { submissionId: null, safeResult: null, error: 'invalid lead submission input' };

  const { data, error } = await (supabase as any)
    .from('actionbridge_lead_submissions')
    .insert({
      user_id: input.userId,
      connector_id: input.connectorId || null,
      action_id: input.actionId || null,
      approval_id: input.approvalId,
      execution_id: input.executionId || null,
      source_origin: draft.sourceOrigin || null,
      source_path: draft.sourcePath || null,
      status: 'queued',
      redacted_lead: draft.redactedLead,
      delivery_mode: draft.deliveryMode,
    })
    .select('id,status,delivery_mode,created_at')
    .single();

  if (error || !data) return { submissionId: null, safeResult: null, error: error?.message || 'lead submission persist failed' };

  return {
    submissionId: data.id,
    safeResult: {
      status: 'lead_submission_queued',
      leadSubmissionId: data.id,
      deliveryMode: data.delivery_mode,
      queuedAt: data.created_at,
      networkExecution: false,
      redactedLead: draft.redactedLead,
    },
    error: null,
  };
}
