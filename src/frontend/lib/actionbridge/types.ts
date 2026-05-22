export type ActionBridgeRiskLevel = 'read' | 'write' | 'transactional' | 'destructive';

export type ActionBridgeDecision = 'allow' | 'deny' | 'approval_required';

export type ActionBridgeProviderId = 'schwarzwald-agent' | (string & {});
export type ActionBridgeTenantId = string;
export type ActionBridgeTargetId = string;

export type ActionBridgeOwnershipStatus = 'pending' | 'verified' | 'unverified' | 'failed';
export type ActionBridgeScriptStatus = 'unknown' | 'connected' | 'missing_script' | 'script_found_no_handshake' | 'unreachable' | 'error';
export type ActionBridgeConnectionStatus = 'pending' | 'connected' | 'unverified' | 'missing_script' | 'unreachable' | 'error';

export interface ActionBridgeTarget {
  id: ActionBridgeTargetId;
  providerId: ActionBridgeProviderId;
  tenantId: ActionBridgeTenantId;
  ownerUserId?: string;
  url: string;
  origin: string;
  hostname: string;
  bridgeOrigin: string;
  ownershipStatus: ActionBridgeOwnershipStatus;
  scriptStatus: ActionBridgeScriptStatus;
  connectionStatus: ActionBridgeConnectionStatus;
  capabilities: string[];
  statusMetadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

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
  type: 'http' | 'website' | 'webhook' | 'whatsapp_business' | 'backend_bridge';
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
