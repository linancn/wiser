import { randomUUID } from 'node:crypto';
import { PlatformAgentExchangeViewSchema } from '@wiser/platform-contracts';

import type { McpHttpRequestAuthorizer } from '../http-server.js';
import { createAgentDataRequestHandler } from './agent-server.js';

export interface AgentHttpAuthorizerOptions {
  readonly dataApiUrl: string;
  readonly fetch?: typeof fetch;
}

function exchangeUrl(dataApiUrl: string): URL {
  const url = new URL(dataApiUrl);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/api\/data\/v1\/?$/.test(url.pathname)
  ) {
    throw new Error('Invalid Agent data API URL.');
  }
  url.pathname = '/api/platform/v1/agent-connections/exchange';
  return url;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (
    !response.headers.get('content-type')?.startsWith('application/json') ||
    response.body === null
  )
    throw new Error('Invalid Agent exchange response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const value: unknown = chunk.value;
      if (!(value instanceof Uint8Array))
        throw new Error('Invalid Agent exchange response.');
      size += value.byteLength;
      if (size > 65_536) {
        await reader.cancel();
        throw new Error('Invalid Agent exchange response.');
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    reader.releaseLock();
  }
}

export function createAgentHttpAuthorizer(
  options: AgentHttpAuthorizerOptions,
): McpHttpRequestAuthorizer {
  const url = exchangeUrl(options.dataApiUrl);
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  return async (request) => {
    const token = /^Bearer ([^\s]{1,16384})$/.exec(
      request.headers.authorization ?? '',
    )?.[1];
    if (token === undefined) return null;
    const response = await fetchImplementation(url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      body: '{}',
    });
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Agent authorization is unavailable.');
    }
    const exchange = PlatformAgentExchangeViewSchema.parse(
      await boundedJson(response),
    );
    if (
      exchange.connection.status !== 'active' ||
      Date.parse(exchange.expiresAt) <= Date.now() ||
      Date.parse(exchange.connection.expiresAt) <= Date.now()
    )
      return null;
    return createAgentDataRequestHandler(
      exchange,
      options.dataApiUrl,
      fetchImplementation,
    );
  };
}
