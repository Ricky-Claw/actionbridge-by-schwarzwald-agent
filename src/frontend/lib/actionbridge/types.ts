export type ActionBridgeRiskLevel = 'read' | 'write' | 'transactional' | 'destructive';

export type ActionBridgeDecision = 'allow' | 'deny' | 'approval_required';

export interface ActionBridgeInputField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  description: string;
}

export interface ActionBridgeActionDefinition {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  riskLevel: ActionBridgeRiskLevel;
  inputSchema: ActionBridgeInputField[];
  outputDescription: string;
  connectorId: string;
  enabled: boolean;
  requiresApproval?: boolean;
}

export type ActionBridgeSafetyStatus = 'untested' | 'pass' | 'fail';
export type ActionBridgePermissionStatus = 'draft' | 'active' | 'paused' | 'revoked';

export interface ActionBridgeConnector {
  id: string;
  tenantId: string;
  type: 'http' | 'website';
  name: string;
  baseUrl: string;
  authMode: 'none' | 'bearer' | 'api_key' | 'basic';
  secretRef?: string;
  enabled: boolean;
  allowedOrigins?: string[];
  capabilities?: string[];
  networkExecutionEnabled?: boolean;
  safetyStatus?: ActionBridgeSafetyStatus;
  permissionStatus?: ActionBridgePermissionStatus;
}

export interface ActionBridgePolicyContext {
  tenantId: string;
  userId: string;
  agentId?: string;
  riskLevel: ActionBridgeRiskLevel;
  actionName: string;
  explicitAllow?: boolean;
  approvalConfigured?: boolean;
}

export interface ActionBridgePolicyResult {
  decision: ActionBridgeDecision;
  reason: string;
}

export interface ActionBridgeAuditEvent {
  tenantId: string;
  userId: string;
  agentId?: string;
  actionId: string;
  actionName: string;
  decision: ActionBridgeDecision;
  riskLevel: ActionBridgeRiskLevel;
  redactedInput: unknown;
  status: 'pending' | 'succeeded' | 'failed' | 'denied';
  latencyMs?: number;
  createdAt: string;
}
