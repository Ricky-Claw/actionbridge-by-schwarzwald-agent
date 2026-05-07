export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { redactActionBridgeValue } from '@/lib/actionbridge/redaction';
import { createCoreServiceClient } from '@/lib/core/service-client';

const ACTIONBRIDGE_CONNECTOR_TYPES = new Set(['http']);
const ACTIONBRIDGE_AUTH_MODES = new Set(['none', 'bearer', 'api_key', 'basic']);

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
  const authMode = typeof body.authMode === 'string' && ACTIONBRIDGE_AUTH_MODES.has(body.authMode)
    ? body.authMode
    : typeof body.auth_mode === 'string' && ACTIONBRIDGE_AUTH_MODES.has(body.auth_mode)
      ? body.auth_mode
      : 'none';

  if (!name || !baseUrl) return null;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    return null;
  }

  if (parsedUrl.protocol !== 'https:') return null;
  if (parsedUrl.username || parsedUrl.password) return null;

  return {
    name,
    type,
    base_url: parsedUrl.toString(),
    auth_mode: authMode,
    secret_ref: null,
    enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
  };
}

export async function GET() {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;

  const { data, error } = await (supabase as any)
    .from('actionbridge_connectors')
    .select('id, user_id, name, type, base_url, auth_mode, enabled, created_at, updated_at')
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
    .select('id, user_id, name, type, base_url, auth_mode, enabled, created_at, updated_at')
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
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  }, { status: 201 });
}
