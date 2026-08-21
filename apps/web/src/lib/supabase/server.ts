import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { loadWebSupabaseConfig } from './proxy';

export async function createWiserServerSupabaseClient() {
  const config = loadWebSupabaseConfig(process.env);
  if (config === null) return null;
  const cookieStore = await cookies();
  return createServerClient(config.supabaseUrl, config.supabasePublishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies; proxy.ts performs refresh.
        }
      },
    },
  });
}
