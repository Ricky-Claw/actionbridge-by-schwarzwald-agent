import 'server-only';

import type { ActionBridgeActionDefinition, ActionBridgeConnector } from './types';
import { toActionBridgeToolDefinition } from './tool-interface';

export interface ActionBridgeWidgetTool {
  name: string;
  description: string;
  inputSchema: ActionBridgeActionDefinition['inputSchema'];
  riskLevel: ActionBridgeActionDefinition['riskLevel'];
  requiresApproval: boolean;
  enabled: boolean;
}

export interface ActionBridgeWidgetToolCatalog {
  version: 'actionbridge.catalog.v1';
  connector: {
    id: string;
    name: string;
    type: ActionBridgeConnector['type'];
    enabled: boolean;
    capabilities: string[];
    safetyStatus: ActionBridgeConnector['safetyStatus'];
    permissionStatus: ActionBridgeConnector['permissionStatus'];
  };
  tools: ActionBridgeWidgetTool[];
  execution: {
    mode: 'dry_run_only';
    networkExecution: false;
  };
}

export function createActionBridgeWidgetToolCatalog(input: {
  connector: Pick<ActionBridgeConnector, 'id' | 'name' | 'type' | 'enabled' | 'capabilities' | 'safetyStatus' | 'permissionStatus'>;
  actions: ActionBridgeActionDefinition[];
}): ActionBridgeWidgetToolCatalog {
  return {
    version: 'actionbridge.catalog.v1',
    connector: {
      id: input.connector.id,
      name: input.connector.name,
      type: input.connector.type,
      enabled: input.connector.enabled,
      capabilities: input.connector.capabilities || [],
      safetyStatus: input.connector.safetyStatus || 'untested',
      permissionStatus: input.connector.permissionStatus || 'draft',
    },
    tools: input.actions
      .filter((action) => action.connectorId === input.connector.id)
      .map((action) => {
        const tool = toActionBridgeToolDefinition(action);
        return {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          riskLevel: tool.riskLevel,
          requiresApproval: tool.requiresApproval,
          enabled: action.enabled,
        };
      }),
    execution: {
      mode: 'dry_run_only',
      networkExecution: false,
    },
  };
}

export function createActionBridgeWidgetToolCatalogs(input: {
  connectors: Array<Pick<ActionBridgeConnector, 'id' | 'name' | 'type' | 'enabled' | 'capabilities' | 'safetyStatus' | 'permissionStatus'>>;
  actions: ActionBridgeActionDefinition[];
}): ActionBridgeWidgetToolCatalog[] {
  return input.connectors.map((connector) => createActionBridgeWidgetToolCatalog({ connector, actions: input.actions }));
}
