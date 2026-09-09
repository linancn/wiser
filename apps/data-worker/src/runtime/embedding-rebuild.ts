import type {
  ProjectionEvent,
  ProjectionOutboxRepository,
  ProjectionScope,
} from '@wiser/data-infra';

export async function rebuildEmbeddingProjection(options: {
  readonly scope: ProjectionScope;
  readonly consumerName: string;
  readonly repository: Pick<
    ProjectionOutboxRepository,
    'readBatch' | 'advanceCheckpoint'
  >;
  readonly project: (event: ProjectionEvent) => Promise<number>;
  readonly progress?: (counts: { events: number; evidence: number }) => void;
  readonly signal?: AbortSignal;
}): Promise<{ events: number; evidence: number }> {
  const counts = { events: 0, evidence: 0 };
  const rank = {
    L0_PUBLIC: 0,
    L1_INTERNAL: 1,
    L2_RESTRICTED: 2,
    L3_CONFIDENTIAL: 3,
  };
  let previous = 0n;
  while (!options.signal?.aborted) {
    const events = await options.repository.readBatch(
      options.scope,
      options.consumerName,
      16,
    );
    if (events.length === 0) return counts;
    for (const event of events) {
      if (options.signal?.aborted)
        throw new Error(
          'Embedding rebuild interrupted; resume with the same profile.',
        );
      if (
        event.tenantId !== options.scope.tenantId ||
        event.projectId !== options.scope.projectId ||
        event.policyVersion > options.scope.policyVersion ||
        rank[event.securityLevel] > rank[options.scope.maxSecurityLevel] ||
        !/^\d+$/.test(event.outboxEventId) ||
        BigInt(event.outboxEventId) <= previous
      )
        throw new Error('Embedding rebuild scope or event order is invalid.');
      const evidence = await options.project(event);
      await options.repository.advanceCheckpoint(
        options.scope,
        options.consumerName,
        event,
      );
      previous = BigInt(event.outboxEventId);
      counts.events += 1;
      counts.evidence += evidence;
      options.progress?.({ ...counts });
    }
  }
  throw new Error(
    'Embedding rebuild interrupted; resume with the same profile.',
  );
}
