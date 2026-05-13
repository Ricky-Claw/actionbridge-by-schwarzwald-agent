import 'server-only';

import { redactActionBridgeValue } from './redaction';
import { validateActionBridgeTarget, type ActionBridgeTargetAllowlistEntry } from './target-validation';
import type { ActionBridgeConnector } from './types';
import { defaultActionBridgeWebsiteOutputLimits } from './website-extraction-guards';

export const actionBridgeWebsiteConnectorCapabilities = [
  'public_page_extract',
  'same_origin_route_discovery',
  'metadata_extract',
  'form_inventory',
  'no_form_submit',
  'no_login_bypass',
  'networkExecution:false',
] as const;

export interface ActionBridgeWebsiteExtractRequest {
  connector: Pick<ActionBridgeConnector, 'baseUrl' | 'enabled'>;
  path?: string;
  allowlist?: ActionBridgeTargetAllowlistEntry[];
  maxPages?: number;
  maxBytes?: number;
}

export interface ActionBridgeWebsiteExtractPlan {
  connectorType: 'website';
  targetAllowed: boolean;
  targetUrl?: string;
  reason?: string;
  maxPages: number;
  maxBytes: number;
  allowedDataClasses: string[];
  blockedBehaviors: string[];
  outputLimits: ReturnType<typeof defaultActionBridgeWebsiteOutputLimits>;
  requiredExecutorGates: string[];
  auditSummary: Record<string, unknown>;
  networkExecution: false;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function createActionBridgeWebsiteExtractPlan(
  input: ActionBridgeWebsiteExtractRequest
): ActionBridgeWebsiteExtractPlan {
  const target = validateActionBridgeTarget({
    connector: input.connector,
    path: input.path,
    allowlist: input.allowlist,
  });
  const maxPages = clampInteger(input.maxPages, 10, 1, 50);
  const maxBytes = clampInteger(input.maxBytes, 250_000, 10_000, 1_000_000);
  const outputLimits = { ...defaultActionBridgeWebsiteOutputLimits(), maxPages, maxBytes };

  return {
    connectorType: 'website',
    targetAllowed: Boolean(input.connector.enabled && target.ok),
    targetUrl: target.url,
    reason: target.reason || (input.connector.enabled ? 'Website extract is planned as a dry-run until an approved executor is wired.' : 'Connector is disabled.'),
    maxPages,
    maxBytes,
    allowedDataClasses: [
      'status',
      'finalUrl',
      'title',
      'meta',
      'headings',
      'visibleText',
      'sameOriginLinks',
      'imageReferences',
      'formInventory',
      'scriptReferences',
      'jsonLd',
    ],
    blockedBehaviors: [
      'formSubmission',
      'loginBypass',
      'credentialUse',
      'crossOriginCrawl',
      'fileDownload',
      'paymentOrCheckoutAction',
      'destructiveRequest',
      'highVolumeCrawl',
      'rawHtmlExposure',
      'rawJavaScriptExposure',
    ],
    outputLimits,
    requiredExecutorGates: [
      'exactOriginAllowlist',
      'serverSideDnsPinning',
      'redirectRevalidation',
      'robotsPolicy',
      'perTenantRateLimit',
      'browserNoWriteInterception',
      'piiSecretRedaction',
      'auditLog',
      'killSwitch',
    ],
    auditSummary: redactActionBridgeValue({
      connectorType: 'website',
      targetAllowed: Boolean(input.connector.enabled && target.ok),
      targetHostname: target.hostname,
      maxPages,
      maxBytes,
      networkExecution: false,
    }) as Record<string, unknown>,
    networkExecution: false,
  };
}
