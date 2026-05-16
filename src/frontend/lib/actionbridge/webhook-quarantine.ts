import 'server-only';

import { redactActionBridgeValue } from './redaction';

export type ActionBridgeConnectorQuarantineStatus = 'active' | 'resolved';
export type ActionBridgeConnectorQuarantineReason = 'webhook_repeated_failures' | 'operator_pause' | 'system_pause';

export interface ActionBridgeConnectorQuarantineView {
  id: string;
  connectorId: string;
  status: ActionBridgeConnectorQuarantineStatus;
  reasonCode: ActionBridgeConnectorQuarantineReason;
  message: string;
  failureCount: number;
  redactedContext: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export function toActionBridgeConnectorQuarantineView(row: any): ActionBridgeConnectorQuarantineView {
  return {
    id: String(row.id),
    connectorId: String(row.connector_id),
    status: row.status === 'resolved' ? 'resolved' : 'active',
    reasonCode: row.reason_code === 'operator_pause' || row.reason_code === 'system_pause'
      ? row.reason_code
      : 'webhook_repeated_failures',
    message: typeof row.message === 'string' ? row.message : 'Connector is temporarily paused by ActionBridge controls.',
    failureCount: Number.isFinite(Number(row.failure_count)) ? Number(row.failure_count) : 0,
    redactedContext: redactActionBridgeValue(row.redacted_context || {}) as Record<string, unknown>,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
  };
}

export async function getActiveActionBridgeConnectorQuarantine(serviceSupabase: any, input: {
  userId: string;
  connectorId: string;
}): Promise<{ quarantined: boolean; quarantine: ActionBridgeConnectorQuarantineView | null; error?: string }> {
  const { data, error } = await serviceSupabase
    .from('actionbridge_connector_quarantine')
    .select('id, connector_id, status, reason_code, message, redacted_context, failure_count, created_at, updated_at, resolved_at')
    .eq('user_id', input.userId)
    .eq('connector_id', input.connectorId)
    .eq('status', 'active')
    .maybeSingle();

  if (error) return { quarantined: false, quarantine: null, error: 'ACTIONBRIDGE_CONNECTOR_QUARANTINE_LOOKUP_FAILED' };
  if (!data) return { quarantined: false, quarantine: null };
  return { quarantined: true, quarantine: toActionBridgeConnectorQuarantineView(data) };
}

export async function persistActionBridgeWebhookFailureQuarantine(serviceSupabase: any, input: {
  userId: string;
  connectorId: string;
  failureCount: number;
  context: Record<string, unknown>;
}): Promise<{ ok: boolean; quarantine: ActionBridgeConnectorQuarantineView | null; error?: string }> {
  const now = new Date().toISOString();
  const redactedContext = redactActionBridgeValue(input.context) as Record<string, unknown>;
  const active = await getActiveActionBridgeConnectorQuarantine(serviceSupabase, input);
  const query = active.quarantine
    ? serviceSupabase
      .from('actionbridge_connector_quarantine')
      .update({
        message: 'Webhook-v1 delivery is paused after repeated pilot failures. Review receiver health before resuming.',
        redacted_context: redactedContext,
        failure_count: Math.max(input.failureCount, active.quarantine.failureCount + 1),
        updated_at: now,
        resolved_at: null,
      })
      .eq('user_id', input.userId)
      .eq('connector_id', input.connectorId)
      .eq('status', 'active')
    : serviceSupabase
      .from('actionbridge_connector_quarantine')
      .insert({
        user_id: input.userId,
        connector_id: input.connectorId,
        status: 'active',
        reason_code: 'webhook_repeated_failures',
        message: 'Webhook-v1 delivery is paused after repeated pilot failures. Review receiver health before resuming.',
        redacted_context: redactedContext,
        failure_count: Math.max(1, Math.min(10_000, input.failureCount)),
        updated_at: now,
        resolved_at: null,
      });

  const { data, error } = await query
    .select('id, connector_id, status, reason_code, message, redacted_context, failure_count, created_at, updated_at, resolved_at')
    .single();

  if (error || !data) return { ok: false, quarantine: null, error: 'ACTIONBRIDGE_CONNECTOR_QUARANTINE_PERSIST_FAILED' };
  return { ok: true, quarantine: toActionBridgeConnectorQuarantineView(data) };
}
