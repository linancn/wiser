import { expect, it } from 'vitest';
import {
  ResourceBatchPreviewCommandSchema,
  ResourceBatchDecisionSchema,
} from '../src/resource-batch.ts';
const id = '11111111-1111-4111-8111-111111111111';
const input = {
  projectId: id,
  packageId: id,
  packageVersion: 1,
  presetId: id,
  presetVersion: 1,
  actorIds: [id],
  purpose: 'web-console',
  startsAt: '2026-09-23T00:00:00Z',
  expiresAt: '2026-09-24T00:00:00Z',
  reason: 'Research collaboration',
};
it('accepts explicit fixed versions while rejecting caller authority and unbounded recipients', () => {
  expect(ResourceBatchPreviewCommandSchema.parse(input)).toEqual(input);
  for (const change of [
    { actorIds: [] },
    { actorIds: [id, id] },
    {
      actorIds: Array.from(
        { length: 51 },
        (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
      ),
    },
    { packageVersion: 0 },
    { presetVersion: 0 },
    { approvedBy: id },
    { status: 'approved' },
    { purpose: 'unregistered-purpose' },
    { expiresAt: input.startsAt },
    { reason: 'x' },
  ])
    expect(
      ResourceBatchPreviewCommandSchema.safeParse({ ...input, ...change })
        .success,
    ).toBe(false);
});
it.each(['web-console', 'agent-data'])(
  'requires an explicit supported %s purpose',
  (purpose) => {
    expect(
      ResourceBatchPreviewCommandSchema.parse({ ...input, purpose }).purpose,
    ).toBe(purpose);
    expect(
      ResourceBatchPreviewCommandSchema.safeParse({
        ...input,
        purpose: undefined,
      }).success,
    ).toBe(false);
  },
);
it('requires an optimistic version and explicit decision without accepting a claimed approver', () => {
  const command = {
    projectId: id,
    batchId: id,
    expectedVersion: 1,
    decision: 'approve',
    reason: 'Reviewed resource scope',
  };
  expect(ResourceBatchDecisionSchema.safeParse(command).success).toBe(true);
  expect(
    ResourceBatchDecisionSchema.safeParse({ ...command, expectedVersion: 0 })
      .success,
  ).toBe(false);
  expect(
    ResourceBatchDecisionSchema.safeParse({ ...command, approvedBy: id })
      .success,
  ).toBe(false);
});
