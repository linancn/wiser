import { expect, it } from 'vitest';
import { ExplorationQueryInputSchema } from '../src/exploration/index.js';
const id = '10000000-0000-4000-8000-000000000001';
const time = {
  field: 'c2',
  type: 'time',
  format: 'dmy-local',
  utcOffsetMinutes: 480,
};
it('requires explicit source time interpretation for calendar groups and shared record ranges', () => {
  expect(
    ExplorationQueryInputSchema.safeParse({
      queryId: id,
      versionId: id,
      view: 'aggregate',
      aggregate: {
        assetId: id,
        groupBy: { ...time, bucket: 'month' },
        measure: { operation: 'mean', field: 'c3' },
      },
    }).success,
  ).toBe(true);
  expect(
    ExplorationQueryInputSchema.safeParse({
      spec: {
        versions: [{ dataItemId: id, versionId: id }],
        recordQuery: {
          assetId: id,
          filters: [
            { ...time, operator: 'gte', value: '2023-03-31T16:00:00Z' },
            { ...time, operator: 'lt', value: '2023-04-30T16:00:00Z' },
          ],
          sort: { ...time, direction: 'asc' },
        },
      },
      view: 'resources',
    }).success,
  ).toBe(true);
});
it.each([
  { ...time, utcOffsetMinutes: undefined },
  { ...time, utcOffsetMinutes: 841 },
  { ...time, utcOffsetMinutes: 0.5 },
  { ...time, format: 'guess' },
])('rejects missing or ambiguous time interpretation %#', (groupBy) => {
  expect(
    ExplorationQueryInputSchema.safeParse({
      queryId: id,
      versionId: id,
      view: 'aggregate',
      aggregate: {
        assetId: id,
        groupBy: { ...groupBy, bucket: 'day' },
        measure: { operation: 'count' },
      },
    }).success,
  ).toBe(false);
});
it.each([
  '2023-04-01T00:00:00',
  '2023-02-31T00:00:00Z',
  '2023-04-01T00:00:00.123456789Z',
])(
  'rejects unzoned, invalid or unsupported-precision comparison values %s',
  (value) => {
    expect(
      ExplorationQueryInputSchema.safeParse({
        spec: {
          versions: [{ dataItemId: id, versionId: id }],
          recordQuery: {
            assetId: id,
            filters: [{ ...time, operator: 'gte', value }],
          },
        },
        view: 'resources',
      }).success,
    ).toBe(false);
  },
);
