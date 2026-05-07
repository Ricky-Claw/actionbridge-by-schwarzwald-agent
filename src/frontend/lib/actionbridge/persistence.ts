import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActionBridgeDecision, ActionBridgeRiskLevel } from './types';
import { redactActionBridgeValue } from './redaction';

interface ActionBridgePersistenceBase {
  userId: string;
  actionId?: string | null;
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

export async function createActionBridgeApproval(
  supabase: SupabaseClient,
  input: CreateActionBridgeApprovalInput
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from('actionbridge_approvals')
    .insert({
      user_id: input.userId,
      action_id: input.actionId || null,
      action_name: input.actionName,
      risk_level: input.riskLevel,
      redacted_input: redactActionBridgeValue(input.input),
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
  const { error } = await (supabase as any)
    .from('actionbridge_executions')
    .update({
      execution_status: input.status,
      safe_result: input.safeResult || null,
      error_code: input.errorCode || null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', input.userId)
    .eq('id', input.executionId)
    .eq('approval_id', input.approvalId);

  return { error: error?.message || null };
}
