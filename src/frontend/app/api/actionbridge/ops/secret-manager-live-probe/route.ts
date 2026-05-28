export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createCoreServiceClient } from '@/lib/core/service-client';
import { persistActionBridgeControlAuditEvent } from '@/lib/actionbridge/persistence';
import { enforceActionBridgeRateLimitAsync } from '@/lib/actionbridge/rate-limit';
import { handleActionBridgeSecretManagerLiveProbe } from '@/lib/actionbridge/secret-manager-live-probe-route';
import { probeActionBridgeSecretManagerLiveAccess } from '@/lib/actionbridge/webhook-signing';

function tryCreateServiceClient() {
  try {
    return createCoreServiceClient();
  } catch {
    return null;
  }
}

async function serializeRateLimitResponse(response: NextResponse | undefined): Promise<{
  status?: number;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}> {
  if (!response) return {};
  const body = await response.clone().json().catch(() => null);
  return {
    status: response.status,
    body: body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : undefined,
    headers: Object.fromEntries(response.headers.entries()),
  };
}

export async function POST(request: NextRequest) {
  const result = await handleActionBridgeSecretManagerLiveProbe({
    request,
    readBody: () => request.json().catch(() => ({})),
    createUserClient: createClient,
    tryCreateServiceClient,
    enforceRateLimit: async ({ request: rateLimitRequest, userId, connectorId }) => {
      const rateLimit = await enforceActionBridgeRateLimitAsync({
        request: rateLimitRequest as NextRequest,
        policyName: 'secretManagerLiveProbe',
        discriminator: `${userId}|${connectorId}`,
      });
      const serialized = await serializeRateLimitResponse(rateLimit.response);
      return {
        ok: rateLimit.ok,
        keyDigest: rateLimit.keyDigest,
        responseStatus: serialized.status,
        responseBody: serialized.body,
        responseHeaders: serialized.headers,
      };
    },
    probeLiveAccess: ({ secretRef }) => probeActionBridgeSecretManagerLiveAccess({ secretRef }),
    persistAudit: (serviceSupabase, auditInput) => persistActionBridgeControlAuditEvent(serviceSupabase as any, auditInput),
  });

  return NextResponse.json(result.body, { status: result.status, headers: result.headers });
}
