import type { ActionBridgeInputField } from './types';

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /disregard\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /system\s*prompt/i,
  /developer\s*message/i,
  /reveal\s+(secrets?|tokens?|credentials?)/i,
  /bypass\s+(policy|approval|guardrails?)/i,
  /do\s+not\s+(ask|tell|disclose)/i,
];
const SAFE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const RESERVED_NAME_PARTS = new Set(['ignore', 'bypass', 'override', 'system', 'developer', 'secret', 'token', 'credential', 'password']);

export function isActionBridgePromptInjectionText(value: string): boolean {
  return PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(value));
}

export function sanitizeActionBridgeSchemaName(value: unknown, maxLength = 80): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^[._-]+|[._-]+$/g, '');
  if (!normalized || normalized.length > maxLength) return null;
  if (!SAFE_NAME_PATTERN.test(normalized)) return null;
  if (normalized.split(/[._-]/).some((part) => RESERVED_NAME_PARTS.has(part))) return null;
  if (isActionBridgePromptInjectionText(value)) return null;
  return normalized;
}

export function sanitizeActionBridgeSchemaText(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length > maxLength) return null;
  if (isActionBridgePromptInjectionText(text)) return null;
  return text;
}

export function sanitizeActionBridgeInputSchema(value: unknown): ActionBridgeInputField[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) return null;
  const fields: ActionBridgeInputField[] = [];
  for (const field of value) {
    if (!field || typeof field !== 'object' || Array.isArray(field)) return null;
    const candidate = field as Record<string, unknown>;
    const name = sanitizeActionBridgeSchemaName(candidate.name, 80);
    const description = sanitizeActionBridgeSchemaText(candidate.description, 300);
    const type = candidate.type;
    const required = candidate.required;
    if (!name || description === null) return null;
    if (type !== 'string' && type !== 'number' && type !== 'boolean' && type !== 'object' && type !== 'array') return null;
    if (typeof required !== 'boolean') return null;
    fields.push({ name, type, required, description: description || '' });
  }
  return fields;
}
