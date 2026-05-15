export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { redactActionBridgeValue } from '@/lib/actionbridge/redaction';
import { createCoreServiceClient } from '@/lib/core/service-client';
import { isPrivateActionBridgeHost } from '@/lib/actionbridge/http-connector';
import { persistActionBridgeControlAuditEvent } from '@/lib/actionbridge/persistence';

const ACTIONBRIDGE_CONNECTOR_TYPES = new Set(['http', 'website', 'webhook']);
const ACTIONBRIDGE_AUTH_MODES = new Set(['none', 'bearer', 'api_key', 'basic']);

function normalizeActionBridgeAllowedOrigins(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;

  const origins = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') return null;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(entry);
    } catch {
      return null;
    }

    if (parsedUrl.protocol !== 'https:') return null;
    if (parsedUrl.username || parsedUrl.password) return null;
    if (parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) return null;
    if (isPrivateActionBridgeHost(parsedUrl.hostname)) return null;

    origins.add(parsedUrl.origin);
  }

  return [...origins];
}


function normalizeActionBridgeWebhookEndpointPath(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return '/';
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (!candidate) return '/';
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate) || candidate.startsWith('//')) return null;
  if (candidate.includes('?') || candidate.includes('#')) return null;
  const path = candidate.startsWith('/') ? candidate : `/${candidate}`;
  if (path.includes('\\')) return null;
  return path;
}

async function requireActionBridgeUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { supabase, user: null, response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
  }
  return { supabase, user, response: null };
}

function parseActionBridgeConnectorDraft(body: Record<string, unknown>) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const type = typeof body.type === 'string' && ACTIONBRIDGE_CONNECTOR_TYPES.has(body.type) ? body.type : 'http';
  const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl : typeof body.base_url === 'string' ? body.base_url : '';
  const requestedAuthMode = typeof body.authMode === 'string' && ACTIONBRIDGE_AUTH_MODES.has(body.authMode)
    ? body.authMode
    : typeof body.auth_mode === 'string' && ACTIONBRIDGE_AUTH_MODES.has(body.auth_mode)
      ? body.auth_mode
      : 'none';
  const authMode = type === 'website' ? 'none' : requestedAuthMode;
  const endpointPath = type === 'webhook'
    ? normalizeActionBridgeWebhookEndpointPath(body.endpointPath ?? body.endpoint_path)
    : '/';

  if (!name || !baseUrl || !endpointPath) return null;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    return null;
  }

  if (parsedUrl.protocol !== 'https:') return null;
  if (parsedUrl.username || parsedUrl.password) return null;
  if (isPrivateActionBridgeHost(parsedUrl.hostname)) return null;

  const allowedOrigins = normalizeActionBridgeAllowedOrigins(
    body.allowedOrigins ?? body.allowed_origins ?? (type === 'website' ? [parsedUrl.origin] : undefined)
  );
  if (!allowedOrigins) return null;

  return {
    name,
    type,
    base_url: parsedUrl.toString(),
    auth_mode: authMode,
    secret_ref: null,
    enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
    allowed_origins: allowedOrigins,
    capabilities: type === 'website'
      ? ['public_page_extract', 'same_origin_route_discovery', 'metadata_extract', 'form_inventory', 'no_form_submit', 'networkExecution:false']
      : type === 'webhook'
        ? ['webhook.v1', 'lead.submit', 'approval_required', 'no_redirects', 'server_allowlist_required']
        : [],
    network_execution_enabled: false,
    safety_status: 'untested',
    permission_status: 'draft',
    endpoint_path: endpointPath,
  };
}

