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
  approvalConsumed: { category: 'approval_decision', outcome: 'succeeded', code: 'ACTIONBRIDGE_APPROVAL_CONSUMED', networkExecution: false },
  approvalConsumeRejected: { category: 'approval_decision', outcome: 'blocked', code: 'ACTIONBRIDGE_APPROVAL_CONSUME_REJECTED', networkExecution: false },
  idempotencyReplay: { category: 'execution_control', outcome: 'blocked', code: 'ACTIONBRIDGE_IDEMPOTENCY_REPLAY', networkExecution: false },
  invalidIdempotencyKey: { category: 'execution_control', outcome: 'blocked', code: 'ACTIONBRIDGE_INVALID_IDEMPOTENCY_KEY', networkExecution: false },
  targetBlocked: { category: 'target_validation', outcome: 'blocked', code: 'ACTIONBRIDGE_TARGET_BLOCKED', networkExecution: false },
  killSwitchBlocked: { category: 'execution_control', outcome: 'blocked', code: 'ACTIONBRIDGE_KILL_SWITCH_BLOCKED', networkExecution: false },
  networkExecutorUnavailable: { category: 'execution_control', outcome: 'blocked', code: 'ACTIONBRIDGE_NETWORK_EXECUTOR_UNAVAILABLE', networkExecution: false },
  dryRunNoop: { category: 'dry_run_result', outcome: 'succeeded', code: 'ACTIONBRIDGE_DRY_RUN_NOOP', networkExecution: false },
  executionResultPersisted: { category: 'execution_result', outcome: 'succeeded', code: 'ACTIONBRIDGE_EXECUTION_RESULT_PERSISTED', networkExecution: false },
  executionPersistFailed: { category: 'execution_result', outcome: 'failed', code: 'ACTIONBRIDGE_EXECUTION_PERSIST_FAILED', networkExecution: false },
} satisfies Record<string, ActionBridgeAuditTaxonomyEvent>;
