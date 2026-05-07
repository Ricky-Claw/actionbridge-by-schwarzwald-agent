export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { decideActionBridgePolicy } from '@/lib/actionbridge/policy';
import { redactActionBridgeValue } from '@/lib/actionbridge/redaction';
import { consumeApprovedActionBridgeExecution, createActionBridgeApproval, persistActionBridgeAuditEvent, persistActionBridgeExecutionResult } from '@/lib/actionbridge/persistence';
import { getServerActionBridgePolicy } from '@/lib/actionbridge/server-policy';
import { createCoreServiceClient } from '@/lib/core/service-client';

async function requireActionBridgeUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { supabase, user: null, response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
  }
  return { supabase, user, response: null };
}

export async function POST(request: NextRequest) {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const requestedActionName = typeof body.actionName === 'string' ? body.actionName : 'unknown_action';
  const approvalId = typeof body.approvalId === 'string' ? body.approvalId : '';
  const idempotencyKey = typeof body.idempotencyKey === 'string'
    ? body.idempotencyKey
    : request.headers.get('Idempotency-Key') || '';

  if (approvalId) {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 160) {
      return NextResponse.json({ error: 'INVALID_IDEMPOTENCY_KEY' }, { status: 400 });
    }

    const serviceSupabase = createCoreServiceClient();
    if (!serviceSupabase) {
      return NextResponse.json({ error: 'ACTIONBRIDGE_EXECUTION_STATE_FAILED' }, { status: 503 });
    }

    const consumed = await consumeApprovedActionBridgeExecution(serviceSupabase, {
      userId: user!.id,
      approvalId,
      idempotencyKey,
    });

    if (consumed.error || !consumed.execution) {
      return NextResponse.json({
        error: 'ACTIONBRIDGE_APPROVAL_NOT_EXECUTABLE',
        reason: 'Approval is not approved, already consumed, rejected, expired, or missing.',
      }, { status: 409 });
    }

    const executionId = consumed.execution.executionId;
    const safeResult = consumed.execution.safeResult || {
      status: 'dry_run_succeeded',
      mode: 'approval_consumed_without_network_execution',
      actionName: consumed.execution.actionName,
      riskLevel: consumed.execution.riskLevel,
      networkExecution: false,
    };

    if (!consumed.execution.reused && consumed.execution.executionStatus === 'executing') {
      const persistedResult = await persistActionBridgeExecutionResult(serviceSupabase, {
        userId: user!.id,
        executionId,
        approvalId: consumed.execution.approvalId,
        status: 'succeeded',
        safeResult,
      });

      if (persistedResult.error) {
        return NextResponse.json({
          error: 'ACTIONBRIDGE_EXECUTION_RESULT_PERSIST_FAILED',
          decision: 'deny',
          executionId,
          networkExecution: false,
        }, { status: 503 });
      }
    }

    return NextResponse.json({
      decision: 'allow',
      status: consumed.execution.reused ? consumed.execution.executionStatus : 'succeeded',
      approvalId: consumed.execution.approvalId,
      executionId,
      idempotencyKey: consumed.execution.idempotencyKey,
      reused: consumed.execution.reused,
      result: safeResult,
    });
  }
  const serverPolicy = await getServerActionBridgePolicy(supabase, user!.id, requestedActionName);
  const { actionId, actionName, riskLevel, explicitAllow, approvalConfigured } = serverPolicy;
  const redactedInput = redactActionBridgeValue(body.input || {});
  const decision = decideActionBridgePolicy({
    tenantId: user!.id,
    userId: user!.id,
    agentId: typeof body.agentId === 'string' ? body.agentId : undefined,
    riskLevel,
    actionName,
    explicitAllow,
    approvalConfigured,
  });

  if (decision.decision === 'deny') {
    await persistActionBridgeAuditEvent(supabase, {
      userId: user!.id,
      actionId,
      actionName,
      riskLevel,
      input: body.input || {},
      decision: decision.decision,
      status: 'denied',
      resultSummary: { reason: decision.reason },
    });

    return NextResponse.json({ decision: decision.decision, reason: decision.reason, redactedInput }, { status: 403 });
  }

  if (decision.decision === 'approval_required') {
    const serviceSupabase = createCoreServiceClient();
    if (!serviceSupabase) {
      await persistActionBridgeAuditEvent(supabase, {
        userId: user!.id,
        actionId,
        actionName,
        riskLevel,
        input: body.input || {},
        decision: 'approval_required',
        status: 'failed',
        resultSummary: { reason: decision.reason, approvalError: 'missing service client' },
      });

      return NextResponse.json({
        error: 'ACTIONBRIDGE_APPROVAL_PERSIST_FAILED',
        decision: 'deny',
        reason: 'Approval could not be queued safely.',
        redactedInput,
      }, { status: 503 });
    }

    const approval = await createActionBridgeApproval(serviceSupabase, {
      userId: user!.id,
      actionId,
      actionName,
      riskLevel,
      input: body.input || {},
      decisionReason: decision.reason,
    });

    if (approval.error || !approval.id) {
      await persistActionBridgeAuditEvent(supabase, {
        userId: user!.id,
        actionId,
        actionName,
        riskLevel,
        input: body.input || {},
        decision: 'approval_required',
        status: 'failed',
        resultSummary: { reason: decision.reason, approvalError: approval.error || 'missing approval id' },
      });

      return NextResponse.json({
        error: 'ACTIONBRIDGE_APPROVAL_PERSIST_FAILED',
        decision: 'deny',
        reason: 'Approval could not be queued safely.',
        redactedInput,
      }, { status: 503 });
    }

    await persistActionBridgeAuditEvent(supabase, {
      userId: user!.id,
      actionId,
      approvalId: approval.id,
      actionName,
      riskLevel,
      input: body.input || {},
      decision: 'approval_required',
      status: 'pending',
      resultSummary: { reason: decision.reason, approvalError: approval.error },
    });

    return NextResponse.json({
      decision: 'approval_required',
      reason: decision.reason,
      approval: { id: approval.id, status: 'pending', actionName, riskLevel },
      redactedInput,
    }, { status: 202 });
  }

  await persistActionBridgeAuditEvent(supabase, {
    userId: user!.id,
    actionId,
    actionName,
    riskLevel,
    input: body.input || {},
    decision: 'allow',
    status: 'pending',
    resultSummary: { reason: decision.reason, status: 'ready_for_connector_execution' },
  });

  return NextResponse.json({
    decision: 'allow',
    reason: decision.reason,
    status: 'ready_for_connector_execution',
    redactedInput,
  });
}
