const SAFE_RESULT_KEYS = new Set([
  'status',
  'mode',
  'reason',
  'readOnly',
  'targetAllowed',
  'networkExecution',
  'auditCode',
  'actionName',
  'riskLevel',
  'executionControls',
  'responseLimits',
]);

const SENSITIVE_KEY_PATTERN = /(idempotency|secret|token|password|authorization|credential|api[-_]?key|client[-_]?secret)/i;

function sanitizeNestedSafeMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizeNestedSafeMetadata);
  if (!value || typeof value !== 'object') return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    if (nestedValue && typeof nestedValue === 'object') {
      sanitized[key] = sanitizeNestedSafeMetadata(nestedValue);
    } else if (typeof nestedValue === 'string' || typeof nestedValue === 'number' || typeof nestedValue === 'boolean' || nestedValue === null) {
      sanitized[key] = nestedValue;
    }
  }
  return sanitized;
}

export function sanitizeActionBridgeVisibilityResult(value: unknown): Record<string, unknown> {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const sanitized: Record<string, unknown> = { networkExecution: false };

  for (const [key, entryValue] of Object.entries(source)) {
    if (!SAFE_RESULT_KEYS.has(key) || SENSITIVE_KEY_PATTERN.test(key)) continue;
    sanitized[key] = sanitizeNestedSafeMetadata(entryValue);
  }

  sanitized.networkExecution = false;
  if (typeof sanitized.status !== 'string') sanitized.status = 'dry_run_noop';
  return sanitized;
}
