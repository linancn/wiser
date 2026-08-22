import type { NextRequest } from 'next/server';

import {
  DataFoundationApiError,
  loadDataFoundationWebConfig,
  proxyDataFoundationGeoRequest,
  type DataFoundationAuthClient,
} from '@/lib/data-foundation-dal.server';
import { createWiserServerSupabaseClient } from '@/lib/supabase/server';

interface GeoRouteContext {
  readonly params: Promise<{ readonly path: readonly string[] }>;
}

function errorResponse(error: unknown): Response {
  const status = error instanceof DataFoundationApiError ? error.status : 503;
  return Response.json(
    {
      code: 'GEO_PROXY_FAILED',
      message:
        '地图资源请求未完成。 / The map resource request could not be completed.',
    },
    {
      status,
      headers: {
        'cache-control':
          'private, no-cache, no-store, max-age=0, must-revalidate',
      },
    },
  );
}

async function handle(
  request: NextRequest,
  context: GeoRouteContext,
): Promise<Response> {
  const config = loadDataFoundationWebConfig(process.env);
  if (config === null) {
    return errorResponse(new DataFoundationApiError('configuration', 503));
  }
  try {
    return await proxyDataFoundationGeoRequest({
      request,
      path: (await context.params).path,
      config,
      createAuthClient: async () =>
        (await createWiserServerSupabaseClient()) as DataFoundationAuthClient | null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export const GET = handle;
export const HEAD = handle;
