export const dynamic = 'force-dynamic';

import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { decideActionBridgePolicy } from '@/lib/actionbridge/policy';
import { redactActionBridgeValue } from '@/lib/actionbridge/redaction';
import { consumeApprovedActionBridgeExecution, createActionBridgeApproval, persistActionBridgeAuditEvent, persistActionBridgeExecutionResult } from '@/lib/actionbridge/persistence';
import { getServerActionBridgePolicy } from '@/lib/actionbridge/server-policy';
import { createCoreServiceClient } from '@/lib/core/service-client';
import { createActionBridgeExecutionPlan } from '@/lib/actionbridge/execution-plan';
import { validateActionBridgeTarget, type ActionBridgeTargetAllowlistEntry } from '@/lib/actionbridge/target-validation';
import { decideActionBridgeNetworkExecutionControls, normalizeActionBridgeExecutionControls } from '@/lib/actionbridge/execution-controls';
import { actionBridgeAuditTaxonomy } from '@/lib/actionbridge/audit-taxonomy';
import { summarizeActionBridgeResponseLimitPolicy } from '@/lib/actionbridge/response-limits';

async function requireActionBridgeUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { supabase, user: null, response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
  }
  return { supabase, user, response: null };
}

function summarizeIdempotencyKey(idempotencyKey: string): string {
  return `sha256:${crypto.createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 16)}`;
}

function parseServerActionBridgeAllowlist(value: unknown): ActionBridgeTargetAllowlistEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ActionBridgeTargetAllowlistEntry[] => {
    if (typeof entry === 'string') {
      try {
        const origin = new URL(entry);
        if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return [];
        return [{ protocol: 'https:', hostname: origin.hostname, port: origin.port || undefined }];
      } catch {
        return [];
      }
    }
    if (!entry || typeof entry !== 'object') return [];
    const candidate = entry as { protocol?: unknown; hostname?: unknown; port?: unknown };
    if (candidate.protocol !== 'https:' || typeof candidate.hostname !== 'string' || !candidate.hostname.trim()) return [];
    return [{ protocol: 'https:', hostname: candidate.hostname.trim(), port: typeof candidate.port === 'string' ? candidate.port : undefined }];
  });
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
      status: 'dry_run_noop',
      mode: 'policy_check_succeeded_without_execution',
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
      status: 'policy_check_succeeded_without_execution',
      approvalId: consumed.execution.approvalId,
      executionId,
      idempotencyKeyDigest: summarizeIdempotencyKey(consumed.execution.idempotencyKey),
      reused: consumed.execution.reused,
      result: safeResult,
    });
  }
  const serverPolicy = await getServerActionBridgePolicy(supabase, user!.id, requestedActionName);
  const { actionId, actionName, riskLevel, explicitAllow, approvalConfigured } = serverPolicy;
  const redactedInput = redactActionBridgeValue(body.input || {});
  const requestedPath = typeof body.path === 'string' ? body.path : '/';
  // Fail closed: execution allowlists must come from server-controlled connector/policy storage,
  // never from the caller request body.
  const { data: actionRecord } = actionId
    ? await supabase
      .from('actionbridge_actions')
      .select('id,name,risk_level,enabled,connector_id')
      .eq('user_id', user!.id)
      .eq('id', actionId)
      .maybeSingle()
    : { data: null };
  const actionForPlan = actionRecord as { id?: string; name?: string; risk_level?: any; enabled?: boolean | null; connector_id?: string | null } | null;

  const { data: connectorRecord } = actionForPlan?.connector_id
    ? await supabase
      .from('actionbridge_connectors')
      .select('id,base_url,enabled,allowed_origins,capabilities,network_execution_enabled,safety_status,permission_status')
      .eq('user_id', user!.id)
      .eq('id', actionForPlan.connector_id)
      .maybeSingle()
    : { data: null };
  const connectorForPlan = connectorRecord as { id?: string; base_url?: string; enabled?: boolean | null; allowed_origins?: unknown; capabilities?: unknown; network_execution_enabled?: boolean | null; safety_status?: string | null; permission_status?: string | null } | null;
  const allowlist = parseServerActionBridgeAllowlist(connectorForPlan?.allowed_origins);
  const networkExecutionControls = normalizeActionBridgeExecutionControls({
    networkExecutionEnabled: connectorForPlan?.network_execution_enabled === true,
    safetyStatus: (connectorForPlan?.safety_status || 'untested') as any,
    permissionStatus: (connectorForPlan?.permission_status || 'draft') as any,
  });
  const networkExecutionControlDecision = decideActionBridgeNetworkExecutionControls(networkExecutionControls);

  const targetValidation = connectorForPlan?.base_url
    ? validateActionBridgeTarget({ connector: { baseUrl: connectorForPlan.base_url }, path: requestedPath, allowlist })
    : { ok: false, reason: 'Connector target is missing.', networkExecution: false as const };

  const executionPlan = actionForPlan && connectorForPlan?.base_url
    ? createActionBridgeExecutionPlan({
      connector: { baseUrl: connectorForPlan.base_url, enabled: connectorForPlan.enabled === true },
      action: { id: actionForPlan.id || actionId || '', name: actionForPlan.name || actionName, riskLevel, enabled: actionForPlan.enabled === true },
      input: body.input || {},
      path: requestedPath,
      allowlist,
    })
    : null;
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

  if (!executionPlan || !targetValidation.ok || !executionPlan.readOnly || !executionPlan.targetAllowed) {
    const reason = executionPlan?.redactedResultSummary?.reason || targetValidation.reason || 'ActionBridge execution plan is not safely runnable.';
    await persistActionBridgeAuditEvent(supabase, {
      userId: user!.id,
      actionId,
      actionName,
      riskLevel,
      input: body.input || {},
      decision: 'deny',
      status: 'denied',
      resultSummary: {
        status: 'dry_run_blocked',
        reason,
        readOnly: executionPlan?.readOnly ?? false,
        targetAllowed: executionPlan?.targetAllowed ?? false,
        networkExecution: false,
        executionControls: networkExecutionControlDecision,
        auditCode: actionBridgeAuditTaxonomy.targetBlocked.code,
      },
    });

    return NextResponse.json({
      decision: 'deny',
      reason,
      status: 'dry_run_blocked',
      networkExecution: false,
      result: executionPlan?.redactedResultSummary || { status: 'dry_run_blocked', reason, networkExecution: false },
      executionControls: networkExecutionControlDecision,
      redactedInput,
    }, { status: 403 });
  }

  const dryRunResult = {
    ...executionPlan.redactedResultSummary,
    status: 'dry_run_noop',
    mode: 'policy_check_succeeded_without_execution',
    reason: decision.reason,
    networkExecution: false,
    executionControls: networkExecutionControlDecision,
    responseLimits: summarizeActionBridgeResponseLimitPolicy(),
    auditCode: actionBridgeAuditTaxonomy.dryRunNoop.code,
  };

  await persistActionBridgeAuditEvent(supabase, {
    userId: user!.id,
    actionId,
    actionName,
    riskLevel,
    input: body.input || {},
    decision: 'allow',
    status: 'succeeded',
    resultSummary: dryRunResult,
  });

  return NextResponse.json({
    decision: 'allow',
    reason: decision.reason,
    status: 'dry_run_noop',
    networkExecution: false,
    result: dryRunResult,
    redactedInput,
  });
}
