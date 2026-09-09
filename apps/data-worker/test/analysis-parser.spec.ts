import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createExternalAnalysisParser } from '../src/adapters/analysis-parser.js';
import type { AnalysisContentEvent } from '@wiser/data-infra';

const bytes = Buffer.from('source bytes');
const hash = createHash('sha256').update(bytes).digest('hex');
const input = {
  bytes,
  sourceHash: hash,
  dataItemId: '10000000-0000-4000-8000-000000000001',
  versionId: '10000000-0000-4000-8000-000000000002',
  assetId: '10000000-0000-4000-8000-000000000003',
  format: 'xlsx',
  path: 'downloads/stations.xlsx',
};
const events = [
  { type: 'source', sha256: hash, parserVersion: '1.0.0' },
  { type: 'schema', columns: [{ key: 'c1', label: '站号' }] },
  {
    type: 'record',
    index: 1,
    values: { c1: '001' },
    geometry: null,
    sourceId: null,
    sourceCrs: null,
  },
  {
    type: 'summary',
    recordCount: 1,
    featureCount: 0,
    status: 'READY',
    reason: null,
  },
];
function response(values: readonly unknown[]) {
  const bytes = new TextEncoder().encode(
    values.map((value) => JSON.stringify(value)).join('\n') + '\n',
  );
  let offset = 0;
  const chunkSize = bytes.length > 1048576 ? 65536 : 3;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
        offset = Math.min(bytes.length, offset + chunkSize);
      },
    }),
    { headers: { 'content-type': 'application/x-ndjson' } },
  );
}
async function collect(
  values: readonly unknown[] = events,
  override: Partial<typeof input> = {},
) {
  const parser = createExternalAnalysisParser({
    endpoint: 'http://source-parser:3005',
    fetch: () => Promise.resolve(response(values)),
  });
  const result: AnalysisContentEvent[] = [];
  for await (const event of parser({ ...input, ...override }))
    result.push(event);
  return result;
}
describe('isolated source parser adapter', () => {
  it('decodes split UTF-8 frames and binds stable identities to the admitted source version', async () => {
    const result = await collect();
    expect(result[0]).toMatchObject({
      type: 'schema',
      columns: [{ key: 'c1', label: '站号' }],
    });
    expect(result[1]).toMatchObject({
      type: 'record',
      index: 1,
      values: { c1: '001' },
      featureId: null,
    });
    expect(await collect()).toEqual(result);
    const changed = await collect(events, {
      versionId: '10000000-0000-4000-8000-000000000004',
    });
    expect(changed[1]).not.toEqual(result[1]);
  });
  it('retains large source geometry in bounded frames rather than discarding the entire asset', async () => {
    const values = {
      c1: {
        type: 'Polygon',
        coordinates: [
          Array.from({ length: 60000 }, () => [1100000.123456, 4400000.123456]),
        ],
      },
    };
    const result = await collect([
      ...events.slice(0, 2),
      { ...events[2], values },
      events[3],
    ]);
    expect(result[1]).toMatchObject({ type: 'record', values });
  });
  it('rejects changed source bytes before requesting a parser', async () => {
    let called = false;
    const parser = createExternalAnalysisParser({
      endpoint: 'http://source-parser:3005',
      fetch: () => {
        called = true;
        return Promise.resolve(response(events));
      },
    });
    await expect(async () => {
      for await (const _event of parser({
        ...input,
        sourceHash: '0'.repeat(64),
      })) {
        /* consume */
      }
    }).rejects.toMatchObject({ code: 'HASH_MISMATCH' });
    expect(called).toBe(false);
  });
  it('rejects missing completion, wrong hashes, row gaps, undeclared values and inconsistent totals', async () => {
    for (const values of [
      events.slice(0, -1),
      [{ ...events[0], sha256: '0'.repeat(64) }, ...events.slice(1)],
      [...events.slice(0, 2), { ...events[2], index: 2 }, events[3]],
      [
        ...events.slice(0, 2),
        { ...events[2], values: { private: 'not declared' } },
        events[3],
      ],
      [...events.slice(0, 3), { ...events[3], recordCount: 2 }],
    ])
      await expect(collect(values)).rejects.toBeDefined();
  });
});
