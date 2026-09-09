import {
  DataFoundationApiError,
  loadDataFoundationWebConfig,
  proxyDataFoundationAssetRequest,
  type DataFoundationAuthClient,
} from '@/lib/data-foundation-dal.server';
import { createWiserServerSupabaseClient } from '@/lib/supabase/server';
import { getDictionary, isLocale } from '@/lib/i18n';

async function handle(
  request: Request,
  context: { params: Promise<{ versionId: string; assetId: string }> },
) {
  try {
    const config = loadDataFoundationWebConfig(process.env);
    if (!config) throw new DataFoundationApiError('configuration', 503);
    return await proxyDataFoundationAssetRequest({
      request,
      ...(await context.params),
      config,
      createAuthClient: async () =>
        (await createWiserServerSupabaseClient()) as DataFoundationAuthClient | null,
    });
  } catch (error) {
    const locale = new URL(request.url).searchParams.get('locale');
    return new Response(
      getDictionary(
        isLocale(locale ?? '') ? (locale as 'en' | 'zh-CN') : 'zh-CN',
      ).dataFoundation.explorer.unavailable,
      {
        status: error instanceof DataFoundationApiError ? error.status : 503,
        headers: {
          'cache-control': 'private, no-store',
          'content-type': 'text/plain; charset=utf-8',
          'x-content-type-options': 'nosniff',
        },
      },
    );
  }
}
export const GET = handle;
export const HEAD = handle;
