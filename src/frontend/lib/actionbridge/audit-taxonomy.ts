export type ActionBridgeAuditCategory =
  | 'policy_decision'
  | 'approval_requested'
  | 'approval_decision'
  | 'execution_control'
  | 'target_validation'
  | 'dry_run_result'
  | 'execution_result';

export type ActionBridgeAuditOutcome = 'allowed' | 'blocked' | 'pending' | 'succeeded' | 'failed';

export interface ActionBridgeAuditTaxonomyEvent {
  category: ActionBridgeAuditCategory;
  outcome: ActionBridgeAuditOutcome;
  code: string;
  networkExecution: false;
}

export const actionBridgeAuditTaxonomy = {
  policyAllowed: { category: 'policy_decision', outcome: 'allowed', code: 'ACTIONBRIDGE_POLICY_ALLOWED', networkExecution: false },
  policyDenied: { category: 'policy_decision', outcome: 'blocked', code: 'ACTIONBRIDGE_POLICY_DENIED', networkExecution: false },
  approvalQueued: { category: 'approval_requested', outcome: 'pending', code: 'ACTIONBRIDGE_APPROVAL_QUEUED', networkExecution: false },
  targetBlocked: { category: 'target_validation', outcome: 'blocked', code: 'ACTIONBRIDGE_TARGET_BLOCKED', networkExecution: false },
  killSwitchBlocked: { category: 'execution_control', outcome: 'blocked', code: 'ACTIONBRIDGE_KILL_SWITCH_BLOCKED', networkExecution: false },
  dryRunNoop: { category: 'dry_run_result', outcome: 'succeeded', code: 'ACTIONBRIDGE_DRY_RUN_NOOP', networkExecution: false },
  executionPersistFailed: { category: 'execution_result', outcome: 'failed', code: 'ACTIONBRIDGE_EXECUTION_PERSIST_FAILED', networkExecution: false },
} satisfies Record<string, ActionBridgeAuditTaxonomyEvent>;
