import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseSourceRegistration } from '../src/handlers/source-registration.js';

const manifestId = '10000000-0000-4000-8000-000000000001';
const fileId = '10000000-0000-4000-8000-000000000002';
const hash = (bytes: string) =>
  createHash('sha256').update(bytes).digest('hex');
const sourceHash = hash('partial bytes');
const source = {
  sourceId: 'DS-0409',
  kind: 'DATASET_INTERFACE' as const,
  name: 'HydroATLAS source registration',
  bundleId: 'water-research-20260908',
  providerName: 'HydroSHEDS',
  accessStatus: 'bounded_sample_only',
  completeness: 'PARTIAL' as const,
  manifestAssetId: manifestId,
  manifestSha256: '',
  limitations: [
    'Source registration only; analytical quality is not assessed.',
  ],
};
const file = {
  assetId: fileId,
  path: 'downloads/DS-0409_range.bin',
  sha256: sourceHash,
  sizeBytes: 13,
  preparedSha256: sourceHash,
  preparedSizeBytes: 13,
  artifactClass: 'bounded_partial_sample',
  completeness: 'PARTIAL',
  disposition: 'IMPORT',
  relatedSourceIds: ['DS-0409'],
};
const manifest = {
  schemaVersion: 'wiser.source-registration.v1',
  sourceId: source.sourceId,
  record: { canonical_name: 'HydroATLAS', credential_ref: 'env:HYDRO_TOKEN' },
  files: [file],
};

function setup(value: unknown = manifest) {
  const body = JSON.stringify(value);
  return {
    registration: { ...source, manifestSha256: hash(body) },
    assets: [
      {
        assetId: manifestId,
        size: Buffer.byteLength(body),
        sourceHash: hash(body),
        mediaType: 'application/json',
      },
      {
        assetId: fileId,
        size: 13,
        sourceHash,
        mediaType: 'application/octet-stream',
      },
    ],
    manifestText: body,
  };
}

describe('deterministic source registration validation', () => {
  it('preserves distinct source paths that reference the same exact content asset', () => {
    const alias = { ...file, path: 'downloads/DS-0409_identical_copy.bin' };
    const result = parseSourceRegistration(
      setup({ ...manifest, files: [file, alias] }),
    );
    expect(result.parsedAssets).toHaveLength(2);
    const excerpt = result.parsedAssets[1]?.metadata['wiser:excerpt'];
    expect(excerpt).toContain(file.path);
    expect(excerpt).toContain(alias.path);
    expect(() =>
      parseSourceRegistration(
        setup({
          ...manifest,
          files: [file, { ...alias, preparedSizeBytes: 14 }],
        }),
      ),
    ).toThrow('SOURCE_REGISTRATION');
  });

  it('validates exact file bytes and preserves partial-download limitations without an AI verdict', () => {
    const result = parseSourceRegistration(setup());
    expect(result.validationScope).toBe('SOURCE_REGISTRATION');
    expect(result.sourceRegistration.completeness).toBe('PARTIAL');
    expect(result.parsedAssets).toHaveLength(2);
    expect(result.parsedAssets[1]).toMatchObject({
      contentHash: sourceHash,
      kind: 'document',
    });
    expect(JSON.stringify(result)).not.toContain('qualityGrade');
  });

  it('rejects missing, duplicated, corrupted and unlisted authority assets', () => {
    for (const files of [
      [],
      [file, file],
      [{ ...file, preparedSha256: 'f'.repeat(64) }],
    ]) {
      expect(() =>
        parseSourceRegistration(setup({ ...manifest, files })),
      ).toThrow('SOURCE_REGISTRATION');
    }
    const wrong = setup();
    expect(() =>
      parseSourceRegistration({
        ...wrong,
        manifestText: `${wrong.manifestText} `,
      }),
    ).toThrow('SOURCE_REGISTRATION');
    expect(() =>
      parseSourceRegistration(setup({ ...manifest, sourceId: 'DS-9999' })),
    ).toThrow('SOURCE_REGISTRATION');
  });

  it('accounts for an empty source with zero bytes, while preventing an unbound nonempty file', () => {
    const empty = {
      path: 'downloads/DS-0409_empty.bin',
      sizeBytes: 0,
      sha256: hash(''),
      preparedSizeBytes: 0,
      preparedSha256: hash(''),
      completeness: 'EMPTY',
      artifactClass: 'bounded_partial_sample',
      disposition: 'IMPORT',
      relatedSourceIds: ['DS-0409'],
    };
    expect(
      parseSourceRegistration(setup({ ...manifest, files: [file, empty] }))
        .sourceRegistration.sourceId,
    ).toBe('DS-0409');
    expect(() =>
      parseSourceRegistration(
        setup({ ...manifest, files: [file, { ...empty, sizeBytes: 1 }] }),
      ),
    ).toThrow('SOURCE_REGISTRATION');
  });
});
