import 'server-only';

import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ActionBridgeUserSupabaseClient = SupabaseClient<any>;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`ACTIONBRIDGE_MISSING_SERVER_ENV:${name}`);
  }
  return value;
}

export async function createClient(): Promise<ActionBridgeUserSupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components cannot set cookies; API routes can. Supabase SSR
            // documents this fail-soft branch for read-only server contexts.
          }
        },
      },
    },
  ) as ActionBridgeUserSupabaseClient;
}
