import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { redactActionBridgeValue } from './redaction';

export type ActionBridgeErrorCategory = 'setup' | 'verification' | 'approval' | 'execution' | 'webhook' | 'rate_limit' | 'system';
export type ActionBridgeErrorSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type ActionBridgeErrorStatus = 'open' | 'acknowledged' | 'resolved';

export interface PersistActionBridgeErrorEventInput {
  userId: string;
  connectorId?: string | null;
  executionId?: string | null;
  approvalId?: string | null;
  category: ActionBridgeErrorCategory;
  severity: ActionBridgeErrorSeverity;
  errorCode: string;
  message: string;
  context?: unknown;
}

export interface ActionBridgeErrorLogView {
  id: string;
  connectorId: string | null;
  executionId: string | null;
  approvalId: string | null;
  category: ActionBridgeErrorCategory;
  severity: ActionBridgeErrorSeverity;
  errorCode: string;
  message: string;
  redactedContext: Record<string, unknown>;
  status: ActionBridgeErrorStatus;
  createdAt: string;
  resolvedAt: string | null;
}

const ERROR_CONTEXT_LIMITS = {
  maxDepth: 4,
  maxKeys: 24,
  maxArrayItems: 20,
  maxStringLength: 500,
};

export function normalizeActionBridgeErrorSeverity(value: unknown): ActionBridgeErrorSeverity | null {
  return value === 'info' || value === 'low' || value === 'medium' || value === 'high' || value === 'critical' ? value : null;
}

export function normalizeActionBridgeErrorCategory(value: unknown): ActionBridgeErrorCategory | null {
  return value === 'setup' || value === 'verification' || value === 'approval' || value === 'execution' || value === 'webhook' || value === 'rate_limit' || value === 'system' ? value : null;
}

export function normalizeActionBridgeErrorStatus(value: unknown): ActionBridgeErrorStatus | null {
  return value === 'open' || value === 'acknowledged' || value === 'resolved' ? value : null;
}

export function sanitizeActionBridgeErrorContext(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value ?? null;
  if (typeof value === 'string') return value.length > ERROR_CONTEXT_LIMITS.maxStringLength ? `${value.slice(0, ERROR_CONTEXT_LIMITS.maxStringLength)}…[truncated]` : value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return '[unsupported]';
  if (depth >= ERROR_CONTEXT_LIMITS.maxDepth) return '[max_depth_reached]';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, ERROR_CONTEXT_LIMITS.maxArrayItems).map((entry) => sanitizeActionBridgeErrorContext(entry, depth + 1, seen));
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, ERROR_CONTEXT_LIMITS.maxKeys)
      .map(([key, entry]) => [key.slice(0, 80), sanitizeActionBridgeErrorContext(entry, depth + 1, seen)])
  );
}

export async function persistActionBridgeErrorEvent(
  supabase: SupabaseClient,
  input: PersistActionBridgeErrorEventInput
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await (supabase as any)
    .from('actionbridge_error_logs')
    .insert({
      user_id: input.userId,
      connector_id: input.connectorId || null,
      execution_id: input.executionId || null,
      approval_id: input.approvalId || null,
      category: input.category,
      severity: input.severity,
      error_code: input.errorCode,
      message: input.message.slice(0, 500),
      redacted_context: redactActionBridgeValue(sanitizeActionBridgeErrorContext(input.context || {})),
      status: 'open',
    })
    .select('id')
    .single();

  return { id: (data as { id?: string } | null)?.id || null, error: error?.message || null };
}

export function toActionBridgeErrorLogView(row: any): ActionBridgeErrorLogView {
  return {
    id: row.id,
    connectorId: row.connector_id || null,
    executionId: row.execution_id || null,
    approvalId: row.approval_id || null,
    category: row.category,
    severity: row.severity,
    errorCode: row.error_code,
    message: row.message,
    redactedContext: redactActionBridgeValue(sanitizeActionBridgeErrorContext(row.redacted_context || {})) as Record<string, unknown>,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at || null,
  };
}
