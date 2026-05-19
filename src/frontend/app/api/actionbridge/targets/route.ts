export const dynamic = 'force-dynamic';

import dns from 'node:dns/promises';
import https from 'node:https';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createCoreServiceClient } from '@/lib/core/service-client';
import {
  ACTIONBRIDGE_DEFAULT_BRIDGE_ORIGIN,
  ACTIONBRIDGE_DEFAULT_PROVIDER_ID,
  createActionBridgeTargetsFromUrls,
  createActionBridgeTargetToolCatalog,
  normalizeActionBridgeTargetUrl,
} from '@/lib/actionbridge/multi-target-registry';
import type { ActionBridgeTarget } from '@/lib/actionbridge/types';
import { createActionBridgeRateLimitHeaders, enforceActionBridgeRateLimit } from '@/lib/actionbridge/rate-limit';
import { decideActionBridgeDnsPinning } from '@/lib/actionbridge/dns-ip-guard';

const MAX_LIVE_CHECK_BYTES = 250_000;

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

async function bootstrapTenantMembershipIfEmpty(supabase: any, input: { providerId: string; tenantId: string; userId: string }) {
  const { count, error } = await supabase
    .from('actionbridge_tenant_memberships')
    .select('user_id', { count: 'exact', head: true })
    .eq('provider_id', input.providerId)
    .eq('tenant_id', input.tenantId);
  if (error || count !== 0) return { ok: false };
  const serviceSupabase = createCoreServiceClient();
  if (!serviceSupabase) return { ok: false };
  const { error: insertError } = await (serviceSupabase as any)
    .from('actionbridge_tenant_memberships')
    .insert({ provider_id: input.providerId, tenant_id: input.tenantId, user_id: input.userId, role: 'owner' });
  return { ok: !insertError };
}

async function requireTenantMembership(supabase: any, input: { providerId: string; tenantId: string; userId: string; write?: boolean; bootstrapIfEmpty?: boolean }) {
  const { data, error } = await supabase
    .from('actionbridge_tenant_memberships')
    .select('role')
    .eq('provider_id', input.providerId)
    .eq('tenant_id', input.tenantId)
    .eq('user_id', input.userId)
    .maybeSingle();
  if (error || !data) {
    if (input.bootstrapIfEmpty) {
      const bootstrap = await bootstrapTenantMembershipIfEmpty(supabase, input);
      if (bootstrap.ok) return requireTenantMembership(supabase, { ...input, bootstrapIfEmpty: false });
    }
    return { ok: false, response: NextResponse.json({ error: 'ACTIONBRIDGE_TARGET_TENANT_FORBIDDEN' }, { status: 403 }) };
  }
  if (input.write && !['owner', 'operator'].includes(data.role)) return { ok: false, response: NextResponse.json({ error: 'ACTIONBRIDGE_TARGET_TENANT_FORBIDDEN' }, { status: 403 }) };
  return { ok: true };
}

function safeThemeValue(value: string | null, type: 'color' | 'density' | 'language') {
  if (!value) return undefined;
  if (type === 'density') return value === 'compact' || value === 'comfortable' ? value : undefined;
  if (type === 'language') return value === 'de' || value === 'en' ? value : undefined;
  return /^#[0-9a-f]{3,8}$/i.test(value) || /^rgba?\([0-9.,%\s]+\)$/i.test(value) || /^[a-z]{3,32}$/i.test(value) ? value.slice(0, 80) : undefined;
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

function validateStoredTargetForLiveCheck(target: ActionBridgeTarget) {
  const normalized = normalizeActionBridgeTargetUrl(target.url);
  if (!normalized.ok || normalized.url !== target.url || normalized.origin !== target.origin || normalized.hostname !== target.hostname) {
    return { ok: false, reason: 'Stored target URL failed defensive revalidation.' };
  }
  return { ok: true };
}

function detectActionBridgeBridgeScript(input: { html: string; target: ActionBridgeTarget }) {
  const boundedBody = input.html.slice(0, MAX_LIVE_CHECK_BYTES);
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

function getPinnedHttpsText(input: { target: URL; pinnedAddress: string; timeoutMs: number; maxBytes: number }): Promise<{ ok: boolean; status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: 'https:',
      host: input.pinnedAddress,
      servername: input.target.hostname,
      port: input.target.port ? Number(input.target.port) : 443,
      method: 'GET',
      path: '/',
      timeout: input.timeoutMs,
      headers: {
        Host: input.target.host,
        Accept: 'text/html;q=0.9,text/plain;q=0.5',
        'Accept-Encoding': 'identity',
        'User-Agent': 'ActionBridge-Script-Check/1.0',
      },
    }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400) {
        response.resume();
        resolve({ ok: false, status, text: 'ActionBridge target redirect blocked.' });
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > input.maxBytes) {
          request.destroy(new Error('ACTIONBRIDGE_TARGET_RESPONSE_TOO_LARGE'));
          return;
        }
        chunks.push(buffer);
      });
      response.on('end', () => resolve({ ok: status >= 200 && status < 300, status, text: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('timeout', () => request.destroy(new Error('ACTIONBRIDGE_TARGET_LIVE_CHECK_TIMEOUT')));
    request.on('error', reject);
    request.end();
  });
}

