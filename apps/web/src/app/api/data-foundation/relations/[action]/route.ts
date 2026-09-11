import {
  getDataFoundationDal,
  DataFoundationApiError,
} from '@/lib/data-foundation-dal.server';
import { isSameOriginRequest } from '@/lib/request-origin';

const headers = { 'cache-control': 'private, no-store' };
export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
): Promise<Response> {
  const { action } = await context.params;
  if (
    action !== 'import' &&
    action !== 'list' &&
    action !== 'get' &&
    action !== 'review'
  )
    return Response.json({ code: 'NOT_FOUND' }, { status: 404, headers });
  if (!isSameOriginRequest(request)) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403, headers });
  }
  const reader = request.body?.getReader();
  if (reader === undefined)
    return Response.json({ code: 'INVALID_QUERY' }, { status: 422, headers });
  try {
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 262144) {
        await reader.cancel();
        return Response.json(
          { code: 'INVALID_QUERY' },
          { status: 413, headers },
        );
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let position = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, position);
      position += chunk.byteLength;
    }
    const input: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    );
    const dal = await getDataFoundationDal();
    return Response.json(
      await dal.relations(
        action,
        input,
        request.headers.get('Idempotency-Key') ?? undefined,
      ),
      { headers },
    );
  } catch (error) {
    const status =
      error instanceof DataFoundationApiError
        ? error.status
        : error instanceof SyntaxError || error instanceof TypeError
          ? 422
          : 503;
    return Response.json({ code: 'EXPLORATION_FAILED' }, { status, headers });
  } finally {
    reader.releaseLock();
  }
}
