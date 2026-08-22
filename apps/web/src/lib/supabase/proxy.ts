import { createServerClient, type CookieMethodsServer } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

export interface WebSupabaseConfig {
  readonly supabaseUrl: string;
  readonly supabasePublishableKey: string;
}

type RequiredCookieMethods = {
  getAll: CookieMethodsServer['getAll'];
  setAll: NonNullable<CookieMethodsServer['setAll']>;
};

export interface SupabaseProxyClient {
  readonly auth: {
    getClaims(): Promise<unknown>;
  };
}

export type SupabaseServerClientFactory = (
  url: string,
  publishableKey: string,
  options: { readonly cookies: RequiredCookieMethods },
) => SupabaseProxyClient;

function validHttpUrl(value: string | undefined): value is string {
  if (value === undefined) return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function loadWebSupabaseConfig(
  environment: NodeJS.ProcessEnv,
): WebSupabaseConfig | null {
  const production = environment['NODE_ENV'] === 'production';
  const mode =
    environment['WISER_AUTH_MODE'] ?? (production ? 'supabase' : 'off');
  if (mode === 'off') {
    if (production) {
      throw new Error('WISER_AUTH_MODE=off is forbidden in production.');
    }
    return null;
  }
  if (mode !== 'supabase') {
    throw new Error('WISER_AUTH_MODE must be off or supabase.');
  }

  const browserSupabaseUrl = environment['NEXT_PUBLIC_SUPABASE_URL'];
  const supabaseUrl = environment['SUPABASE_URL'] ?? browserSupabaseUrl;
  const supabasePublishableKey =
    environment['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
  if (!validHttpUrl(browserSupabaseUrl)) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is required for Supabase Auth.');
  }
  if (!validHttpUrl(supabaseUrl)) {
    throw new Error('SUPABASE_URL must be a valid internal Supabase origin.');
  }
  if (
    supabasePublishableKey === undefined ||
    supabasePublishableKey.length < 24
  ) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required for Supabase Auth.',
    );
  }
  return { supabaseUrl, supabasePublishableKey };
}

const defaultCreateClient: SupabaseServerClientFactory = (
  url,
  publishableKey,
  options,
) => createServerClient(url, publishableKey, options);

export async function updateSupabaseSession(
  request: NextRequest,
  options: {
    readonly config: WebSupabaseConfig | null;
    readonly createClient?: SupabaseServerClientFactory;
  },
): Promise<NextResponse> {
  if (options.config === null) {
    const localResponse = NextResponse.next({ request });
    localResponse.headers.set(
      'Cache-Control',
      'private, no-cache, no-store, max-age=0, must-revalidate',
    );
    localResponse.headers.set('Expires', '0');
    localResponse.headers.set('Pragma', 'no-cache');
    return localResponse;
  }

  let response = NextResponse.next({ request });
  const createClient = options.createClient ?? defaultCreateClient;
  const supabase = createClient(
    options.config.supabaseUrl,
    options.config.supabasePublishableKey,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, responseHeaders) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options: cookieOptions } of cookiesToSet) {
            response.cookies.set(name, value, cookieOptions);
          }
          for (const [name, value] of Object.entries(responseHeaders)) {
            response.headers.set(name, value);
          }
        },
      },
    },
  );
  await supabase.auth.getClaims();
  if (!response.headers.get('Cache-Control')?.includes('no-store')) {
    response.headers.set(
      'Cache-Control',
      'private, no-cache, no-store, max-age=0, must-revalidate',
    );
  }
  if (!response.headers.has('Expires')) response.headers.set('Expires', '0');
  if (!response.headers.has('Pragma'))
    response.headers.set('Pragma', 'no-cache');
  return response;
}
