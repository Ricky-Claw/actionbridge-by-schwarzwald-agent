export const dynamic = 'force-dynamic';

import dns from 'node:dns/promises';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  ACTIONBRIDGE_DEFAULT_BRIDGE_ORIGIN,
  ACTIONBRIDGE_DEFAULT_PROVIDER_ID,
  createActionBridgeTargetsFromUrls,
  createActionBridgeTargetToolCatalog,
} from '@/lib/actionbridge/multi-target-registry';
import type { ActionBridgeTarget } from '@/lib/actionbridge/types';
import { createActionBridgeRateLimitHeaders, enforceActionBridgeRateLimit } from '@/lib/actionbridge/rate-limit';
import { decideActionBridgeDnsPinning } from '@/lib/actionbridge/dns-ip-guard';

async function requireActionBridgeUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { supabase, user: null, response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
  }
  return { supabase, user, response: null };
}

function safeTenantId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const tenantId = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(tenantId)) return null;
  return tenantId;
}

function toActionBridgeTarget(row: any): ActionBridgeTarget {
  return {
    id: row.id,
    providerId: row.provider_id || ACTIONBRIDGE_DEFAULT_PROVIDER_ID,
    tenantId: row.tenant_id,
    ownerUserId: row.owner_user_id || undefined,
    url: row.url,
    origin: row.origin,
    hostname: row.hostname,
    bridgeOrigin: row.bridge_origin || ACTIONBRIDGE_DEFAULT_BRIDGE_ORIGIN,
    ownershipStatus: row.ownership_status || 'pending',
    scriptStatus: row.script_status || 'unknown',
    connectionStatus: row.connection_status || 'pending',
    capabilities: Array.isArray(row.capabilities) ? row.capabilities : [],
    statusMetadata: row.status_metadata || { networkExecution: false },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toActionBridgeTargetRow(target: ActionBridgeTarget) {
  return {
    id: target.id,
    provider_id: target.providerId,
    tenant_id: target.tenantId,
    owner_user_id: target.ownerUserId,
    url: target.url,
    origin: target.origin,
    hostname: target.hostname,
    bridge_origin: target.bridgeOrigin,
    ownership_status: target.ownershipStatus,
    script_status: target.scriptStatus,
    connection_status: target.connectionStatus,
    capabilities: target.capabilities,
    status_metadata: target.statusMetadata || { networkExecution: false },
    created_at: target.createdAt,
    updated_at: target.updatedAt,
  };
}

function detectActionBridgeBridgeScript(input: { html: string; target: ActionBridgeTarget }) {
  const body = input.html;
  const boundedBody = body.slice(0, 250_000);
  const expectedScript = `${input.target.bridgeOrigin}/bridge.js`;
  const scriptFound = boundedBody.includes(expectedScript) || boundedBody.includes('bridge.schwarzwald-agent.de/bridge.js');
  const targetBound = boundedBody.includes(`data-actionbridge-target="${input.target.id}"`) || boundedBody.includes(`data-actionbridge-target='${input.target.id}'`);
  return {
    scriptFound,
    targetBound,
    scriptStatus: scriptFound && targetBound ? 'connected' : scriptFound ? 'script_found_no_handshake' : 'missing_script',
    connectionStatus: scriptFound && targetBound ? 'connected' : scriptFound ? 'pending' : 'missing_script',
  };
}

async function runActionBridgeTargetLiveCheck(target: ActionBridgeTarget) {
  try {
    const addresses = await dns.lookup(target.hostname, { all: true, verbatim: true });
    const dnsDecision = decideActionBridgeDnsPinning({
      hostname: target.hostname,
      addresses: addresses.map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 })),
      networkExecution: false,
    });
    if (!dnsDecision.ok) {
      return { ownershipStatus: 'pending', scriptStatus: 'unreachable', connectionStatus: 'unreachable', metadata: { networkExecution: false, error: 'ACTIONBRIDGE_TARGET_LIVE_CHECK_FAILED', reason: dnsDecision.reason } };
    }

    const response = await fetch(target.url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'ActionBridge-Script-Check/1.0' },
    });
    if (!response.ok || response.status >= 300) {
      return { ownershipStatus: 'pending', scriptStatus: 'unreachable', connectionStatus: 'unreachable', metadata: { networkExecution: 'bounded_get_only', httpStatus: response.status } };
    }
    const contentLength = Number(response.headers.get('content-length') || '0');
    if (contentLength > 250_000) {
      return { ownershipStatus: 'pending', scriptStatus: 'error', connectionStatus: 'error', metadata: { networkExecution: 'bounded_get_only', error: 'ACTIONBRIDGE_TARGET_LIVE_CHECK_FAILED', reason: 'response_too_large', contentLength } };
    }
    const body = await response.text();
    const detection = detectActionBridgeBridgeScript({ html: body, target });
    return {
      ownershipStatus: detection.scriptStatus === 'connected' ? 'verified' : 'pending',
      scriptStatus: detection.scriptStatus,
      connectionStatus: detection.connectionStatus,
      metadata: { networkExecution: 'bounded_get_only', checkedAt: new Date().toISOString(), httpStatus: response.status, scriptFound: detection.scriptFound, targetBound: detection.targetBound, maxBytesInspected: 250_000 },
    };
  } catch (error) {
    return { ownershipStatus: 'pending', scriptStatus: 'unreachable', connectionStatus: 'unreachable', metadata: { networkExecution: 'bounded_get_only', error: 'ACTIONBRIDGE_TARGET_LIVE_CHECK_FAILED' } };
  }
}

