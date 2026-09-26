import type { PlatformAgentConnectionView } from '@wiser/platform-contracts';

export interface AgentConnectionAccountDependencies {
  readonly list: () => Promise<readonly PlatformAgentConnectionView[]>;
  readonly revokeConnection: (connectionId: string) => Promise<void>;
  readonly revokeGrant: (
    clientId: string,
  ) => Promise<{ readonly error: unknown }>;
}

export async function disconnectAgentConnection(
  _deps: AgentConnectionAccountDependencies,
  _connectionId: string,
): Promise<'disconnected' | 'provider-pending'> {
  throw new Error('unavailable');
}
