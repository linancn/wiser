import { createAuthRouteService } from '@/lib/auth';
import { isLocale } from '@/lib/i18n';
import { createWiserServerSupabaseClient } from '@/lib/supabase/server';

interface RouteContext {
  readonly params: Promise<{ readonly locale: string }>;
}

const service = createAuthRouteService({
  createClient: createWiserServerSupabaseClient,
});

export async function GET(request: Request, context: RouteContext) {
  const { locale } = await context.params;
  if (!isLocale(locale)) {
    return new Response(null, {
      status: 404,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
  return service.callback(request, locale);
}