export async function GET(request: NextRequest) {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;

  const url = new URL(request.url);
  const tenantId = safeTenantId(url.searchParams.get('tenant_id') || url.searchParams.get('tenantId'));
  if (!tenantId) return NextResponse.json({ error: 'ACTIONBRIDGE_TARGET_TENANT_REQUIRED' }, { status: 400 });

  const providerId = ACTIONBRIDGE_DEFAULT_PROVIDER_ID;
  const rateLimit = enforceActionBridgeRateLimit({ request, policyName: 'domainVerification', discriminator: `${providerId}|${tenantId}|targets:list` });
  if (!rateLimit.ok) return rateLimit.response!;

  const { data: targetRows, error } = await (supabase as any)
    .from('actionbridge_targets')
    .select('id,provider_id,tenant_id,owner_user_id,url,origin,hostname,bridge_origin,ownership_status,script_status,connection_status,capabilities,status_metadata,created_at,updated_at')
    .eq('owner_user_id', user!.id)
    .eq('provider_id', providerId)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: 'ACTIONBRIDGE_TARGET_LIST_FAILED' }, { status: 500 });

  const targets = (targetRows || []).map(toActionBridgeTarget);
  return NextResponse.json({
    version: 'actionbridge.targets.v1',
    targets,
    catalog: createActionBridgeTargetToolCatalog({ scope: { providerId, tenantId, ownerUserId: user!.id }, targets }),
    embeddedSetup: {
      version: 'actionbridge.host_theme_tokens.v1',
      theme: {
        primaryColor: url.searchParams.get('primaryColor') || undefined,
        cardColor: url.searchParams.get('cardColor') || undefined,
        density: url.searchParams.get('density') || 'compact',
        language: url.searchParams.get('language') || 'de',
      },
    },
  }, {
    headers: createActionBridgeRateLimitHeaders({ policyName: 'domainVerification', remaining: rateLimit.remaining, resetAt: rateLimit.resetAt }),
  });
}

