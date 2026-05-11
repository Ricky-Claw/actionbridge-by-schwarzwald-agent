import type { ActionBridgeConnector } from './types';

export interface ActionBridgeExecutionControls {
  networkExecutionEnabled: boolean;
  safetyStatus: 'untested' | 'pass' | 'fail';
  permissionStatus: 'draft' | 'active' | 'paused' | 'revoked';
  killSwitchActive: boolean;
}

export interface ActionBridgeExecutionControlDecision {
  allowed: boolean;
  reason: string;
  networkExecution: false;
}

export function normalizeActionBridgeExecutionControls(
  connector: Pick<ActionBridgeConnector, 'networkExecutionEnabled' | 'safetyStatus' | 'permissionStatus'> | null | undefined,
  killSwitchActive = true
): ActionBridgeExecutionControls {
  return {
    networkExecutionEnabled: connector?.networkExecutionEnabled === true,
    safetyStatus: connector?.safetyStatus || 'untested',
    permissionStatus: connector?.permissionStatus || 'draft',
    killSwitchActive,
  };
}

export function decideActionBridgeNetworkExecutionControls(
  controls: ActionBridgeExecutionControls
): ActionBridgeExecutionControlDecision {
  if (controls.killSwitchActive) {
    return { allowed: false, reason: 'ActionBridge network execution kill-switch is active.', networkExecution: false };
  }
  if (!controls.networkExecutionEnabled) {
    return { allowed: false, reason: 'Connector network execution is disabled.', networkExecution: false };
  }
  if (controls.safetyStatus !== 'pass') {
    return { allowed: false, reason: 'Connector safety checks have not passed.', networkExecution: false };
  }
  if (controls.permissionStatus !== 'active') {
    return { allowed: false, reason: 'Connector permission is not active.', networkExecution: false };
  }

  // Stage-2 scaffolding only: this decision shape is ready for a future fetch executor,
  // but still returns networkExecution:false until DNS pinning and egress controls are live.
  return { allowed: false, reason: 'Network executor is not wired in this release.', networkExecution: false };
}
