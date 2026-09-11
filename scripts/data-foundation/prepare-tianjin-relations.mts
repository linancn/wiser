import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ImportRelationsInputSchema,
  RelationCandidateSchema,
} from '../../packages/data-contracts/src/index.ts';
import { groupRelationCandidates } from '../../packages/data-core/src/index.js';

type Row = Record<string, unknown>;
function rows(value: unknown): Row[] {
  if (
    !Array.isArray(value) ||
    value.length > 100000 ||
    value.some((r) => !r || typeof r !== 'object' || Array.isArray(r))
  )
    throw Error('Invalid source rows');
  return value as Row[];
}
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
export function prepareTianjinRelations(
  source: { entities: unknown; observations: unknown; relations: unknown },
  rawBinding: unknown,
) {
  if (!rawBinding || typeof rawBinding !== 'object')
    throw Error('Target binding required');
  const binding = rawBinding as Record<string, unknown>;
  const entities = rows(source.entities),
    observations = rows(source.observations),
    relations = rows(source.relations);
  for (const row of [...entities, ...observations, ...relations])
    if (row['source_pdf_sha256'] !== binding['sourceHash'])
      throw Error('Source hash does not match target binding');
  const entityMap = new Map(entities.map((e) => [e['entity_id'], e])),
    observationMap = new Map(observations.map((e) => [e['record_id'], e]));
  if (
    entityMap.size !== entities.length ||
    observationMap.size !== observations.length
  )
    throw Error('Duplicate source-local identity');
  const entity = (key: unknown) => {
    const row = entityMap.get(key);
    if (!row) throw Error('Missing source entity');
    const kind = (
      {
        enterprise: 'ENTERPRISE',
        monitoring_point: 'MONITORING_POINT',
        measurement: 'INDICATOR_RECORD',
        measurement_record: 'INDICATOR_RECORD',
        reported_measurement: 'INDICATOR_RECORD',
      } as Record<string, string>
    )[String(row['entity_type'])];
    if (!kind) throw Error('Unsupported source entity kind');
    return {
      key: row['entity_id'],
      label: row['label'],
      kind,
      externalId: null,
    };
  };
  const candidates = relations.map((row) => {
    if (
      !Number.isInteger(row['source_pdf_page']) ||
      Number(row['source_pdf_page']) < 1 ||
      !Number.isInteger(row['source_table_row']) ||
      Number(row['source_table_row']) < 1
    )
      throw Error('Missing source location');
    const predicate =
      row['predicate'] === 'has_declared_monitoring_point'
        ? 'HAS_DECLARED_MONITORING_POINT'
        : row['predicate'] === 'has_reported_measurement'
          ? 'HAS_REPORTED_INDICATOR'
          : null;
    if (!predicate) throw Error('Unsupported source predicate');
    const observation =
      predicate === 'HAS_REPORTED_INDICATOR'
        ? observationMap.get(row['object_id'])
        : undefined;
    if (predicate === 'HAS_REPORTED_INDICATOR' && !observation)
      throw Error('Missing source measurement');
    const excerpt = JSON.stringify(
      observation ?? {
        basis: row['basis'],
        page: row['source_pdf_page'],
        row: row['source_table_row'],
      },
    );
    return RelationCandidateSchema.parse({
      subject: entity(row['subject_id']),
      predicate,
      object: entity(row['object_id']),
      qualifiers: {
        measure: text(observation?.['indicator']),
        reportedValue: text(observation?.['reported_value_raw']),
        reportedLimit: text(observation?.['reported_limit_raw']),
        unit: text(observation?.['unit']),
        observedAt: text(observation?.['monitoring_date_raw']),
        missing: observation
          ? text(observation['reported_value_raw']) === null
          : false,
        spatialScope: observation ? text(observation['district']) : null,
        limitations: [
          'Source-local identity; not an official registry identity.',
          'Declared district and point names do not establish coordinates or receiving water.',
        ],
        reportedConclusion: text(observation?.['reported_compliance']),
      },
      generation: { method: 'SOURCE_TABLE', model: null },
      evidence: [
        {
          assetId: binding['assetId'],
          sourceHash: binding['sourceHash'],
          locator: `PDF page ${String(row['source_pdf_page'])}, table row ${String(row['source_table_row'])}`,
          excerpt,
          polarity: 'SUPPORTS',
        },
      ],
      supersedesId: null,
    });
  });
  const grouped = groupRelationCandidates(candidates).map((g) => g.candidate),
    batches: ReturnType<typeof ImportRelationsInputSchema.parse>[] = [];
  let batch: typeof grouped = [];
  const wrap = (candidates: typeof grouped) =>
    ImportRelationsInputSchema.parse({
      dataItemId: binding['dataItemId'],
      versionId: binding['versionId'],
      mappingVersion: binding['mappingVersion'],
      candidates,
    });
  for (const candidate of grouped) {
    if (Buffer.byteLength(JSON.stringify(candidate)) > 100000)
      throw Error('One relation exceeds evidence limit');
    if (
      batch.length &&
      (batch.length === 100 ||
        Buffer.byteLength(JSON.stringify(wrap([...batch, candidate]))) > 200000)
    ) {
      batches.push(wrap(batch));
      batch = [];
    }
    batch.push(candidate);
    if (Buffer.byteLength(JSON.stringify(wrap(batch))) > 262144)
      throw Error('One relation exceeds intake limit');
  }
  if (batch.length) batches.push(wrap(batch));
  return {
    candidateCount: grouped.length,
    evidenceCount: grouped.reduce((n, c) => n + c.evidence.length, 0),
    batches,
  };
}
async function main() {
  const [directory, bindingPath, outputDirectory] = process.argv.slice(2);
  if (!directory || !bindingPath || !outputDirectory)
    throw Error(
      'Source directory, target binding and output directory required',
    );
  const read = async (path: string) =>
    JSON.parse(await readFile(path, 'utf8')) as unknown;
  const source = {
    entities: await read(resolve(directory, 'business-entities.json')),
    observations: await read(
      resolve(directory, 'wastewater-monitoring-candidates.json'),
    ),
    relations: await read(resolve(directory, 'business-relations.json')),
  };
  const result = prepareTianjinRelations(source, await read(bindingPath));
  await mkdir(outputDirectory, { recursive: true });
  for (const [i, batch] of result.batches.entries())
    await writeFile(
      resolve(
        outputDirectory,
        `relations-${String(i + 1).padStart(3, '0')}.json`,
      ),
      JSON.stringify(batch) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
  process.stdout.write(
    JSON.stringify({
      candidateCount: result.candidateCount,
      evidenceCount: result.evidenceCount,
      batches: result.batches.length,
      targetIngested: false,
    }) + '\n',
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  void main().catch(() => {
    process.stderr.write(
      'Candidate preparation failed; check source files and target binding.\n',
    );
    process.exitCode = 1;
  });
