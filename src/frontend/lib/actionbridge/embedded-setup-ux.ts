import 'server-only';

import type { ActionBridgeConnector } from './types';

export type ActionBridgeEmbeddedSetupStatus = 'draft' | 'waiting' | 'connected' | 'needs_attention' | 'paused';

export interface ActionBridgeHostThemeTokens {
  brandName?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  cardColor?: string;
  borderColor?: string;
  density?: 'compact' | 'comfortable';
  language?: 'de' | 'en';
}

export interface ActionBridgeEmbeddedSetupStep {
  id: 'connector.choose' | 'values.enter' | 'authorization.verify' | 'permissions.choose' | 'connection.test' | 'connector.activate';
  label: string;
  operatorOnly: false;
}

export interface ActionBridgeEmbeddedSetupDescriptor {
  version: 'actionbridge.embedded_setup.v1';
  status: ActionBridgeEmbeddedSetupStatus;
  theme: ActionBridgeHostThemeTokens;
  steps: ActionBridgeEmbeddedSetupStep[];
  connectorType?: ActionBridgeConnector['type'];
  customerControls: Array<'pause' | 'remove' | 'retry'>;
  operatorControlsExcluded: true;
}

export function mapActionBridgeConnectorToEmbeddedStatus(input: Pick<ActionBridgeConnector, 'enabled' | 'networkExecutionEnabled' | 'safetyStatus' | 'permissionStatus'>): ActionBridgeEmbeddedSetupStatus {
  if (input.permissionStatus === 'paused' || input.enabled === false) return 'paused';
  if (input.safetyStatus === 'fail' || input.permissionStatus === 'revoked') return 'needs_attention';
  if (input.permissionStatus === 'active' && input.safetyStatus === 'pass' && input.networkExecutionEnabled === true) return 'connected';
  if (input.permissionStatus === 'active' || input.safetyStatus === 'pass') return 'waiting';
  return 'draft';
}

export function createActionBridgeEmbeddedSetupDescriptor(input: {
  connector?: Pick<ActionBridgeConnector, 'type' | 'enabled' | 'networkExecutionEnabled' | 'safetyStatus' | 'permissionStatus'>;
  theme?: ActionBridgeHostThemeTokens;
} = {}): ActionBridgeEmbeddedSetupDescriptor {
  const status = input.connector ? mapActionBridgeConnectorToEmbeddedStatus(input.connector) : 'draft';
  return {
    version: 'actionbridge.embedded_setup.v1',
    status,
    theme: {
      density: 'compact',
      language: 'de',
      ...(input.theme || {}),
    },
    steps: [
      { id: 'connector.choose', label: 'Connector auswählen', operatorOnly: false },
      { id: 'values.enter', label: 'Werte eintragen', operatorOnly: false },
      { id: 'authorization.verify', label: 'Autorisierung prüfen', operatorOnly: false },
      { id: 'permissions.choose', label: 'Berechtigungen wählen', operatorOnly: false },
      { id: 'connection.test', label: 'Verbindung testen', operatorOnly: false },
      { id: 'connector.activate', label: 'Aktivieren', operatorOnly: false },
    ],
    connectorType: input.connector?.type,
    customerControls: ['pause', 'remove', 'retry'],
    operatorControlsExcluded: true,
  };
}
