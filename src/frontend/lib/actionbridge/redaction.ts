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
const AUTH_HEADER_PATTERN = /\b(authorization\s*[:=]\s*)(bearer|basic|token)\s+[A-Z0-9._~+/-]+=*/gi;
const BEARER_TOKEN_PATTERN = /\b(bearer\s+)[A-Z0-9._~+/-]{16,}=*/gi;
const JWT_PATTERN = /\beyJ[A-Z0-9_-]{8,}\.[A-Z0-9_-]{8,}\.[A-Z0-9_-]{8,}\b/gi;
const QUERY_SECRET_PATTERN = /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|idempotency[_-]?key|client[_-]?secret|secret|password|token)(=)[^\s&?#,;]+/gi;
const KEY_VALUE_SECRET_PATTERN = /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|idempotency[_-]?key|client[_-]?secret|secret|password|token)\s*(:\s*|=\s*)(?!\[REDACTED_)[^\s,;"'`}{]{8,}/gi;
const COMMON_SECRET_PATTERN = /\b(sk|pk|rk|ghp|gho|ghu|ghs|glpat|xoxb|xoxp)-[A-Z0-9_\-]{12,}\b/gi;
const OPENAI_PROJECT_SECRET_PATTERN = /\bsk-proj-[A-Z0-9_\-]{20,}\b/gi;
const STRIPE_SECRET_PATTERN = /\b(?:whsec|rk_live|sk_live|sk_test)_[A-Z0-9]{16,}\b/gi;
const AWS_ACCESS_KEY_PATTERN = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g;

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
      .replace(AUTH_HEADER_PATTERN, '$1[REDACTED_AUTH]')
      .replace(BEARER_TOKEN_PATTERN, '$1[REDACTED_TOKEN]')
      .replace(JWT_PATTERN, '[REDACTED_JWT]')
      .replace(QUERY_SECRET_PATTERN, '$1$2[REDACTED_SECRET]')
      .replace(KEY_VALUE_SECRET_PATTERN, '$1$2[REDACTED_SECRET]')
      .replace(OPENAI_PROJECT_SECRET_PATTERN, '[REDACTED_SECRET]')
      .replace(STRIPE_SECRET_PATTERN, '[REDACTED_SECRET]')
      .replace(AWS_ACCESS_KEY_PATTERN, '[REDACTED_SECRET]')
      .replace(COMMON_SECRET_PATTERN, '[REDACTED_SECRET]')
      .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]')
      .replace(IBAN_PATTERN, '[REDACTED_IBAN]')
      .replace(PHONE_PATTERN, '[REDACTED_PHONE]');
  }

  return value;
}
