import type { Locale } from './i18n';

export interface WiserWebAuthClient {
  readonly auth: {
    signInWithPassword(credentials: {
      readonly email: string;
      readonly password: string;
    }): Promise<{ readonly error: unknown }>;
    exchangeCodeForSession(code: string): Promise<{ readonly error: unknown }>;
    getClaims(): Promise<{
      readonly data: { readonly claims?: unknown } | null;
      readonly error: unknown;
    }>;
    signOut(options: {
      readonly scope: 'local';
    }): Promise<{ readonly error: unknown }>;
  };
}

export interface WiserAuthViewer {
  readonly userId: string;
  readonly sessionId: string;
  readonly email: string | null;
}

export type AuthFailureReason =
  'callback' | 'configuration' | 'credentials' | 'fields' | 'session';

interface ClaimsRecord {
  readonly sub?: unknown;
  readonly session_id?: unknown;
  readonly role?: unknown;
  readonly exp?: unknown;
  readonly email?: unknown;
}

interface AuthRouteServiceOptions {
  readonly createClient: () => Promise<WiserWebAuthClient | null>;
  readonly now?: () => Date;
}

export interface AuthRouteService {
  login(request: Request, locale: Locale): Promise<Response>;
  callback(request: Request, locale: Locale): Promise<Response>;
  signOut(request: Request, locale: Locale): Promise<Response>;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;
const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-cache, no-store, max-age=0, must-revalidate',
  Expires: '0',
  Pragma: 'no-cache',
} as const;

function claimsRecord(value: unknown): ClaimsRecord | null {
  return typeof value === 'object' && value !== null ? value : null;
}

function safeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim();
  return email.length > 0 && email.length <= 320 && EMAIL_PATTERN.test(email)
    ? email
    : null;
}

function fallbackRedirect(locale: Locale): string {
  return `/${locale}/scenarios`;
}

export function safeLocalizedRedirect(
  candidate: string | null | undefined,
  locale: Locale,
): string {
  const fallback = fallbackRedirect(locale);
  if (candidate === null || candidate === undefined) return fallback;
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return fallback;
  try {
    const parsed = new URL(candidate, 'https://wiser.invalid');
    if (parsed.origin !== 'https://wiser.invalid') return fallback;
    const localeRoot = `/${locale}`;
    if (
      parsed.pathname !== localeRoot &&
      !parsed.pathname.startsWith(`${localeRoot}/`)
    ) {
      return fallback;
    }
    if (
      parsed.pathname === `${localeRoot}/login` ||
      parsed.pathname.startsWith(`${localeRoot}/auth/`)
    ) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export async function readVerifiedAuthViewer(
  client: WiserWebAuthClient,
  options: { readonly now?: () => Date } = {},
): Promise<WiserAuthViewer | null> {
  const now = options.now ?? (() => new Date());
  try {
    const result = await client.auth.getClaims();
    if (result.error !== null) return null;
    const claims = claimsRecord(result.data?.claims);
    if (
      claims === null ||
      claims.role !== 'authenticated' ||
      typeof claims.sub !== 'string' ||
      !UUID_PATTERN.test(claims.sub) ||
      typeof claims.session_id !== 'string' ||
      !UUID_PATTERN.test(claims.session_id) ||
      typeof claims.exp !== 'number' ||
      !Number.isSafeInteger(claims.exp) ||
      claims.exp * 1_000 <= now().valueOf()
    ) {
      return null;
    }
    return {
      userId: claims.sub,
      sessionId: claims.session_id,
      email: safeEmail(claims.email),
    };
  } catch {
    return null;
  }
}

function redirectResponse(request: Request, target: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      ...NO_STORE_HEADERS,
      Location: new URL(target, request.url).toString(),
    },
  });
}

function errorRedirect(
  request: Request,
  locale: Locale,
  reason: AuthFailureReason,
  next: string,
): Response {
  const query = new URLSearchParams({ reason });
  if (next !== fallbackRedirect(locale)) query.set('next', next);
  return redirectResponse(request, `/${locale}/login?${query.toString()}`);
}

async function localSignOut(client: WiserWebAuthClient): Promise<void> {
  try {
    await client.auth.signOut({ scope: 'local' });
  } catch {
    // The caller still returns a fail-closed session result.
  }
}

async function routeClient(
  createClient: AuthRouteServiceOptions['createClient'],
): Promise<WiserWebAuthClient | null> {
  try {
    return await createClient();
  } catch {
    return null;
  }
}

export function createAuthRouteService(
  options: AuthRouteServiceOptions,
): AuthRouteService {
  const now = options.now ?? (() => new Date());
  return {
    async login(request, locale) {
      let formData: FormData;
      try {
        formData = await request.formData();
      } catch {
        return errorRedirect(
          request,
          locale,
          'fields',
          fallbackRedirect(locale),
        );
      }
      const rawEmail = formData.get('email');
      const rawPassword = formData.get('password');
      const rawNext = formData.get('next');
      const next = safeLocalizedRedirect(
        typeof rawNext === 'string' ? rawNext : null,
        locale,
      );
      const email = typeof rawEmail === 'string' ? rawEmail.trim() : '';
      const password = typeof rawPassword === 'string' ? rawPassword : '';
      if (
        email.length === 0 ||
        email.length > 320 ||
        !EMAIL_PATTERN.test(email) ||
        password.length === 0 ||
        password.length > 4_096
      ) {
        return errorRedirect(request, locale, 'fields', next);
      }

      const client = await routeClient(options.createClient);
      if (client === null) {
        return errorRedirect(request, locale, 'configuration', next);
      }
      try {
        const result = await client.auth.signInWithPassword({
          email,
          password,
        });
        if (result.error !== null) {
          return errorRedirect(request, locale, 'credentials', next);
        }
      } catch {
        return errorRedirect(request, locale, 'credentials', next);
      }
      const viewer = await readVerifiedAuthViewer(client, { now });
      if (viewer === null) {
        await localSignOut(client);
        return errorRedirect(request, locale, 'session', next);
      }
      return redirectResponse(request, next);
    },

    async callback(request, locale) {
      const requestUrl = new URL(request.url);
      const next = safeLocalizedRedirect(
        requestUrl.searchParams.get('next'),
        locale,
      );
      const code = requestUrl.searchParams.get('code');
      if (code === null || code.length === 0 || code.length > 2_048) {
        return errorRedirect(request, locale, 'callback', next);
      }
      const client = await routeClient(options.createClient);
      if (client === null) {
        return errorRedirect(request, locale, 'configuration', next);
      }
      try {
        const result = await client.auth.exchangeCodeForSession(code);
        if (result.error !== null) {
          return errorRedirect(request, locale, 'callback', next);
        }
      } catch {
        return errorRedirect(request, locale, 'callback', next);
      }
      const viewer = await readVerifiedAuthViewer(client, { now });
      if (viewer === null) {
        await localSignOut(client);
        return errorRedirect(request, locale, 'session', next);
      }
      return redirectResponse(request, next);
    },

    async signOut(request, locale) {
      const client = await routeClient(options.createClient);
      if (client !== null) await localSignOut(client);
      return redirectResponse(request, `/${locale}/login?signedOut=1`);
    },
  };
}
