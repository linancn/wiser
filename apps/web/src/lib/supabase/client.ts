'use client';

import { createBrowserClient } from '@supabase/ssr';

export function createWiserBrowserSupabaseClient() {
  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const supabasePublishableKey =
    process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
  if (supabaseUrl === undefined || supabasePublishableKey === undefined) {
    return null;
  }
  return createBrowserClient(supabaseUrl, supabasePublishableKey);
}
