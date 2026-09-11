import { expect, it } from 'vitest';
import { prepareTianjinRelations } from '../../scripts/data-foundation/prepare-tianjin-relations.mts';
it('reuses extracted cells for a three-relation pilot and keeps reported values separate from review', () => {
  const hash = 'a'.repeat(64),
    binding = {
      dataItemId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      versionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      assetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      sourceHash: hash,
      mappingVersion: 'tianjin.v1',
    };
  const entities = [
    ['enterprise', 'enterprise'],
    ['point', 'monitoring_point'],
    ['m1', 'measurement'],
    ['m2', 'measurement'],
  ].map(([id, type]) => ({
    entity_id: id,
    entity_type: type,
    label: id,
    source_pdf_sha256: hash,
  }));
  const observations = ['m1', 'm2'].map((record_id) => ({
    record_id,
    source_pdf_sha256: hash,
    indicator: record_id,
    unit: null,
    reported_value_raw: '<0.02',
    reported_limit_raw: '0.1',
    monitoring_date_raw: '2025-01-01',
    reported_compliance: '是',
    district: 'Source district',
  }));
  const relations = observations.flatMap((o, i) => [
    {
      subject_id: 'enterprise',
      predicate: 'has_declared_monitoring_point',
      object_id: 'point',
      source_pdf_sha256: hash,
      source_pdf_page: 1,
      source_table_row: i + 1,
      basis: 'source table',
    },
    {
      subject_id: 'point',
      predicate: 'has_reported_measurement',
      object_id: o.record_id,
      source_pdf_sha256: hash,
      source_pdf_page: 1,
      source_table_row: i + 1,
      basis: 'source table',
    },
  ]);
  const result = prepareTianjinRelations(
    { entities, observations, relations },
    binding,
  );
  expect(result.candidateCount).toBe(3);
  expect(result.evidenceCount).toBe(4);
  const measurement = result.batches
    .flatMap((b) => b.candidates)
    .find((c) => c.object.key === 'm1');
  expect(measurement?.qualifiers).toMatchObject({
    unit: null,
    reportedValue: '<0.02',
    reportedConclusion: '是',
  });
  expect(measurement?.evidence[0]?.excerpt).toContain('reported_value_raw');
  expect(() =>
    prepareTianjinRelations(
      { entities, observations, relations },
      { ...binding, sourceHash: 'b'.repeat(64) },
    ),
  ).toThrow('Source hash');
});
