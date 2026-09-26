import { getAgentConnectionAccount } from '@/lib/agent-connections.server';
import { isLocale } from '@/lib/i18n';
import { PlatformUuidSchema } from '@wiser/platform-contracts';

const headers = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
};
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly locale: string }> },
) {
  const { locale } = await context.params;
  if (!isLocale(locale)) return new Response(null, { status: 404, headers });
  const expected =
    process.env.WISER_PUBLIC_WEB_ORIGIN ??
    (process.env.NODE_ENV === 'production'
      ? null
      : new URL(request.url).origin);
  if (!expected || request.headers.get('origin') !== expected)
    return new Response(null, { status: 403, headers });
  if (
    request.headers.get('content-type')?.split(';')[0] !==
    'application/x-www-form-urlencoded'
  )
    return new Response(null, { status: 415, headers });
  const back = (result: string) =>
    new Response(null, {
      status: 303,
      headers: {
        ...headers,
        Location: `/${locale}/account/agents?result=${result}`,
      },
    });
  const reader = request.body?.getReader();
  if (!reader) return back('unavailable');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 1024) {
        await reader.cancel();
        return new Response(null, { status: 413, headers });
      }
      chunks.push(part.value);
    }
    const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
    const values = form.getAll('connectionId');
    if (
      values.length !== 1 ||
      !PlatformUuidSchema.safeParse(values[0]).success ||
      [...form.keys()].some((key) => key !== 'connectionId')
    )
      return back('unavailable');
    const account = await getAgentConnectionAccount();
    return back(await account.disconnect(values[0]));
  } catch {
    return back('unavailable');
  } finally {
    reader.releaseLock();
  }
}
