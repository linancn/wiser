import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  parseAnalysisContent,
  type AnalysisContentEvent,
} from '../../src/analysis/content-parser.js';

const item = '10000000-0000-4000-8000-000000000001';
const version = '10000000-0000-4000-8000-000000000002';
const asset = '10000000-0000-4000-8000-000000000003';
async function parse(
  text: string,
  format: 'csv' | 'json',
  overrides: Record<string, unknown> = {},
) {
  const bytes = Buffer.from(text);
  const events: AnalysisContentEvent[] = [];
  for await (const event of parseAnalysisContent({
    bytes,
    format,
    dataItemId: item,
    versionId: version,
    assetId: asset,
    sourceHash: createHash('sha256').update(bytes).digest('hex'),
    ...overrides,
  }))
    events.push(event);
  return events;
}

describe('deterministic analytical content parsing', () => {
  it.skipIf(process.env['WISER_DATA_REAL_CASE'] !== '1')(
    'streams every row of the real million-row Beijing river source',
    async () => {
      const bytes = await readFile(
        new URL(
          '../../../../.source/water_research_data_interface_download_bundle_20260908/downloads/beijing_open_data/市水务局-城市河湖水情.csv',
          import.meta.url,
        ),
      );
      const sourceHash =
        '3c5f56e45f4ccbdfaad95388ed4c9178b49be75ea223f4aa4dd473a5410c7762';
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(sourceHash);
      let count = 0;
      let summary: AnalysisContentEvent | undefined;
      for await (const event of parseAnalysisContent({
        bytes,
        format: 'csv',
        dataItemId: item,
        versionId: version,
        assetId: asset,
        sourceHash,
      })) {
        if (event.type === 'record') {
          count += 1;
          if (count === 1)
            expect(event.values).toEqual({
              c1: '30300100',
              c2: '25/8/2022 19:55:00',
              c3: '25.0',
              c4: null,
            });
          expect(event.index).toBe(count);
        }
        if (event.type === 'summary') summary = event;
      }
      expect(count).toBe(1048575);
      expect(summary).toMatchObject({
        status: 'READY',
        recordCount: 1048575,
        featureCount: 0,
      });
    },
    60000,
  );
  it('accepts a bounded budget large enough for full spreadsheet row capacity', async () => {
    expect(
      (await parse('station\n0001', 'csv', { maximumRecords: 1048576 })).at(-1),
    ).toMatchObject({ recordCount: 1, status: 'READY' });
    await expect(
      parse('station\n0001', 'csv', { maximumRecords: 2000001 }),
    ).rejects.toMatchObject({ code: 'RECORD_LIMIT' });
  });
  it('preserves Unicode headers, identifiers, raw units and quoted CSV content with stable row identities', async () => {
    const content =
      '\uFEFF测站编码,水位,备注\n001,12.5,"first, row"\n002,,"two\nlines"\n';
    const events = await parse(content, 'csv');
    expect(events[0]).toMatchObject({
      type: 'schema',
      columns: [
        { key: 'c1', label: '测站编码' },
        { key: 'c2', label: '水位' },
        { key: 'c3', label: '备注' },
      ],
    });
    const rows = events.filter((event) => event.type === 'record');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      index: 1,
      values: { c1: '001', c2: '12.5', c3: 'first, row' },
      geometry: null,
      sourceCrs: null,
    });
    expect(rows[1]).toMatchObject({
      index: 2,
      values: { c1: '002', c2: null, c3: 'two\nlines' },
    });
    expect(events.at(-1)).toMatchObject({
      type: 'summary',
      recordCount: 2,
      featureCount: 0,
      status: 'READY',
    });
    expect(await parse(content, 'csv')).toEqual(events);
    const another = await parse(content, 'csv', {
      versionId: '10000000-0000-4000-8000-000000000004',
    });
    expect(
      another.filter((event) => event.type === 'record')[0]?.recordId,
    ).not.toBe(rows[0]?.recordId);
  });
  it.each([
    'a,a\n1,2',
    'a,b\n1,2,3',
    'a,b\n"unterminated,2',
    '<html><body>Sign in</body></html>',
  ])('rejects ambiguous, malformed and disguised CSV %#', async (text) => {
    await expect(parse(text, 'csv')).rejects.toMatchObject({
      code: 'INVALID_CONTENT',
    });
  });
  it('rejects changed bytes and enforces a hard row bound without silently truncating', async () => {
    await expect(
      parse('a\n1', 'csv', { sourceHash: '0'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'HASH_MISMATCH' });
    await expect(
      parse('a\n1\n2', 'csv', { maximumRecords: 1 }),
    ).rejects.toMatchObject({ code: 'RECORD_LIMIT' });
  });
  it('parses GeoJSON coordinates as format-declared WGS84 with evidence-stable feature identity', async () => {
    const events = await parse(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: 'station-1',
            properties: { name: 'River station', flow: null },
            geometry: { type: 'Point', coordinates: [116.2, 39.8] },
          },
        ],
      }),
      'json',
    );
    const row = events.find((event) => event.type === 'record');
    expect(row).toMatchObject({
      index: 1,
      values: { c1: 'River station', c2: null },
      geometry: { type: 'Point', coordinates: [116.2, 39.8] },
      sourceCrs: 'EPSG:4326',
      sourceId: 'station-1',
    });
    expect(row?.featureId).toBe(row?.recordId);
    expect(events.at(-1)).toMatchObject({
      type: 'summary',
      recordCount: 1,
      featureCount: 1,
      status: 'READY',
    });
  });
  it('does not turn arbitrary lon/lat properties or ArcGIS attributes into verified geometry', async () => {
    const events = await parse(
      JSON.stringify({
        features: [{ attributes: { longitude: 116, latitude: 40 } }],
      }),
      'json',
    );
    expect(events.find((event) => event.type === 'record')).toMatchObject({
      geometry: null,
      sourceCrs: null,
    });
    expect(events.at(-1)).toMatchObject({ recordCount: 1, featureCount: 0 });
  });
  it.each([
    { type: 'Point', coordinates: [200, 40] },
    { type: 'Point', coordinates: [116, 91] },
    {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
      ],
    },
  ])('rejects invalid declared GeoJSON geometry %#', async (geometry) => {
    await expect(
      parse(
        JSON.stringify({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: {}, geometry }],
        }),
        'json',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_GEOMETRY' });
  });
  it.skipIf(process.env['WISER_DATA_REAL_CASE'] !== '1')(
    'matches the admitted USGS NLDI source hash, station and coordinates',
    async () => {
      const bytes = await readFile(
        new URL(
          '../../../../.source/water_research_data_interface_download_bundle_20260908/output/downloads/tier1_b01_runtime/DS-0558_ds_usgs_nldi_api.json',
          import.meta.url,
        ),
      );
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        '0eafd5354e73f8ea538ee2a49169b77e92380989fa642dbb279ae6522ec44c02',
      );
      const events = await parse(bytes.toString('utf8'), 'json');
      expect(events.find((event) => event.type === 'record')).toMatchObject({
        sourceId: 'USGS-01646500',
        geometry: { type: 'Point', coordinates: [-77.12763889, 38.94977778] },
      });
    },
  );
});
