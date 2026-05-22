import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type ActionBridgeSupabaseClient = SupabaseClient<any>;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`ACTIONBRIDGE_MISSING_SERVER_ENV:${name}`);
  }
  return value;
}

export function createCoreServiceClient(): ActionBridgeSupabaseClient {
  return createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  ) as ActionBridgeSupabaseClient;
}
