const SENSITIVE_KEYS = ['apiKey', 'authorization', 'clientSecret', 'password', 'token'];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SENSITIVE_KEYS.some((candidate) => normalized.includes(normalizeKey(candidate)));
}

export function redactActionBridgeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactActionBridgeValue(item));

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        isSensitiveKey(key) ? '[REDACTED]' : redactActionBridgeValue(nested),
      ])
    );
  }

  return value;
}
