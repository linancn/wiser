import 'server-only';

interface AmapServiceOptions {
  readonly key?: string;
  readonly securityCode?: string;
  readonly verifySession: () => Promise<boolean>;
  readonly fetch?: typeof fetch;
}

const cacheControl = 'private, no-store, max-age=0';
const unavailable = (status: number) =>
  new Response(null, { status, headers: { 'cache-control': cacheControl } });

export async function amapService(
  request: Request,
  path: readonly string[],
  options: AmapServiceOptions,
): Promise<Response> {
  if (request.method !== 'GET') return unavailable(405);
  const name = path.join('/');
  if (
    !['config', 'v4/map/styles', 'v3/assistant/coordinate/convert'].includes(
      name,
    )
  )
    return unavailable(404);
  try {
    if (!(await options.verifySession())) return unavailable(401);
  } catch {
    return unavailable(401);
  }
  if (!options.key || !options.securityCode) return unavailable(503);
  if (name === 'config')
    return Response.json(
      { key: options.key, serviceHost: '/_AMapService', version: '2.0' },
      { headers: { 'cache-control': cacheControl } },
    );
  const url = new URL(request.url);
  if (url.search.length > 16384) return unavailable(400);
  const callback = url.searchParams.get('callback');
  if (
    callback !== null &&
    (url.searchParams.getAll('callback').length !== 1 ||
      !/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(callback))
  )
    return unavailable(400);
  const target = new URL(
    `/${name}`,
    name === 'v4/map/styles'
      ? 'https://webapi.amap.com'
      : 'https://restapi.amap.com',
  );
  target.search = url.search;
  target.searchParams.set('key', options.key);
  target.searchParams.set('jscode', options.securityCode);
  try {
    const response = await (options.fetch ?? fetch)(target, {
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return unavailable(502);
    }
    const reader = response.body?.getReader();
    if (!reader) return unavailable(502);
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.length;
        if (length > 8 * 1024 * 1024) {
          await reader.cancel();
          return unavailable(502);
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }
    let responseBody: Uint8Array<ArrayBuffer> | string = body;
    let contentType =
      response.headers.get('content-type') ?? 'application/json';
    if (callback !== null) {
      const text = new TextDecoder().decode(body).trim().replace(/;$/, '');
      if (!text.startsWith(`${callback}(`) || !text.endsWith(')'))
        return unavailable(502);
      const payload: unknown = JSON.parse(text.slice(callback.length + 1, -1));
      if (payload === null || typeof payload !== 'object')
        return unavailable(502);
      responseBody = `${callback}(${JSON.stringify(payload)});`;
      contentType = 'application/javascript; charset=utf-8';
    }
    return new Response(responseBody, {
      headers: {
        'content-type': contentType,
        'cache-control': cacheControl,
        'x-content-type-options': 'nosniff',
        'cross-origin-resource-policy': 'same-origin',
      },
    });
  } catch {
    return unavailable(502);
  }
}
