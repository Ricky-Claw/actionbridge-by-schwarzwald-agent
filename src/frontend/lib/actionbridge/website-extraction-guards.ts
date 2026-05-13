import 'server-only';

import { redactActionBridgeValue } from './redaction';

export interface ActionBridgeWebsiteRobotsDecision {
  allowed: boolean;
  reason: string;
  crawlDelaySeconds?: number;
  networkExecution: false;
}

export interface ActionBridgeWebsiteNoWriteDecision {
  allowed: boolean;
  method: string;
  reason: string;
  networkExecution: false;
}

export interface ActionBridgeWebsiteOutputLimits {
  maxPages: number;
  maxBytes: number;
  maxVisibleTextChars: number;
  returnRawHtml: false;
  returnRawJavaScript: false;
}

export interface ActionBridgeWebsiteSanitizedPageProfile {
  status?: number;
  finalUrl?: string;
  title?: string;
  meta?: Record<string, unknown>[];
  headings?: Record<string, unknown>[];
  visibleText?: string[];
  sameOriginLinks?: Record<string, unknown>[];
  externalLinks?: Record<string, unknown>[];
  formInventory?: Record<string, unknown>[];
  jsonLd?: Record<string, unknown>[];
  redactionApplied: true;
  rawHtmlReturned: false;
  rawJavaScriptReturned: false;
  networkExecution: false;
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PASSIVE_METHODS = new Set(['GET', 'HEAD']);

export function decideActionBridgeWebsiteRobotsPolicy(input: {
  robotsAllowed?: boolean;
  crawlDelaySeconds?: number | null;
}): ActionBridgeWebsiteRobotsDecision {
  if (input.robotsAllowed !== true) {
    return { allowed: false, reason: 'robots.txt does not allow this website extraction.', networkExecution: false };
  }

  return {
    allowed: true,
    reason: 'robots.txt allows passive website extraction.',
    crawlDelaySeconds: typeof input.crawlDelaySeconds === 'number' && input.crawlDelaySeconds > 0
      ? Math.min(input.crawlDelaySeconds, 60)
      : undefined,
    networkExecution: false,
  };
}

export function decideActionBridgeWebsiteNoWritePolicy(method: string): ActionBridgeWebsiteNoWriteDecision {
  const normalizedMethod = method.trim().toUpperCase();
  if (WRITE_METHODS.has(normalizedMethod)) {
    return { allowed: false, method: normalizedMethod, reason: 'Website connector blocks write-capable HTTP methods.', networkExecution: false };
  }
  if (!PASSIVE_METHODS.has(normalizedMethod)) {
    return { allowed: false, method: normalizedMethod, reason: 'Website connector allows only GET/HEAD passive requests.', networkExecution: false };
  }
  return { allowed: true, method: normalizedMethod, reason: 'Passive request method allowed.', networkExecution: false };
}

export function defaultActionBridgeWebsiteOutputLimits(): ActionBridgeWebsiteOutputLimits {
  return {
    maxPages: 10,
    maxBytes: 250_000,
    maxVisibleTextChars: 20_000,
    returnRawHtml: false,
    returnRawJavaScript: false,
  };
}

function truncateText(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.length > maxChars ? `${value.slice(0, maxChars)}…[TRUNCATED]` : value;
}

function sanitizeRecordArray(value: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .slice(0, 100)
    .map((entry) => redactActionBridgeValue(entry) as Record<string, unknown>);
}

export function sanitizeActionBridgeWebsitePageProfile(
  value: Record<string, unknown>,
  limits: ActionBridgeWebsiteOutputLimits = defaultActionBridgeWebsiteOutputLimits()
): ActionBridgeWebsiteSanitizedPageProfile {
  const visibleText = Array.isArray(value.visibleText)
    ? value.visibleText
      .map((entry) => truncateText(entry, Math.max(0, limits.maxVisibleTextChars)))
      .filter((entry): entry is string => Boolean(entry))
      .slice(0, 200)
    : undefined;

  return redactActionBridgeValue({
    status: typeof value.status === 'number' ? value.status : undefined,
    finalUrl: typeof value.finalUrl === 'string' ? value.finalUrl : undefined,
    title: truncateText(value.title, 300),
    meta: sanitizeRecordArray(value.meta),
    headings: sanitizeRecordArray(value.headings),
    visibleText,
    sameOriginLinks: sanitizeRecordArray(value.sameOriginLinks),
    externalLinks: sanitizeRecordArray(value.externalLinks),
    formInventory: sanitizeRecordArray(value.formInventory),
    jsonLd: sanitizeRecordArray(value.jsonLd),
    redactionApplied: true,
    rawHtmlReturned: false,
    rawJavaScriptReturned: false,
    networkExecution: false,
  }) as ActionBridgeWebsiteSanitizedPageProfile;
}
