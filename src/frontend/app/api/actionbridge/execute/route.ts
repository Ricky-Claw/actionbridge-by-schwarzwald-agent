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
import { executeActionBridgeReadOnlyGet } from '@/lib/actionbridge/read-only-executor';
import { persistActionBridgeLeadSubmission } from '@/lib/actionbridge/lead-submission';
import { deliverActionBridgeWebhook } from '@/lib/actionbridge/webhook-delivery';
import { resolveActionBridgeWebhookSigningSecret } from '@/lib/actionbridge/webhook-signing';
import { decideActionBridgeWebhookDeliveryThrottle, recordActionBridgeWebhookFailureQuarantine } from '@/lib/actionbridge/rate-limit';
import { persistActionBridgeErrorEvent } from '@/lib/actionbridge/error-log';

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
      await persistActionBridgeErrorEvent(serviceSupabase, {
        userId: user!.id,
        approvalId,
        category: 'approval',
        severity: 'medium',
        errorCode: 'ACTIONBRIDGE_APPROVAL_NOT_EXECUTABLE',
        message: 'Approval execution was blocked because the approval was missing, expired, rejected, already consumed, or not approved.',
        context: { approvalId, consumedError: consumed.error },
      });
      return NextResponse.json({
        error: 'ACTIONBRIDGE_APPROVAL_NOT_EXECUTABLE',
        reason: 'Approval is not approved, already consumed, rejected, expired, or missing.',
      }, { status: 409 });
    }

    const executionId = consumed.execution.executionId;
    const approvalSnapshot = consumed.execution.safeResult?.approvalSnapshot && typeof consumed.execution.safeResult.approvalSnapshot === 'object'
      ? consumed.execution.safeResult.approvalSnapshot as Record<string, unknown>
      : {};
    let safeResult = consumed.execution.safeResult || {
      status: 'dry_run_noop',
      mode: 'policy_check_succeeded_without_execution',
      actionName: consumed.execution.actionName,
      riskLevel: consumed.execution.riskLevel,
      networkExecution: false,
    };
    let finalExecutionStatus: 'succeeded' | 'failed' = 'succeeded';

    if (!consumed.execution.reused && consumed.execution.executionStatus === 'executing' && consumed.execution.actionName === 'lead.submit') {
      const leadSubmission = await persistActionBridgeLeadSubmission(serviceSupabase, {
        userId: user!.id,
        connectorId: typeof approvalSnapshot.connectorId === 'string' ? approvalSnapshot.connectorId : null,
        actionId: consumed.execution.actionId,
        approvalId: consumed.execution.approvalId,
        executionId,
        leadInput: approvalSnapshot.redactedInput || {},
      });
      if (leadSubmission.error || !leadSubmission.safeResult) {
        await persistActionBridgeExecutionResult(serviceSupabase, {
          userId: user!.id,
          executionId,
          approvalId: consumed.execution.approvalId,
          status: 'failed',
          safeResult: {
            status: 'lead_submission_failed',
            reason: 'ActionBridge lead submission could not be persisted.',
            networkExecution: false,
          },
          errorCode: 'ACTIONBRIDGE_LEAD_SUBMISSION_FAILED',
        });
        return NextResponse.json({
          error: 'ACTIONBRIDGE_LEAD_SUBMISSION_FAILED',
          decision: 'deny',
          executionId,
          networkExecution: false,
        }, { status: 503 });
      }
      safeResult = leadSubmission.safeResult;

      const connectorId = typeof approvalSnapshot.connectorId === 'string' ? approvalSnapshot.connectorId : '';
      if (connectorId) {
        const { data: webhookConnector } = await (serviceSupabase as any)
          .from('actionbridge_connectors')
          .select('id,type,base_url,enabled,allowed_origins,network_execution_enabled,safety_status,permission_status,endpoint_path,webhook_signing_mode,secret_ref')
          .eq('user_id', user!.id)
          .eq('id', connectorId)
          .maybeSingle();
        const webhookControls = normalizeActionBridgeExecutionControls({
          networkExecutionEnabled: webhookConnector?.network_execution_enabled === true,
          safetyStatus: (webhookConnector?.safety_status || 'untested') as any,
          permissionStatus: (webhookConnector?.permission_status || 'draft') as any,
        });
        const webhookDecision = decideActionBridgeNetworkExecutionControls(webhookControls);
        if (webhookConnector?.type === 'webhook' && webhookDecision.allowed) {
          let webhookResult;
          const webhookDestinationOrigin = (() => {
            try { return new URL(webhookConnector.base_url).origin; } catch { return 'invalid-origin'; }
          })();
          const signingResolution = resolveActionBridgeWebhookSigningSecret({
            connectorId: webhookConnector.id,
            signingMode: webhookConnector.webhook_signing_mode === 'hmac_sha256' ? 'hmac_sha256' : 'unsigned_pilot',
            secretRef: webhookConnector.secret_ref,
          });
          const webhookThrottle = decideActionBridgeWebhookDeliveryThrottle({
            request,
            tenantId: user!.id,
            connectorId: webhookConnector.id,
            actionName: consumed.execution.actionName,
            destinationOrigin: webhookDestinationOrigin,
          });
          try {
            if (!signingResolution.ok) {
              webhookResult = {
                ok: false,
                status: 503,
                networkExecution: false,
                resultSummary: {
                  status: 'webhook_signing_secret_unresolved',
                  reason: 'Webhook signing secret reference is configured but unavailable server-side.',
                  signing: signingResolution.resultSummary,
                  networkExecution: false,
                },
              };
            } else if (!webhookThrottle.ok) {
              webhookResult = {
                ok: false,
                status: 429,
                networkExecution: false,
                resultSummary: {
                  status: 'webhook_rate_limited',
                  reason: 'Webhook-v1 pilot delivery throttle blocked this attempt.',
                  rateLimit: { policy: 'webhookDelivery', keyDigest: webhookThrottle.keyDigest, resetAt: webhookThrottle.resetAt, retryAfterSeconds: webhookThrottle.retryAfterSeconds },
                  networkExecution: false,
                },
              };
            } else {
              webhookResult = await deliverActionBridgeWebhook({
                connector: { id: webhookConnector.id, baseUrl: webhookConnector.base_url, enabled: webhookConnector.enabled === true },
                action: { id: consumed.execution.actionId, name: consumed.execution.actionName, riskLevel: consumed.execution.riskLevel },
                approval: { id: consumed.execution.approvalId, idempotencyKeyDigest: summarizeIdempotencyKey(consumed.execution.idempotencyKey) },
                tenantId: user!.id,
                executionId,
                payload: { leadSubmission: leadSubmission.safeResult },
                path: typeof webhookConnector.endpoint_path === 'string' ? webhookConnector.endpoint_path : '/',
                allowlist: parseServerActionBridgeAllowlist(webhookConnector.allowed_origins),
                signingSecret: signingResolution.signingSecret,
              });
              webhookResult.resultSummary = {
                ...webhookResult.resultSummary,
                signing: signingResolution.resultSummary,
              };
            }
          } catch (error) {
            webhookResult = {
              ok: false,
              status: 502,
              networkExecution: true,
              resultSummary: {
                status: 'webhook_delivery_error',
                reason: 'Webhook delivery failed closed before a successful response was recorded.',
                errorCode: error instanceof Error && error.message === 'ACTIONBRIDGE_WEBHOOK_TIMEOUT'
                  ? 'ACTIONBRIDGE_WEBHOOK_TIMEOUT'
                  : 'ACTIONBRIDGE_WEBHOOK_DELIVERY_FAILED',
                error: redactActionBridgeValue(error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) }),
                networkExecution: true,
              },
            };
          }
          if (!webhookResult.ok) {
            finalExecutionStatus = 'failed';
            await persistActionBridgeErrorEvent(serviceSupabase, {
              userId: user!.id,
              connectorId: webhookConnector.id,
              executionId,
              approvalId: consumed.execution.approvalId,
              category: webhookResult.status === 429 ? 'rate_limit' : 'webhook',
              severity: webhookResult.status === 429 ? 'low' : 'medium',
              errorCode: webhookResult.status === 429 ? 'ACTIONBRIDGE_WEBHOOK_RATE_LIMITED' : 'ACTIONBRIDGE_WEBHOOK_DELIVERY_FAILED',
              message: webhookResult.status === 429 ? 'Webhook-v1 delivery was throttled by pilot rate limits.' : 'Webhook-v1 delivery failed or returned a non-success response.',
              context: { webhook: webhookResult.resultSummary, destinationOrigin: webhookDestinationOrigin, actionName: consumed.execution.actionName },
            });
            const quarantine = recordActionBridgeWebhookFailureQuarantine({
              request,
              tenantId: user!.id,
              connectorId: webhookConnector.id,
              actionName: consumed.execution.actionName,
              destinationOrigin: webhookDestinationOrigin,
            });
            webhookResult.resultSummary = {
              ...webhookResult.resultSummary,
              quarantine: {
                policy: 'webhookFailureQuarantine',
                status: quarantine.ok ? 'recorded' : 'quarantine_required',
                keyDigest: quarantine.keyDigest,
                resetAt: quarantine.resetAt,
              },
            };
          }
          safeResult = {
            ...safeResult,
            webhook: webhookResult.resultSummary,
            networkExecution: webhookResult.networkExecution,
          };
        } else if (webhookConnector?.type === 'webhook') {
          safeResult = {
            ...safeResult,
            webhook: { status: 'webhook_blocked', reason: webhookDecision.reason, networkExecution: false },
            networkExecution: false,
          };
        }
      }
    }

    if (!consumed.execution.reused && consumed.execution.executionStatus === 'executing') {
      const persistedResult = await persistActionBridgeExecutionResult(serviceSupabase, {
        userId: user!.id,
        executionId,
        approvalId: consumed.execution.approvalId,
        status: finalExecutionStatus,
        safeResult,
        errorCode: finalExecutionStatus === 'failed' ? 'ACTIONBRIDGE_WEBHOOK_DELIVERY_FAILED' : undefined,
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
      decision: finalExecutionStatus === 'failed' ? 'deny' : 'allow',
      status: finalExecutionStatus === 'failed' ? 'execution_failed' : 'policy_check_succeeded_without_execution',
      operatorMessage: consumed.execution.actionName === 'lead.submit'
        ? 'Approved lead submitted to the ActionBridge lead outbox. No arbitrary external form post occurred.'
        : 'Approval consumed as a dry-run policy check. No network execution occurred.',
      networkExecution: Boolean(safeResult.networkExecution),
      approvalId: consumed.execution.approvalId,
      executionId,
      idempotencyKeyDigest: summarizeIdempotencyKey(consumed.execution.idempotencyKey),
      reused: consumed.execution.reused,
      result: { ...safeResult, networkExecution: Boolean(safeResult.networkExecution) },
    }, { status: finalExecutionStatus === 'failed' ? 502 : 200 });
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
      .select('id,name,description,risk_level,input_schema,output_description,enabled,requires_approval,connector_id')
      .eq('user_id', user!.id)
      .eq('id', actionId)
      .maybeSingle()
    : { data: null };
  const actionForPlan = actionRecord as { id?: string; name?: string; description?: string | null; risk_level?: any; input_schema?: any; output_description?: string | null; enabled?: boolean | null; requires_approval?: boolean | null; connector_id?: string | null } | null;

  const { data: connectorRecord } = actionForPlan?.connector_id
    ? await supabase
      .from('actionbridge_connectors')
      .select('id,type,base_url,enabled,allowed_origins,capabilities,network_execution_enabled,safety_status,permission_status')
      .eq('user_id', user!.id)
      .eq('id', actionForPlan.connector_id)
      .maybeSingle()
    : { data: null };
  const connectorForPlan = connectorRecord as { id?: string; type?: 'http' | 'website' | 'webhook' | null; base_url?: string; enabled?: boolean | null; allowed_origins?: unknown; capabilities?: unknown; network_execution_enabled?: boolean | null; safety_status?: string | null; permission_status?: string | null } | null;
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
      connector: { baseUrl: connectorForPlan.base_url, enabled: connectorForPlan.enabled === true, type: connectorForPlan.type || 'http' },
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
      connectorId: actionForPlan?.connector_id || null,
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
      operatorMessage: 'Approval queued. No external action has run.',
      networkExecution: false,
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

  if (networkExecutionControlDecision.allowed && actionForPlan && connectorForPlan?.base_url) {
    const readOnlyResult = await executeActionBridgeReadOnlyGet({
      connector: {
        id: connectorForPlan.id || '',
        baseUrl: connectorForPlan.base_url,
        enabled: connectorForPlan.enabled === true,
        type: connectorForPlan.type || 'http',
      },
      action: {
        id: actionForPlan.id || actionId || '',
        name: actionForPlan.name || actionName,
        riskLevel,
        enabled: actionForPlan.enabled === true,
      },
      input: body.input || {},
      path: requestedPath,
      allowlist,
    });

    await persistActionBridgeAuditEvent(supabase, {
      userId: user!.id,
      actionId,
      actionName,
      riskLevel,
      input: body.input || {},
      decision: readOnlyResult.ok ? 'allow' : 'deny',
      status: readOnlyResult.ok ? 'succeeded' : 'denied',
      resultSummary: {
        ...readOnlyResult.resultSummary,
        executionControls: networkExecutionControlDecision,
        responseLimits: summarizeActionBridgeResponseLimitPolicy(),
      },
    });

    return NextResponse.json({
      decision: readOnlyResult.ok ? 'allow' : 'deny',
      reason: readOnlyResult.ok ? decision.reason : String(readOnlyResult.resultSummary.reason || 'Read-only execution failed.'),
      status: readOnlyResult.ok ? 'read_only_executed' : 'read_only_blocked',
      operatorMessage: 'Read-only GET execution path. No writes, forms, browser/RPA, redirects, or credentials used.',
      networkExecution: readOnlyResult.networkExecution,
      result: readOnlyResult.resultSummary,
      redactedInput: readOnlyResult.redactedInput,
    }, { status: readOnlyResult.ok ? 200 : readOnlyResult.status });
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
    operatorMessage: 'Dry run only. No request was sent to the connector target.',
    networkExecution: false,
    result: dryRunResult,
    redactedInput,
  });
}
