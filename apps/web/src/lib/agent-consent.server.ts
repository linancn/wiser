import { randomUUID } from 'node:crypto';

import {
  PlatformAgentAuthorizationViewSchema,
  PlatformAgentConnectionViewSchema,
  type PlatformAgentAuthorizeCommand,
} from '@wiser/platform-contracts';

import {
  AgentConsentError,
  type AgentConsentDependencies,
} from './agent-consent';
import { createWiserServerSupabaseClient } from './supabase/server';
import { verifiedSessionAccessToken } from './supabase/verified-session';

function apiOrigin(): string {
  const value = process.env.WISER_DATA_API_INTERNAL_URL;
  if (!value) throw new AgentConsentError('unavailable');
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error('Invalid API origin');
    }
    return url.origin;
  } catch {
    throw new AgentConsentError('unavailable');
  }
}

export async function agentPlatformRequest(
  path: string,
  token: string,
  method: 'GET' | 'POST',
  body?: PlatformAgentAuthorizeCommand | Record<string, never>,
  idempotencyKey?: string,
): Promise<unknown> {
  const response = await fetch(`${apiOrigin()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(idempotencyKey === undefined
        ? {}
        : { 'Idempotency-Key': idempotencyKey }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new AgentConsentError(
      response.status === 401 || response.status === 403
        ? 'not-allowed'
        : response.status === 404 || response.status === 422
          ? 'invalid-request'
          : 'unavailable',
    );
  }
  return response.status === 204 ? undefined : response.json();
}

export async function getAgentConsentServerContext() {
  const client = await createWiserServerSupabaseClient();
  if (client === null) throw new AgentConsentError('unavailable');
  let token: string;
  try {
    token = await verifiedSessionAccessToken(
      createWiserServerSupabaseClient,
      () => new Date(),
    );
  } catch {
    throw new AgentConsentError('not-allowed');
  }
  const deps: AgentConsentDependencies = {
    oauth: client.auth.oauth,
    inspect: async (accessToken, authorizationId) =>
      PlatformAgentAuthorizationViewSchema.parse(
        await agentPlatformRequest(
          `/api/platform/v1/agent-authorizations/${encodeURIComponent(authorizationId)}`,
          accessToken,
          'GET',
        ),
      ),
    authorize: async (accessToken, command, idempotencyKey) => {
      const result = PlatformAgentConnectionViewSchema.parse(
        await agentPlatformRequest(
          '/api/platform/v1/agent-connections',
          accessToken,
          'POST',
          command,
          idempotencyKey,
        ),
      );
      return { connectionId: result.connectionId };
    },
    createIdempotencyKey: randomUUID,
  };
  return { deps, token };
}
