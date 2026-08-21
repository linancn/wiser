import { isLocale } from '@/lib/i18n';
import { createAuthRouteService } from '@/lib/auth';
import { createWiserServerSupabaseClient } from '@/lib/supabase/server';

interface RouteContext {
  readonly params: Promise<{ readonly locale: string }>;
}

const service = createAuthRouteService({
  createClient: createWiserServerSupabaseClient,
});

export async function POST(request: Request, context: RouteContext) {
  const { locale } = await context.params;
  if (!isLocale(locale)) {
    return new Response(null, {
      status: 404,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
  return service.login(request, locale);
}
