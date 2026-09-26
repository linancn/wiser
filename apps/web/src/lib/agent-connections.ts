import {
  PlatformUuidSchema,
  type PlatformAgentConnectionView,
} from '@wiser/platform-contracts';

export interface AgentConnectionAccountDependencies {
  readonly list: () => Promise<readonly PlatformAgentConnectionView[]>;
  readonly revokeConnection: (connectionId: string) => Promise<void>;
  readonly revokeGrant: (
    clientId: string,
  ) => Promise<{ readonly error: unknown }>;
}

export async function disconnectAgentConnection(
  deps: AgentConnectionAccountDependencies,
  connectionId: string,
): Promise<'disconnected' | 'provider-pending'> {
  if (!PlatformUuidSchema.safeParse(connectionId).success)
    throw new Error('not-allowed');
  const owned = (await deps.list()).find(
    (item) => item.connectionId === connectionId,
  );
  if (!owned) throw new Error('not-allowed');
  try {
    await deps.revokeConnection(owned.connectionId);
  } catch {
    throw new Error('unavailable');
  }
  try {
    const { error } = await deps.revokeGrant(owned.clientId);
    if (
      error === null ||
      (typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        error.status === 404)
    )
      return 'disconnected';
  } catch {
    // Access is already stopped. Retrying must still clear the saved consent.
  }
  return 'provider-pending';
}
