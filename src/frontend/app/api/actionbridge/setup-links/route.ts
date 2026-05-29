export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createCoreServiceClient } from '@/lib/core/service-client';
import { redactActionBridgeValue } from '@/lib/actionbridge/redaction';
import { createActionBridgeSetupLinkDraft } from '@/lib/actionbridge/setup-links';
import { persistActionBridgeControlAuditEvent } from '@/lib/actionbridge/persistence';
import { createActionBridgeRateLimitHeaders, enforceActionBridgeRateLimitAsync } from '@/lib/actionbridge/rate-limit';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requireActionBridgeUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { supabase, user: null, response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
  }
  return { supabase, user, response: null };
}

export async function GET(request: NextRequest) {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;

  const rateLimit = await enforceActionBridgeRateLimitAsync({ request, policyName: 'setupLinks', discriminator: `${user!.id}|list` });
  if (!rateLimit.ok) return rateLimit.response!;

  const { data, error } = await (supabase as any)
    .from('actionbridge_setup_links')
    .select('id,user_id,connector_id,target_origin,status,allowed_methods,created_at,expires_at')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_LINKS_LIST_FAILED' }, { status: 500 });

  return NextResponse.json({
    setupLinks: (data || []).map((link: any) => ({
      id: link.id,
      tenantId: link.user_id,
      connectorId: link.connector_id,
      targetOrigin: link.target_origin,
      status: link.status,
      allowedMethods: link.allowed_methods || [],
      createdAt: link.created_at,
      expiresAt: link.expires_at,
    })),
  }, {
    headers: createActionBridgeRateLimitHeaders({ policyName: 'setupLinks', remaining: rateLimit.remaining, resetAt: rateLimit.resetAt }),
  });
}

export async function POST(request: NextRequest) {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const bodyObject = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const connectorId = typeof bodyObject.connectorId === 'string'
    ? bodyObject.connectorId.trim()
    : typeof bodyObject.connector_id === 'string'
      ? bodyObject.connector_id.trim()
      : null;

  const rateLimit = await enforceActionBridgeRateLimitAsync({ request, policyName: 'setupLinks', discriminator: `${user!.id}|create` });
  if (!rateLimit.ok) return rateLimit.response!;

  if (connectorId && !UUID_PATTERN.test(connectorId)) {
    return NextResponse.json({ error: 'INVALID_ACTIONBRIDGE_SETUP_LINK_CONNECTOR', redactedInput: redactActionBridgeValue(bodyObject) }, { status: 400 });
  }

  if (connectorId) {
    const { data: connector } = await (supabase as any)
      .from('actionbridge_connectors')
      .select('id')
      .eq('user_id', user!.id)
      .eq('id', connectorId)
      .maybeSingle();
    if (!connector) return NextResponse.json({ error: 'ACTIONBRIDGE_CONNECTOR_NOT_FOUND' }, { status: 404 });
  }

  const draft = createActionBridgeSetupLinkDraft({ targetOrigin: bodyObject.targetOrigin ?? bodyObject.target_origin });
  if (!draft) {
    return NextResponse.json({ error: 'INVALID_ACTIONBRIDGE_SETUP_LINK_TARGET', redactedInput: redactActionBridgeValue(bodyObject) }, { status: 400 });
  }

  const serviceSupabase = createCoreServiceClient();
  if (!serviceSupabase) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_LINK_CREATE_FAILED' }, { status: 503 });

  const { data, error } = await (serviceSupabase as any)
    .from('actionbridge_setup_links')
    .insert({
      user_id: user!.id,
      connector_id: connectorId,
      target_origin: draft.targetOrigin,
      token_digest: draft.tokenDigest,
      status: 'pending',
      allowed_methods: draft.allowedMethods,
      expires_at: draft.expiresAt,
    })
    .select('id,user_id,connector_id,target_origin,status,allowed_methods,created_at,expires_at')
    .single();

  if (error || !data) return NextResponse.json({ error: 'ACTIONBRIDGE_SETUP_LINK_CREATE_FAILED' }, { status: 409 });

  await persistActionBridgeControlAuditEvent(serviceSupabase, {
    userId: user!.id,
    connectorId,
    eventName: 'setup_link.created',
    input: { targetOrigin: draft.targetOrigin, connectorId },
    status: 'succeeded',
    resultSummary: { setupLinkId: data.id, status: data.status, expiresAt: data.expires_at },
  });

  return NextResponse.json({
    setupLink: {
      id: data.id,
      tenantId: data.user_id,
      connectorId: data.connector_id,
      targetOrigin: data.target_origin,
      status: data.status,
      allowedMethods: data.allowed_methods || [],
      url: draft.setupPath,
      token: draft.token,
      createdAt: data.created_at,
      expiresAt: data.expires_at,
    },
  }, {
    status: 201,
    headers: createActionBridgeRateLimitHeaders({ policyName: 'setupLinks', remaining: rateLimit.remaining, resetAt: rateLimit.resetAt }),
  });
}
