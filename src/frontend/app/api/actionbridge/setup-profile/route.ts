export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { normalizeActionBridgeSetupProfile } from '@/lib/actionbridge/setup-profile';
import { redactActionBridgeValue } from '@/lib/actionbridge/redaction';

async function requireActionBridgeUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { supabase, user: null, response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
  }
  return { supabase, user, response: null };
}

export async function POST(request: NextRequest) {
  const { response } = await requireActionBridgeUser();
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const bodyObject = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};

  if ('secretRef' in bodyObject || 'secret_ref' in bodyObject || 'secretValue' in bodyObject || 'secret_value' in bodyObject) {
    return NextResponse.json({
      error: 'ACTIONBRIDGE_SECRET_STORAGE_NOT_CONFIGURED',
      redactedInput: redactActionBridgeValue(bodyObject),
    }, { status: 400 });
  }

  const profile = normalizeActionBridgeSetupProfile(bodyObject);
  if (!profile) {
    return NextResponse.json({
      error: 'INVALID_ACTIONBRIDGE_SETUP_PROFILE',
      redactedInput: redactActionBridgeValue(bodyObject),
    }, { status: 400 });
  }

  return NextResponse.json({ profile });
}
