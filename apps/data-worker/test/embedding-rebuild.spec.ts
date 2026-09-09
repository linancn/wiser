import { expect, it, vi } from 'vitest';
import type { ProjectionEvent } from '@wiser/data-infra';
import { rebuildEmbeddingProjection } from '../src/runtime/embedding-rebuild.js';

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  policyVersion: 1,
  maxSecurityLevel: 'L2_RESTRICTED' as const,
};
const event = {
  ...scope,
  securityLevel: 'L2_RESTRICTED',
  outboxEventId: '1',
  eventId: '33333333-3333-4333-8333-333333333333',
} as unknown as ProjectionEvent;
function dependencies() {
  return {
    scope,
    consumerName: 'embedding-test',
    repository: {
      readBatch: vi.fn().mockResolvedValueOnce([event]).mockResolvedValue([]),
      advanceCheckpoint: vi.fn().mockResolvedValue(undefined),
    },
    project: vi.fn().mockResolvedValue(2),
  };
}
it('advances its separate rebuild checkpoint only after all evidence writes finish', async () => {
  const options = dependencies();
  expect(await rebuildEmbeddingProjection(options)).toEqual({
    events: 1,
    evidence: 2,
  });
  expect(options.repository.advanceCheckpoint).toHaveBeenCalledWith(
    scope,
    'embedding-test',
    event,
  );
  expect(options.project.mock.invocationCallOrder[0]).toBeLessThan(
    options.repository.advanceCheckpoint.mock.invocationCallOrder[0]!,
  );
});
it('leaves a failed event retryable without moving the checkpoint or publication ledger', async () => {
  const options = dependencies();
  options.project.mockRejectedValueOnce(new Error('service unavailable'));
  await expect(rebuildEmbeddingProjection(options)).rejects.toThrow(
    'service unavailable',
  );
  expect(options.repository.advanceCheckpoint).not.toHaveBeenCalled();
});
it('rejects foreign scope before embedding any content', async () => {
  const options = dependencies();
  options.repository.readBatch
    .mockReset()
    .mockResolvedValueOnce([
      { ...event, projectId: '44444444-4444-4444-8444-444444444444' },
    ]);
  await expect(rebuildEmbeddingProjection(options)).rejects.toThrow();
  expect(options.project).not.toHaveBeenCalled();
  expect(options.repository.advanceCheckpoint).not.toHaveBeenCalled();
});
