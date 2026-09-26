import 'server-only';
import { randomUUID } from 'node:crypto';
import { PlatformAgentConnectionViewSchema } from '@wiser/platform-contracts';
import { agentPlatformRequest } from './agent-consent.server';
import { disconnectAgentConnection } from './agent-connections';
import { createWiserServerSupabaseClient } from './supabase/server';
import { verifiedSessionAccessToken } from './supabase/verified-session';
import { getProjectAccessClient } from './project-access.server';

export async function getAgentConnectionAccount() {
  const client = await createWiserServerSupabaseClient();
  if (!client) throw new Error('unavailable');
  const token = await verifiedSessionAccessToken(
    createWiserServerSupabaseClient,
    () => new Date(),
  );
  const list = async () => {
    const result = await agentPlatformRequest(
      '/api/platform/v1/agent-connections',
      token,
      'GET',
    );
    if (
      typeof result !== 'object' ||
      result === null ||
      !('connections' in result)
    )
      throw new Error('unavailable');
    return PlatformAgentConnectionViewSchema.array()
      .max(100)
      .parse(result.connections);
  };
  return {
    async load() {
      const [connections, grants] = await Promise.all([
        list(),
        client.auth.oauth.listGrants(),
      ]);
      if (grants.error || grants.data === null) throw new Error('unavailable');
      // Project labels are optional: loss of membership must not prevent revocation.
      const projects = await getProjectAccessClient()
        .projects({ offset: 0, limit: 50, search: '' })
        .catch(() => null);
      return connections.map((item) => ({
        ...item,
        clientName:
          grants.data.find((grant) => grant.client.id === item.clientId)?.client
            .name ?? null,
        projectName:
          projects?.items
            .filter((project) => project.projectId === item.projectId)
            .map((project) => ({
              'zh-CN': project.nameZh,
              en: project.nameEn,
            }))[0] ?? null,
        providerConsent: grants.data.some(
          (grant) => grant.client.id === item.clientId,
        ),
      }));
    },
    disconnect: (connectionId: string) =>
      disconnectAgentConnection(
        {
          list,
          revokeConnection: async (id) => {
            await agentPlatformRequest(
              `/api/platform/v1/agent-connections/${encodeURIComponent(id)}/revoke`,
              token,
              'POST',
              {},
              randomUUID(),
            );
          },
          revokeGrant: (id) => client.auth.oauth.revokeGrant({ clientId: id }),
        },
        connectionId,
      ),
  };
}
