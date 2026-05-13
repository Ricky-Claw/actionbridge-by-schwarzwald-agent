import type { ActionBridgeActionDefinition, ActionBridgeConnector } from './types';
import { redactActionBridgeValue } from './redaction';
import { validateActionBridgeTarget, type ActionBridgeTargetAllowlistEntry } from './target-validation';
import { createActionBridgeWebsiteExtractPlan } from './website-connector';

export interface CreateActionBridgeExecutionPlanInput {
  connector: Pick<ActionBridgeConnector, 'baseUrl' | 'enabled' | 'type'>;
  action: Pick<ActionBridgeActionDefinition, 'id' | 'name' | 'riskLevel' | 'enabled'>;
  input: Record<string, unknown>;
  path?: string;
  allowlist?: ActionBridgeTargetAllowlistEntry[];
}

export interface ActionBridgeExecutionPlan {
  actionId: string;
  actionName: string;
  riskLevel: ActionBridgeActionDefinition['riskLevel'];
  readOnly: boolean;
  dryRun: true;
  networkExecution: false;
  targetAllowed: boolean;
  redactedInput: unknown;
  redactedResultSummary: Record<string, unknown>;
}

export function classifyActionBridgeAction(
  riskLevel: ActionBridgeActionDefinition['riskLevel']
): { readOnly: boolean; requiresApproval: boolean } {
  if (riskLevel === 'read') {
    return { readOnly: true, requiresApproval: false };
  }
  return { readOnly: false, requiresApproval: true };
}

export function createActionBridgeExecutionPlan(
  input: CreateActionBridgeExecutionPlanInput
): ActionBridgeExecutionPlan {
  const classification = classifyActionBridgeAction(input.action.riskLevel);
  const target = validateActionBridgeTarget({
    connector: input.connector,
    path: input.path,
    allowlist: input.allowlist,
  });
  const redactedInput = redactActionBridgeValue(input.input);
  const websitePlan = input.connector.type === 'website'
    ? createActionBridgeWebsiteExtractPlan({
      connector: input.connector,
      path: input.path,
      allowlist: input.allowlist,
      maxPages: typeof input.input.maxPages === 'number' ? input.input.maxPages : undefined,
      maxBytes: typeof input.input.maxBytes === 'number' ? input.input.maxBytes : undefined,
    })
    : null;
  const executable = input.connector.enabled && input.action.enabled && classification.readOnly && target.ok;

  return {
    actionId: input.action.id,
    actionName: input.action.name,
    riskLevel: input.action.riskLevel,
    readOnly: classification.readOnly,
    dryRun: true,
    networkExecution: false,
    targetAllowed: target.ok,
    redactedInput,
    redactedResultSummary: redactActionBridgeValue({
      status: executable ? 'dry_run_noop' : 'dry_run_blocked',
      reason: target.reason || (classification.readOnly ? 'Read-only dry run planned without execution.' : 'Non-read action requires approval.'),
      readOnly: classification.readOnly,
      requiresApproval: classification.requiresApproval,
      targetHostname: target.hostname,
      websiteExtractPlan: websitePlan,
      networkExecution: false,
    }) as Record<string, unknown>,
  };
}
