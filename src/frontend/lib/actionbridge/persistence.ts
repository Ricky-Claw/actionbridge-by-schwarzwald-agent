import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActionBridgeDecision, ActionBridgeRiskLevel } from './types';
import { actionBridgeAuditTaxonomy } from './audit-taxonomy';
import { redactActionBridgeValue } from './redaction';
import { persistActionBridgeErrorEvent } from './error-log';

interface ActionBridgePersistenceBase {
  userId: string;
  actionId?: string | null;
  connectorId?: string | null;
  actionName: string;
  riskLevel: ActionBridgeRiskLevel;
  input: unknown;
}

export interface PersistActionBridgeAuditEventInput extends ActionBridgePersistenceBase {
  approvalId?: string | null;
  decision: ActionBridgeDecision;
  status: 'pending' | 'succeeded' | 'failed' | 'denied';
  resultSummary?: Record<string, unknown> | null;
  latencyMs?: number | null;
}

export interface CreateActionBridgeApprovalInput extends ActionBridgePersistenceBase {
  decisionReason?: string | null;
}

export interface ConsumeApprovedActionBridgeExecutionInput {
  userId: string;
  approvalId: string;
  idempotencyKey: string;
}

export interface ConsumedActionBridgeExecution {
  executionId: string;
  approvalId: string;
  actionId: string | null;
  actionName: string;
  riskLevel: ActionBridgeRiskLevel;
  executionStatus: 'executing' | 'succeeded' | 'failed';
  idempotencyKey: string;
  safeResult: Record<string, unknown> | null;
  reused: boolean;
}

export interface PersistActionBridgeExecutionResultInput {
  userId: string;
  executionId: string;
  approvalId: string;
  status: 'succeeded' | 'failed';
  safeResult?: Record<string, unknown> | null;
  errorCode?: string | null;
}

export interface PersistActionBridgeControlAuditEventInput {
  userId: string;
  connectorId?: string | null;
  eventName: string;
  input?: unknown;
  status: 'pending' | 'succeeded' | 'failed' | 'denied';
  resultSummary?: Record<string, unknown> | null;
}

export async function createActionBridgeApproval(
  supabase: SupabaseClient,
  input: CreateActionBridgeApprovalInput
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from('actionbridge_approvals')
    .insert({
      user_id: input.userId,
      action_id: input.actionId || null,
      connector_id: input.connectorId || null,
      action_name: input.actionName,
      risk_level: input.riskLevel,
      redacted_input: redactActionBridgeValue(input.input),
      action_snapshot: {
        actionId: input.actionId || null,
        connectorId: input.connectorId || null,
        actionName: input.actionName,
        riskLevel: input.riskLevel,
        redactedInput: redactActionBridgeValue(input.input),
        networkExecution: false,
      },
      status: 'pending',
      decision_reason: input.decisionReason || null,
    })
    .select('id')
    .single();

  if (error) return { id: null, error: error.message };
  return { id: (data as { id?: string } | null)?.id || null, error: null };
}

export async function persistActionBridgeAuditEvent(
  supabase: SupabaseClient,
  input: PersistActionBridgeAuditEventInput
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('actionbridge_audit_logs')
    .insert({
      user_id: input.userId,
      action_id: input.actionId || null,
      approval_id: input.approvalId || null,
      action_name: input.actionName,
      risk_level: input.riskLevel,
      decision: input.decision,
      status: input.status,
      redacted_input: redactActionBridgeValue(input.input),
      result_summary: input.resultSummary || null,
      latency_ms: input.latencyMs || null,
    });

  return { error: error?.message || null };
}

export async function persistActionBridgeControlAuditEvent(
  supabase: SupabaseClient,
  input: PersistActionBridgeControlAuditEventInput
): Promise<{ error: string | null }> {
  return persistActionBridgeAuditEvent(supabase, {
    userId: input.userId,
    connectorId: input.connectorId || null,
    actionName: input.eventName,
    riskLevel: 'read',
    input: input.input || {},
    decision: input.status === 'denied' || input.status === 'failed' ? 'deny' : 'allow',
    status: input.status,
    resultSummary: {
      ...(input.resultSummary || {}),
      controlPlane: true,
      networkExecution: false,
    },
  });
}

// DB RPC enforces: only approved approvals enter executing; rejected/expired never execute.
export async function consumeApprovedActionBridgeExecution(
  supabase: SupabaseClient,
  input: ConsumeApprovedActionBridgeExecutionInput
): Promise<{ execution: ConsumedActionBridgeExecution | null; error: string | null }> {
  const { data, error } = await (supabase as any)
    .rpc('consume_actionbridge_approval_for_execution', {
      p_user_id: input.userId,
      p_approval_id: input.approvalId,
      p_idempotency_key: input.idempotencyKey,
    });

  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return { execution: null, error: error?.message || 'approval not executable' };

  return {
    execution: {
      executionId: row.execution_id,
      approvalId: row.approval_id,
      actionId: row.action_id || null,
      actionName: row.action_name,
      riskLevel: row.risk_level,
      executionStatus: row.execution_status,
      idempotencyKey: row.idempotency_key,
      safeResult: row.safe_result || null,
      reused: Boolean(row.reused),
    },
    error: null,
  };
}

export async function persistActionBridgeExecutionResult(
  supabase: SupabaseClient,
  input: PersistActionBridgeExecutionResultInput
): Promise<{ error: string | null }> {
  const { data, error } = await (supabase as any)
    .from('actionbridge_executions')
    .update({
      execution_status: input.status,
      safe_result: input.safeResult || null,
      error_code: input.errorCode || null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', input.userId)
    .eq('id', input.executionId)
    .eq('approval_id', input.approvalId)
    .select('user_id,action_id,approval_id,action_name,risk_level,redacted_input,safe_result,error_code')
    .single();

  if (error || !data) return { error: error?.message || 'execution result update failed' };

  const row = data as {
    user_id: string;
    action_id: string | null;
    approval_id: string;
    action_name: string;
    risk_level: ActionBridgeRiskLevel;
    redacted_input: unknown;
    safe_result: Record<string, unknown> | null;
    error_code: string | null;
  };

  const audit = await persistActionBridgeAuditEvent(supabase, {
    userId: row.user_id,
    actionId: row.action_id,
    approvalId: row.approval_id,
    actionName: row.action_name,
    riskLevel: row.risk_level,
    input: row.redacted_input || {},
    decision: input.status === 'succeeded' ? 'allow' : 'deny',
    status: input.status,
    resultSummary: {
      ...(row.safe_result || {}),
      errorCode: row.error_code || undefined,
      executionId: input.executionId,
      auditCode: input.status === 'succeeded'
        ? actionBridgeAuditTaxonomy.executionResultPersisted.code
        : actionBridgeAuditTaxonomy.executionPersistFailed.code,
      networkExecution: false,
    },
  });

  if (input.status === 'failed') {
    await persistActionBridgeErrorEvent(supabase, {
      userId: row.user_id,
      executionId: input.executionId,
      approvalId: row.approval_id,
      category: row.error_code?.includes('WEBHOOK') ? 'webhook' : 'execution',
      severity: row.error_code?.includes('WEBHOOK') ? 'medium' : 'high',
      errorCode: row.error_code || input.errorCode || 'ACTIONBRIDGE_EXECUTION_FAILED',
      message: 'ActionBridge execution failed. Check redacted context and audit trail.',
      context: { actionName: row.action_name, riskLevel: row.risk_level, safeResult: row.safe_result, errorCode: row.error_code || input.errorCode },
    });
  }

  return { error: audit.error };
}