async function runActionBridgeTargetLiveCheck(target: ActionBridgeTarget) {
  try {
    const validTarget = validateStoredTargetForLiveCheck(target);
    if (!validTarget.ok) return { ownershipStatus: 'pending', scriptStatus: 'error', connectionStatus: 'error', metadata: { networkExecution: false, error: 'ACTIONBRIDGE_TARGET_LIVE_CHECK_FAILED', reason: validTarget.reason } };

    const targetUrl = new URL(target.url);
    const addresses = await dns.lookup(target.hostname, { all: true, verbatim: true });
    const dnsDecision = decideActionBridgeDnsPinning({
      hostname: target.hostname,
      addresses: addresses.map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 })),
      networkExecution: false,
    });
    if (!dnsDecision.ok || !addresses[0]?.address) {
      return { ownershipStatus: 'pending', scriptStatus: 'unreachable', connectionStatus: 'unreachable', metadata: { networkExecution: false, error: 'ACTIONBRIDGE_TARGET_LIVE_CHECK_FAILED', reason: dnsDecision.reason || 'DNS resolution returned no address.' } };
    }

    const response = await getPinnedHttpsText({ target: targetUrl, pinnedAddress: addresses[0].address, timeoutMs: 5000, maxBytes: MAX_LIVE_CHECK_BYTES });
    if (!response.ok) return { ownershipStatus: 'pending', scriptStatus: 'unreachable', connectionStatus: 'unreachable', metadata: { networkExecution: 'pinned_bounded_get_only', httpStatus: response.status } };
    const detection = detectActionBridgeBridgeScript({ html: response.text, target });
    return {
      ownershipStatus: detection.scriptStatus === 'connected' ? 'verified' : 'pending',
      scriptStatus: detection.scriptStatus,
      connectionStatus: detection.connectionStatus,
      metadata: { networkExecution: 'pinned_bounded_get_only', checkedAt: new Date().toISOString(), httpStatus: response.status, scriptFound: detection.scriptFound, targetBound: detection.targetBound, maxBytesInspected: MAX_LIVE_CHECK_BYTES },
    };
  } catch (error) {
    return { ownershipStatus: 'pending', scriptStatus: 'error', connectionStatus: 'error', metadata: { networkExecution: 'pinned_bounded_get_only', error: 'ACTIONBRIDGE_TARGET_LIVE_CHECK_FAILED', reason: error instanceof Error ? error.message : 'live_check_failed' } };
  }
}

async function listTargets(supabase: any, input: { providerId: string; tenantId: string }) {
  const { data: targetRows, error } = await supabase
    .from('actionbridge_targets')
    .select('id,provider_id,tenant_id,owner_user_id,url,origin,hostname,bridge_origin,ownership_status,script_status,connection_status,capabilities,status_metadata,created_at,updated_at')
    .eq('provider_id', input.providerId)
    .eq('tenant_id', input.tenantId)
    .order('created_at', { ascending: false })
    .limit(200);
  return { targets: (targetRows || []).map(toActionBridgeTarget), error };
}

export async function GET(request: NextRequest) {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;
  const url = new URL(request.url);
  const tenantId = safeTenantId(url.searchParams.get('tenant_id') || url.searchParams.get('tenantId'));
  if (!tenantId) return NextResponse.json({ error: 'ACTIONBRIDGE_TARGET_TENANT_REQUIRED' }, { status: 400 });
  const providerId = ACTIONBRIDGE_DEFAULT_PROVIDER_ID;
  const membership = await requireTenantMembership(supabase as any, { providerId, tenantId, userId: user!.id });
  if (!membership.ok) return membership.response!;
  const rateLimit = enforceActionBridgeRateLimit({ request, policyName: 'domainVerification', discriminator: `${providerId}|${tenantId}|targets:list` });
  if (!rateLimit.ok) return rateLimit.response!;

  const { targets, error } = await listTargets(supabase as any, { providerId, tenantId });
  if (error) return NextResponse.json({ error: 'ACTIONBRIDGE_TARGET_LIST_FAILED' }, { status: 500 });
  return NextResponse.json({
    version: 'actionbridge.targets.v1',
    targets,
    catalog: createActionBridgeTargetToolCatalog({ scope: { providerId, tenantId, ownerUserId: user!.id }, targets }),
    embeddedSetup: { version: 'actionbridge.host_theme_tokens.v1', theme: {
      primaryColor: safeThemeValue(url.searchParams.get('primaryColor'), 'color'),
      cardColor: safeThemeValue(url.searchParams.get('cardColor'), 'color'),
      density: safeThemeValue(url.searchParams.get('density'), 'density') || 'compact',
      language: safeThemeValue(url.searchParams.get('language'), 'language') || 'de',
    } },
  }, { headers: createActionBridgeRateLimitHeaders({ policyName: 'domainVerification', remaining: rateLimit.remaining, resetAt: rateLimit.resetAt }) });
}