export async function POST(request: NextRequest) {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const tenantId = safeTenantId(body.tenantId ?? body.tenant_id);
  if (!tenantId) return NextResponse.json({ error: 'ACTIONBRIDGE_TARGET_TENANT_REQUIRED' }, { status: 400 });
  if (!Array.isArray(body.urls) || body.urls.length < 1 || body.urls.length > 50 || !body.urls.every((item: unknown) => typeof item === 'string')) {
    return NextResponse.json({ error: 'ACTIONBRIDGE_TARGET_URLS_REQUIRED' }, { status: 400 });
  }

  const providerId = ACTIONBRIDGE_DEFAULT_PROVIDER_ID;
  const rateLimit = enforceActionBridgeRateLimit({ request, policyName: 'domainVerification', discriminator: `${providerId}|${tenantId}|targets:intake` });
  if (!rateLimit.ok) return rateLimit.response!;

  const intake = createActionBridgeTargetsFromUrls({
    scope: { providerId, tenantId, ownerUserId: user!.id, bridgeOrigin: ACTIONBRIDGE_DEFAULT_BRIDGE_ORIGIN },
    urls: body.urls,
  });

  if (intake.accepted.length) {
    const { error } = await (supabase as any)
      .from('actionbridge_targets')
      .upsert(intake.accepted.map(toActionBridgeTargetRow), { onConflict: 'provider_id,tenant_id,origin' });
    if (error) return NextResponse.json({ error: 'ACTIONBRIDGE_TARGET_INTAKE_FAILED' }, { status: 500 });
  }

  const { data: targetRows } = await (supabase as any)
    .from('actionbridge_targets')
    .select('id,provider_id,tenant_id,owner_user_id,url,origin,hostname,bridge_origin,ownership_status,script_status,connection_status,capabilities,status_metadata,created_at,updated_at')
    .eq('owner_user_id', user!.id)
    .eq('provider_id', providerId)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(200);
  const targets = (targetRows || []).map(toActionBridgeTarget);

  return NextResponse.json({
    version: 'actionbridge.targets.intake.v1',
    tenantId,
    targets,
    accepted: intake.accepted.map((target) => ({ id: target.id, origin: target.origin, connectionStatus: target.connectionStatus })),
    rejected: intake.rejected,
    duplicates: intake.duplicates,
    catalog: createActionBridgeTargetToolCatalog({ scope: { providerId, tenantId, ownerUserId: user!.id }, targets }),
    execution: { mode: 'registry_write_only', networkExecution: false },
  }, {
    status: 201,
    headers: createActionBridgeRateLimitHeaders({ policyName: 'domainVerification', remaining: rateLimit.remaining, resetAt: rateLimit.resetAt }),
  });
}

export async function PATCH(request: NextRequest) {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const tenantId = safeTenantId(body.tenantId ?? body.tenant_id);
  const targetId = typeof body.targetId === 'string' ? body.targetId : typeof body.target_id === 'string' ? body.target_id : '';
  if (!tenantId) return NextResponse.json({ error: 'ACTIONBRIDGE_TARGET_TENANT_REQUIRED' }, { status: 400 });
  if (!targetId) return NextResponse.json({ error: 'ACTIONBRIDGE_TARGET_ID_REQUIRED' }, { status: 400 });
  const rateLimit = enforceActionBridgeRateLimit({ request, policyName: 'domainVerification', discriminator: `${ACTIONBRIDGE_DEFAULT_PROVIDER_ID}|${tenantId}|targets:status` });
  if (!rateLimit.ok) return rateLimit.response!;

  const ownershipStatus = typeof body.ownershipStatus === 'string' && ['pending', 'verified', 'unverified', 'failed'].includes(body.ownershipStatus)
    ? body.ownershipStatus
    : 'pending';
  let scriptStatus = 'unknown';
  if (body.htmlReachable === false) scriptStatus = 'unreachable';
  else if (body.bridgeScriptFound === false) scriptStatus = 'missing_script';
  else if (body.bridgeScriptFound === true && body.handshakeSeen === true) scriptStatus = 'connected';
  else if (body.bridgeScriptFound === true) scriptStatus = 'script_found_no_handshake';

  let connectionStatus = 'pending';
  if (ownershipStatus === 'verified' && scriptStatus === 'connected') connectionStatus = 'connected';
  else if (scriptStatus === 'missing_script') connectionStatus = 'missing_script';
  else if (scriptStatus === 'unreachable') connectionStatus = 'unreachable';
  else if (ownershipStatus === 'unverified') connectionStatus = 'unverified';
  else if (ownershipStatus === 'failed') connectionStatus = 'error';

  const { data, error } = await (supabase as any)
    .from('actionbridge_targets')
    .update({
      ownership_status: ownershipStatus,
      script_status: scriptStatus,
      connection_status: connectionStatus,
      status_metadata: { networkExecution: false, checkedAt: new Date().toISOString(), source: 'operator_status_update' },
      updated_at: new Date().toISOString(),
    })
    .eq('id', targetId)
    .eq('owner_user_id', user!.id)
    .eq('provider_id', ACTIONBRIDGE_DEFAULT_PROVIDER_ID)
    .eq('tenant_id', tenantId)
    .select('id,provider_id,tenant_id,owner_user_id,url,origin,hostname,bridge_origin,ownership_status,script_status,connection_status,capabilities,status_metadata,created_at,updated_at')
    .single();

  if (error || !data) return NextResponse.json({ error: 'ACTIONBRIDGE_TARGET_UPDATE_FAILED' }, { status: 409 });
  return NextResponse.json({ version: 'actionbridge.targets.status.v1', target: toActionBridgeTarget(data), execution: { mode: 'status_update_only', networkExecution: false } }, {
    headers: createActionBridgeRateLimitHeaders({ policyName: 'domainVerification', remaining: rateLimit.remaining, resetAt: rateLimit.resetAt }),
  });
}

