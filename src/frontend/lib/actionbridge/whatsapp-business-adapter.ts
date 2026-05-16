import 'server-only';

export const ACTIONBRIDGE_WHATSAPP_GRAPH_ORIGIN = 'https://graph.facebook.com';
export const ACTIONBRIDGE_WHATSAPP_DEFAULT_API_VERSION = 'v20.0';

export interface ActionBridgeWhatsAppBusinessDraft {
  phoneNumberId: string;
  businessAccountId: string;
  apiVersion: string;
  capabilities: string[];
  baseUrl: string;
  allowedOrigins: string[];
}

function normalizeMetaNumericId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const candidate = String(value).trim();
  if (!/^\d{5,32}$/.test(candidate)) return null;
  return candidate;
}

function normalizeGraphApiVersion(value: unknown): string {
  if (typeof value !== 'string') return ACTIONBRIDGE_WHATSAPP_DEFAULT_API_VERSION;
  const candidate = value.trim().toLowerCase();
  if (!/^v\d{2}\.\d$/.test(candidate)) return ACTIONBRIDGE_WHATSAPP_DEFAULT_API_VERSION;
  return candidate;
}

export function createActionBridgeWhatsAppBusinessDraft(input: {
  phoneNumberId?: unknown;
  phone_number_id?: unknown;
  businessAccountId?: unknown;
  business_account_id?: unknown;
  wabaId?: unknown;
  waba_id?: unknown;
  apiVersion?: unknown;
  api_version?: unknown;
}): ActionBridgeWhatsAppBusinessDraft | null {
  const phoneNumberId = normalizeMetaNumericId(input.phoneNumberId ?? input.phone_number_id);
  const businessAccountId = normalizeMetaNumericId(input.businessAccountId ?? input.business_account_id ?? input.wabaId ?? input.waba_id);
  if (!phoneNumberId || !businessAccountId) return null;

  const apiVersion = normalizeGraphApiVersion(input.apiVersion ?? input.api_version);
  return {
    phoneNumberId,
    businessAccountId,
    apiVersion,
    baseUrl: `${ACTIONBRIDGE_WHATSAPP_GRAPH_ORIGIN}/${apiVersion}/${phoneNumberId}/messages`,
    allowedOrigins: [ACTIONBRIDGE_WHATSAPP_GRAPH_ORIGIN],
    capabilities: [
      'whatsapp.business.cloud_api',
      `whatsapp.phone_number_id:${phoneNumberId}`,
      `whatsapp.business_account_id:${businessAccountId}`,
      `whatsapp.graph_api_version:${apiVersion}`,
      'whatsapp.message.send',
      'whatsapp.template.send',
      'approval_required',
      'server_secret_ref_required',
      'networkExecution:false',
    ],
  };
}

export function summarizeActionBridgeWhatsAppCapabilities(capabilities: unknown): {
  phoneNumberId?: string;
  businessAccountId?: string;
  apiVersion?: string;
  cloudApi: boolean;
} {
  const list = Array.isArray(capabilities) ? capabilities.filter((entry): entry is string => typeof entry === 'string') : [];
  const findValue = (prefix: string) => list.find((entry) => entry.startsWith(prefix))?.slice(prefix.length);
  return {
    phoneNumberId: findValue('whatsapp.phone_number_id:'),
    businessAccountId: findValue('whatsapp.business_account_id:'),
    apiVersion: findValue('whatsapp.graph_api_version:'),
    cloudApi: list.includes('whatsapp.business.cloud_api'),
  };
}