export async function GET() {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;

  const { data, error } = await (supabase as any)
    .from('actionbridge_connectors')
    .select('id, user_id, name, type, base_url, auth_mode, enabled, allowed_origins, capabilities, network_execution_enabled, safety_status, permission_status, endpoint_path, created_at, updated_at')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_CONNECTORS_LIST_FAILED' }, { status: 500 });
  }

  return NextResponse.json({
    connectors: (data || []).map((connector: any) => ({
      id: connector.id,
      tenantId: connector.user_id,
      name: connector.name,
      type: connector.type,
      baseUrl: connector.base_url,
      authMode: connector.auth_mode,
      enabled: connector.enabled,
      allowedOrigins: connector.allowed_origins || [],
      capabilities: connector.capabilities || [],
      networkExecutionEnabled: connector.network_execution_enabled === true,
      safetyStatus: connector.safety_status,
      permissionStatus: connector.permission_status,
      endpointPath: connector.endpoint_path || '/',
      createdAt: connector.created_at,
      updatedAt: connector.updated_at,
    })),
  });
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireActionBridgeUser();
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const redactedBody = redactActionBridgeValue(body);
  const bodyObject = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};

  if ('secretRef' in bodyObject || 'secret_ref' in bodyObject || 'secretValue' in bodyObject || 'secret_value' in bodyObject) {
    return NextResponse.json({
      error: 'ACTIONBRIDGE_SECRET_STORAGE_NOT_CONFIGURED',
      redactedInput: redactedBody,
    }, { status: 400 });
  }

  const draft = parseActionBridgeConnectorDraft(bodyObject);
  if (!draft) {
    return NextResponse.json({ error: 'INVALID_ACTIONBRIDGE_CONNECTOR', redactedInput: redactedBody }, { status: 400 });
  }

  const serviceSupabase = createCoreServiceClient();
  if (!serviceSupabase) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_CONNECTOR_CREATE_FAILED', redactedInput: redactedBody }, { status: 503 });
  }

  const { data, error } = await (serviceSupabase as any)
    .from('actionbridge_connectors')
    .insert({
      user_id: user!.id,
      ...draft,
    })
    .select('id, user_id, name, type, base_url, auth_mode, enabled, allowed_origins, capabilities, network_execution_enabled, safety_status, permission_status, endpoint_path, created_at, updated_at')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_CONNECTOR_CREATE_FAILED', redactedInput: redactedBody }, { status: 409 });
  }

  return NextResponse.json({
    connector: {
      id: data.id,
      tenantId: data.user_id,
      name: data.name,
      type: data.type,
      baseUrl: data.base_url,
      authMode: data.auth_mode,
      enabled: data.enabled,
      allowedOrigins: data.allowed_origins || [],
      capabilities: data.capabilities || [],
      networkExecutionEnabled: data.network_execution_enabled === true,
      safetyStatus: data.safety_status,
      permissionStatus: data.permission_status,
      endpointPath: data.endpoint_path || '/',
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const bodyObject = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const connectorId = typeof bodyObject.connectorId === 'string'
    ? bodyObject.connectorId.trim()
    : typeof bodyObject.connector_id === 'string'
      ? bodyObject.connector_id.trim()
      : '';
  if (!connectorId || typeof bodyObject.networkExecutionEnabled !== 'boolean') {
    return NextResponse.json({ error: 'INVALID_ACTIONBRIDGE_CONNECTOR_UPDATE', redactedInput: redactActionBridgeValue(bodyObject) }, { status: 400 });
  }

  const { data: connector } = await (supabase as any)
    .from('actionbridge_connectors')
    .select('id,user_id,type,allowed_origins,safety_status,permission_status,network_execution_enabled')
    .eq('user_id', user!.id)
    .eq('id', connectorId)
    .maybeSingle();
  if (!connector) return NextResponse.json({ error: 'ACTIONBRIDGE_CONNECTOR_NOT_FOUND' }, { status: 404 });

  const enableNetworkExecution = bodyObject.networkExecutionEnabled === true;
  if (enableNetworkExecution) {
    const allowedOrigins = Array.isArray(connector.allowed_origins) ? connector.allowed_origins : [];
    if (connector.type !== 'webhook' || connector.safety_status !== 'pass' || connector.permission_status !== 'active' || allowedOrigins.length < 1) {
      return NextResponse.json({
        error: 'ACTIONBRIDGE_NETWORK_EXECUTION_REQUIRES_VERIFIED_WEBHOOK_CONNECTOR',
        redactedInput: redactActionBridgeValue(bodyObject),
      }, { status: 409 });
    }
  }

  const serviceSupabase = createCoreServiceClient();
  if (!serviceSupabase) return NextResponse.json({ error: 'ACTIONBRIDGE_CONNECTOR_UPDATE_FAILED' }, { status: 503 });

  const { data, error } = await (serviceSupabase as any)
    .from('actionbridge_connectors')
    .update({ network_execution_enabled: enableNetworkExecution, updated_at: new Date().toISOString() })
    .eq('user_id', user!.id)
    .eq('id', connectorId)
    .select('id,user_id,type,network_execution_enabled,safety_status,permission_status,updated_at')
    .single();
  if (error || !data) return NextResponse.json({ error: 'ACTIONBRIDGE_CONNECTOR_UPDATE_FAILED' }, { status: 409 });

  await persistActionBridgeControlAuditEvent(serviceSupabase, {
    userId: user!.id,
    connectorId,
    eventName: enableNetworkExecution ? 'network_execution.enabled' : 'network_execution.disabled',
    input: { connectorId, networkExecutionEnabled: enableNetworkExecution },
    status: 'succeeded',
    resultSummary: { connectorId, type: data.type, networkExecutionEnabled: data.network_execution_enabled, safetyStatus: data.safety_status, permissionStatus: data.permission_status },
  });

  return NextResponse.json({
    connector: {
      id: data.id,
      tenantId: data.user_id,
      type: data.type,
      networkExecutionEnabled: data.network_execution_enabled === true,
      safetyStatus: data.safety_status,
      permissionStatus: data.permission_status,
      updatedAt: data.updated_at,
    },
  });
}