export async function PUT(request: NextRequest) {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const tenantId = safeTenantId(body.tenantId ?? body.tenant_id);
  const targetId = typeof body.targetId === 'string' ? body.targetId : typeof body.target_id === 'string' ? body.target_id : '';
  if (!tenantId) return NextResponse.json({ error: 'ACTIONBRIDGE_TARGET_TENANT_REQUIRED' }, { status: 400 });
  if (!targetId) return NextResponse.json({ error: 'ACTIONBRIDGE_TARGET_ID_REQUIRED' }, { status: 400 });

  const providerId = ACTIONBRIDGE_DEFAULT_PROVIDER_ID;
  const rateLimit = enforceActionBridgeRateLimit({ request, policyName: 'domainVerification', discriminator: `${providerId}|${tenantId}|targets:live-check` });
  if (!rateLimit.ok) return rateLimit.response!;

  const { data: row, error: readError } = await (supabase as any)
    .from('actionbridge_targets')
    .select('id,provider_id,tenant_id,owner_user_id,url,origin,hostname,bridge_origin,ownership_status,script_status,connection_status,capabilities,status_metadata,created_at,updated_at')
    .eq('id', targetId)
    .eq('owner_user_id', user!.id)
    .eq('provider_id', providerId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (readError || !row) return NextResponse.json({ error: 'ACTIONBRIDGE_TARGET_NOT_FOUND' }, { status: 404 });

  const target = toActionBridgeTarget(row);
  const liveCheck = await runActionBridgeTargetLiveCheck(target);
  const { data, error } = await (supabase as any)
    .from('actionbridge_targets')
    .update({
      ownership_status: liveCheck.ownershipStatus,
      script_status: liveCheck.scriptStatus,
      connection_status: liveCheck.connectionStatus,
      status_metadata: liveCheck.metadata,
      updated_at: new Date().toISOString(),
    })
    .eq('id', targetId)
    .eq('owner_user_id', user!.id)
    .eq('provider_id', providerId)
    .eq('tenant_id', tenantId)
    .select('id,provider_id,tenant_id,owner_user_id,url,origin,hostname,bridge_origin,ownership_status,script_status,connection_status,capabilities,status_metadata,created_at,updated_at')
    .single();

  if (error || !data) return NextResponse.json({ error: 'ACTIONBRIDGE_TARGET_LIVE_CHECK_FAILED' }, { status: 409 });
  return NextResponse.json({ version: 'actionbridge.targets.live_check.v1', target: toActionBridgeTarget(data), execution: { mode: 'bounded_get_script_detection', networkExecution: true } }, {
    headers: createActionBridgeRateLimitHeaders({ policyName: 'domainVerification', remaining: rateLimit.remaining, resetAt: rateLimit.resetAt }),
  });
}
