import type { ActionBridgeActionDefinition, ActionBridgeRiskLevel } from './types';

export interface ActionBridgeToolDefinition {
  name: string;
  description: string;
  inputSchema: ActionBridgeActionDefinition['inputSchema'];
  riskLevel: ActionBridgeRiskLevel;
  requiresApproval: boolean;
}

export interface ActionBridgeToolCall {
  actionName: string;
  input: Record<string, unknown>;
  riskLevel: ActionBridgeRiskLevel;
  agentId?: string;
}

export function toActionBridgeToolDefinition(action: ActionBridgeActionDefinition): ActionBridgeToolDefinition {
  return {
    name: action.name,
    description: action.description,
    inputSchema: action.inputSchema,
    riskLevel: action.riskLevel,
    requiresApproval: action.requiresApproval ?? action.riskLevel !== 'read',
  };
}

export function createActionBridgeToolCall(
  tool: ActionBridgeToolDefinition,
  input: Record<string, unknown>,
  agentId?: string
): ActionBridgeToolCall {
  return {
    actionName: tool.name,
    input,
    riskLevel: tool.riskLevel,
    agentId,
  };
}
