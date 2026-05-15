const SENSITIVE_KEYS = [
  'apiKey',
  'authorization',
  'clientSecret',
  'password',
  'token',
  'email',
  'phone',
  'mobile',
  'telephone',
  'contact',
  'address',
  'street',
  'iban',
  'bic',
  'taxId',
  'vatId',
];

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IBAN_PATTERN = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/gi;
const PHONE_PATTERN = /(?<!\w)(?:\+\d{1,3}[\s./-]?)?(?:\(?\d{2,5}\)?[\s./-]?){2,}\d{2,}(?!\w)/g;

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

  if (typeof value === 'string') {
    return value
      .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]')
      .replace(IBAN_PATTERN, '[REDACTED_IBAN]')
      .replace(PHONE_PATTERN, '[REDACTED_PHONE]');
  }

  return value;
}