export async function POST(request: NextRequest) {
  const { supabase, user, response } = await requireActionBridgeUser();
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  const tenantId = safeTenantId(body.tenantId ?? body.tenant_id);
  if (!tenantId) return NextResponse.json({ error: 'ACTIONBRIDGE_TARGET_TENANT_REQUIRED' }, { status: 400 });
  if (!Array.isArray(body.urls) || body.urls.length < 1 || body.urls.length > 50 || !body.urls.every((item: unknown) => typeof item === 'string')) return NextResponse.json({ error: 'ACTIONBRIDGE_TARGET_URLS_REQUIRED' }, { status: 400 });
  const providerId = ACTIONBRIDGE_DEFAULT_PROVIDER_ID;
  const membership = await requireTenantMembership(supabase as any, { providerId, tenantId, userId: user!.id, write: true, bootstrapIfEmpty: true });
  if (!membership.ok) return membership.response!;
  const rateLimit = enforceActionBridgeRateLimit({ request, policyName: 'domainVerification', discriminator: `${providerId}|${tenantId}|targets:intake` });
  if (!rateLimit.ok) return rateLimit.response!;

  const intake = createActionBridgeTargetsFromUrls({ scope: { providerId, tenantId, ownerUserId: user!.id, bridgeOrigin: ACTIONBRIDGE_DEFAULT_BRIDGE_ORIGIN }, urls: body.urls });
  if (intake.accepted.length) {
    const { error } = await (supabase as any).from('actionbridge_targets').upsert(intake.accepted.map(toActionBridgeTargetRow), { onConflict: 'provider_id,tenant_id,origin' });
    if (error) return NextResponse.json({ error: 'ACTIONBRIDGE_TARGET_INTAKE_FAILED' }, { status: 500 });
  }
  const { targets } = await listTargets(supabase as any, { providerId, tenantId });
  return NextResponse.json({ version: 'actionbridge.targets.intake.v1', tenantId, targets, accepted: intake.accepted.map((target) => ({ id: target.id, origin: target.origin, connectionStatus: target.connectionStatus })), rejected: intake.rejected, duplicates: intake.duplicates, catalog: createActionBridgeTargetToolCatalog({ scope: { providerId, tenantId, ownerUserId: user!.id }, targets }), execution: { mode: 'registry_write_only', networkExecution: false } }, { status: 201, headers: createActionBridgeRateLimitHeaders({ policyName: 'domainVerification', remaining: rateLimit.remaining, resetAt: rateLimit.resetAt }) });
}

export async function PATCH() {
  return NextResponse.json({ error: 'ACTIONBRIDGE_MANUAL_TARGET_STATUS_DISABLED' }, { status: 410 });
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
  const membership = await requireTenantMembership(supabase as any, { providerId, tenantId, userId: user!.id, write: true });
  if (!membership.ok) return membership.response!;
  const rateLimit = enforceActionBridgeRateLimit({ request, policyName: 'domainVerification', discriminator: `${providerId}|${tenantId}|targets:live-check` });
  if (!rateLimit.ok) return rateLimit.response!;

  const { data: row, error: readError } = await (supabase as any)
    .from('actionbridge_targets')
    .select('id,provider_id,tenant_id,owner_user_id,url,origin,hostname,bridge_origin,ownership_status,script_status,connection_status,capabilities,status_metadata,created_at,updated_at')
    .eq('id', targetId)
    .eq('provider_id', providerId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (readError || !row) return NextResponse.json({ error: 'ACTIONBRIDGE_TARGET_NOT_FOUND' }, { status: 404 });

  const liveCheck = await runActionBridgeTargetLiveCheck(toActionBridgeTarget(row));
  const { data, error } = await (supabase as any)
    .from('actionbridge_targets')
    .update({ ownership_status: liveCheck.ownershipStatus, script_status: liveCheck.scriptStatus, connection_status: liveCheck.connectionStatus, status_metadata: liveCheck.metadata, updated_at: new Date().toISOString() })
    .eq('id', targetId)
    .eq('provider_id', providerId)
    .eq('tenant_id', tenantId)
    .select('id,provider_id,tenant_id,owner_user_id,url,origin,hostname,bridge_origin,ownership_status,script_status,connection_status,capabilities,status_metadata,created_at,updated_at')
    .single();
  if (error || !data) return NextResponse.json({ error: 'ACTIONBRIDGE_TARGET_LIVE_CHECK_FAILED' }, { status: 409 });
  return NextResponse.json({ version: 'actionbridge.targets.live_check.v1', target: toActionBridgeTarget(data), execution: { mode: 'pinned_bounded_get_script_detection', networkExecution: true } }, { headers: createActionBridgeRateLimitHeaders({ policyName: 'domainVerification', remaining: rateLimit.remaining, resetAt: rateLimit.resetAt }) });
}
