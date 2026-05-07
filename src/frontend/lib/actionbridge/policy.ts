import type { ActionBridgePolicyContext, ActionBridgePolicyResult } from './types';

export function decideActionBridgePolicy(context: ActionBridgePolicyContext): ActionBridgePolicyResult {
  const { riskLevel, explicitAllow, approvalConfigured } = context;

  if (riskLevel === 'read') {
    return explicitAllow === false
      ? { decision: 'deny', reason: 'Read action is not allowed by policy.' }
      : { decision: 'allow', reason: 'Read action allowed by scoped policy.' };
  }

  if (riskLevel === 'write') {
    if (explicitAllow === true && approvalConfigured === false) {
      return { decision: 'allow', reason: 'Write action explicitly allowed by policy.' };
    }
    return { decision: 'approval_required', reason: 'Write action requires approval by default.' };
  }

  if (riskLevel === 'transactional') {
    return { decision: 'approval_required', reason: 'Transactional action requires human approval.' };
  }

  if (riskLevel === 'destructive') {
    return { decision: 'approval_required', reason: 'Destructive action requires human approval and future step-up auth.' };
  }

  return { decision: 'deny', reason: 'Unknown action risk level.' };
}
