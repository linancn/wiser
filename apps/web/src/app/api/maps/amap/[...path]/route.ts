import { amapService } from '@/lib/amap-service.server';
import { createWiserServerSupabaseClient } from '@/lib/supabase/server';
import { verifiedSessionAccessToken } from '@/lib/supabase/verified-session';

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  return amapService(request, (await context.params).path, {
    key: process.env['WISER_AMAP_KEY'],
    securityCode: process.env['WISER_AMAP_SECURITY_CODE'],
    verifySession: async () => {
      await verifiedSessionAccessToken(
        createWiserServerSupabaseClient,
        () => new Date(),
      );
      return true;
    },
  });
}
