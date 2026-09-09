import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  CreateReconciliationInputSchema,
  CreateReconciliationOutputSchema,
  GetReconciliationInputSchema,
  GetReconciliationOutputSchema,
  ReviewReconciliationInputSchema,
  ListReconciliationsInputSchema,
  ReconciliationBatchSchema,
  type ReconciliationBatch,
  type ReconciliationSourceRef,
  type ReconciliationPlan,
} from '@wiser/data-contracts';
import {
  reconcileObservations,
  type ReconciliationRecord,
} from '@wiser/data-core';
import {
  CommandTransactions,
  PostgresDataCommandError,
  type PostgresDataCommandClient,
  type PostgresDataCommandPool,
} from './postgres-command-executors.js';
import {
  DataCapabilityHandlerError,
  type DataCapabilityExecutor,
  type DataCapabilityExecutionContext,
} from './capability-handler.js';
import { AUTHORIZED } from './exploration-authorization.js';

const META =
  'batch_id,status,row_version,input,sources,summary,created_at,reviewed_at,review_note';
type Client = PostgresDataCommandClient;
const SOURCE = z.object({
  source_hash: z.string(),
  source_paths: z.array(z.string()),
  record_count: z.coerce.number().int().nonnegative(),
  columns: z.array(z.object({ key: z.string() })),
  status: z.enum(['READY', 'EMPTY']),
});
function batch(
  row: Readonly<Record<string, unknown>> | undefined,
): ReconciliationBatch {
  if (!row) throw new DataCapabilityHandlerError('EXECUTION_FAILED');
  const input = CreateReconciliationInputSchema.parse(row['input']);
  const summary = z
    .object({ candidateObservationCount: z.number().nullable() })
    .parse(row['summary']);
  return ReconciliationBatchSchema.parse({
    batchId: row['batch_id'],
    version: row['row_version'],
    status: row['status'],
    title: input.title,
    input,
    sources: row['sources'],
    summary: row['summary'],
    createdAt: z.coerce.date().parse(row['created_at']).toISOString(),
    reviewedAt: row['reviewed_at']
      ? z.coerce.date().parse(row['reviewed_at']).toISOString()
      : null,
    reviewNote: row['review_note'],
    independentObservationCount:
      row['status'] === 'VERIFIED' ? summary.candidateObservationCount : null,
  });
}
async function scope(client: Client, context: DataCapabilityExecutionContext) {
  if (context.signal.aborted)
    throw new DataCapabilityHandlerError('CAPABILITY_TIMEOUT');
  await client.query(
    `select set_config('wiser.tenant_id',$1,true),set_config('wiser.project_id',$2,true),set_config('wiser.actor_id',$3,true),set_config('wiser.max_security_level',$4,true),set_config('wiser.policy_version',$5,true),set_config('wiser.purpose',$6,true),set_config('statement_timeout',$7,true)`,
    [
      context.authorization.tenantId,
      context.authorization.projectId,
      context.principal.actorId,
      context.effectiveMaxSecurityLevel,
      String(context.authorization.authzVersion),
      context.authorization.purpose,
      String(context.timeoutMs),
    ],
  );
}
async function authorize(
  client: Client,
  refs: readonly ReconciliationSourceRef[],
) {
  const checked = await client.query(
    `${AUTHORIZED} select count(*)::int total from authorized`,
    [JSON.stringify(refs)],
  );
  if (checked.rows[0]?.['total'] !== refs.length)
    throw new DataCapabilityHandlerError('NOT_FOUND');
}
async function load(client: Client, id: string, lock = false) {
  const rows = await client.query(
    `select ${META} from service.observation_reconciliation where batch_id=$1::uuid${lock ? ' for update' : ''}`,
    [id],
  );
  if (!rows.rows[0]) throw new DataCapabilityHandlerError('NOT_FOUND');
  const value = batch(rows.rows[0]);
  await authorize(client, value.sources);
  return value;
}
async function commandErrors<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DataCapabilityHandlerError)
      throw new PostgresDataCommandError(
        error.code === 'NOT_FOUND'
          ? 'NOT_FOUND'
          : error.code === 'CONFLICT'
            ? 'STATE_CONFLICT'
            : 'INVALID_INPUT',
      );
    throw error;
  }
}
const requestedFields = (plan: ReconciliationPlan, side: 'left' | 'right') => {
  const map = plan[side];
  return [
    ...new Set([
      ...plan.keys.map((k) => (side === 'left' ? k.leftField : k.rightField)),
      map.valueField,
      ...[map.measure, map.unit].flatMap((b) =>
        'field' in b ? [b.field] : [],
      ),
    ]),
  ];
};
async function source(client: Client, ref: ReconciliationSourceRef) {
  const rows = await client.query(
    `select encode(aa.source_hash,'hex') source_hash,aa.source_paths,aa.record_count,aa.columns,aa.status from service.analysis_asset aa join catalog.asset a on a.asset_id=aa.asset_id and a.version_id=$3::uuid and a.content_hash=aa.source_hash where aa.analysis_id=$1::uuid and aa.asset_id=$2::uuid`,
    [ref.analysisId, ref.assetId, ref.versionId],
  );
  const parsed = SOURCE.safeParse(rows.rows[0]);
  if (
    !parsed.success ||
    !parsed.data.source_paths.some((path) => /\.(?:csv|xlsx|xls)$/i.test(path))
  )
    throw new DataCapabilityHandlerError('VALIDATION_FAILED');
  return parsed.data;
}
export function createReconciliationExecutors(
  pool: PostgresDataCommandPool,
): readonly DataCapabilityExecutor[] {
  const transactions = new CommandTransactions(
    pool,
    randomUUID,
    () => new Date(),
  );
  async function read<T>(
    context: DataCapabilityExecutionContext,
    work: (client: Client) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('begin isolation level repeatable read');
      await scope(client, context);
      const result = await work(client);
      if (context.signal.aborted)
        throw new DataCapabilityHandlerError('CAPABILITY_TIMEOUT');
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      if (error instanceof DataCapabilityHandlerError) throw error;
      throw new DataCapabilityHandlerError('EXECUTION_FAILED');
    } finally {
      client.release();
    }
  }
  return [
    {
      id: 'data.reconciliation.create',
      async execute(raw, context) {
        const input = CreateReconciliationInputSchema.parse(raw);
        return transactions.run(
          'data.reconciliation.create',
          input,
          context,
          (client, timestamp) =>
            commandErrors(async () => {
              await scope(client, context);
              await authorize(client, [input.left, input.right]);
              const left = await source(client, input.left),
                right = await source(client, input.right);
              if (left.record_count + right.record_count > 50000)
                throw new DataCapabilityHandlerError('VALIDATION_FAILED');
              const rows: [ReconciliationRecord[], ReconciliationRecord[]] = [
                [],
                [],
              ];
              for (const side of ['left', 'right'] as const) {
                const fields = requestedFields(input.plan, side),
                  metadata = side === 'left' ? left : right,
                  ref = input[side];
                if (
                  fields.some((f) => !metadata.columns.some((c) => c.key === f))
                )
                  throw new DataCapabilityHandlerError('VALIDATION_FAILED');
                const projected = `coalesce((select jsonb_object_agg(f,r.record_values->f) from unnest($3::text[]) f where r.record_values ? f),'{}'::jsonb)`;
                const measured = await client.query(
                  `select count(*)::int total,coalesce(sum(octet_length((${projected})::text)),0)::float8 bytes from catalog.analysis_record r where analysis_id=$1::uuid and asset_id=$2::uuid`,
                  [ref.analysisId, ref.assetId, [...fields, '__kind']],
                );
                if (
                  measured.rows[0]?.['total'] !== metadata.record_count ||
                  Number(measured.rows[0]?.['bytes']) > 8 * 1024 * 1024
                )
                  throw new DataCapabilityHandlerError('VALIDATION_FAILED');
                const records = await client.query(
                  `select record_id,record_index,${projected} record_values from catalog.analysis_record r where analysis_id=$1::uuid and asset_id=$2::uuid order by record_index limit 50001`,
                  [ref.analysisId, ref.assetId, [...fields, '__kind']],
                );
                if (records.rows.length !== metadata.record_count)
                  throw new DataCapabilityHandlerError('CONFLICT');
                rows[side === 'left' ? 0 : 1] = records.rows.map((r) => ({
                  recordId: z.uuid().parse(r['record_id']),
                  index: z.coerce
                    .number()
                    .int()
                    .positive()
                    .parse(r['record_index']),
                  values: z
                    .record(z.string(), z.unknown())
                    .parse(r['record_values']),
                }));
              }
              const result = reconcileObservations(
                input.plan,
                rows[0],
                rows[1],
              );
              const groups = JSON.stringify(result.groups);
              if (Buffer.byteLength(groups) > 24 * 1024 * 1024)
                throw new DataCapabilityHandlerError('VALIDATION_FAILED');
              const sources = [left, right].map((s, i) => ({
                ...input[i === 0 ? 'left' : 'right'],
                sourceHash: s.source_hash,
                paths: s.source_paths,
                recordCount: s.record_count,
              }));
              const batchId = randomUUID();
              const inserted = await client.query(
                `insert into service.observation_reconciliation(batch_id,tenant_id,project_id,actor_id,purpose,security_level,policy_version,input,sources,summary,groups,created_at) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::timestamptz) returning ${META}`,
                [
                  batchId,
                  context.authorization.tenantId,
                  context.authorization.projectId,
                  context.principal.actorId,
                  context.authorization.purpose,
                  context.effectiveMaxSecurityLevel,
                  context.authorization.authzVersion,
                  JSON.stringify(input),
                  JSON.stringify(sources),
                  JSON.stringify(result.summary),
                  groups,
                  timestamp,
                ],
              );
              const output = { batch: batch(inserted.rows[0]) };
              return {
                output,
                replayResult: { batchId },
                aggregateId: batchId,
                eventType: 'data.reconciliation.created',
                securityLevel: context.effectiveMaxSecurityLevel,
              };
            }),
          (client, _timestamp, ledger) =>
            commandErrors(async () => {
              await scope(client, context);
              return {
                batch: await load(
                  client,
                  z.object({ batchId: z.uuid() }).parse(ledger.result).batchId,
                ),
              };
            }),
        );
      },
    },
    {
      id: 'data.reconciliation.get',
      async execute(raw, context) {
        const input = GetReconciliationInputSchema.parse(raw);
        return read(context, async (client) => {
          const value = await load(client, input.batchId);
          let offset = 0;
          if (input.after) {
            const decoded = z
              .object({
                batchId: z.literal(value.batchId),
                version: z.literal(value.version),
                groupIndex: z.literal(input.groupIndex ?? -1),
                offset: z.number().int().min(1).max(50000),
              })
              .safeParse(
                ((): unknown => {
                  try {
                    return JSON.parse(
                      Buffer.from(input.after, 'base64url').toString('utf8'),
                    );
                  } catch {
                    return null;
                  }
                })(),
              );
            if (!decoded.success)
              throw new DataCapabilityHandlerError('VALIDATION_FAILED');
            offset = decoded.data.offset;
          }
          const list =
            input.groupIndex === undefined
              ? 'groups'
              : "groups->$2::int->'members'";
          const rows = await client.query(
            `select jsonb_array_length(${list}) total,coalesce((select jsonb_agg(${input.groupIndex === undefined ? "e.value-'members'" : 'e.value'} order by e.ordinality) from jsonb_array_elements(${list}) with ordinality e where e.ordinality>$3::int and e.ordinality<=$3::int+$4::int),'[]'::jsonb) page from service.observation_reconciliation where batch_id=$1::uuid and $2::integer>=0`,
            [value.batchId, input.groupIndex ?? 0, offset, input.first],
          );
          const total = rows.rows[0]?.['total'];
          if (typeof total !== 'number' || offset > total)
            throw new DataCapabilityHandlerError('NOT_FOUND');
          return GetReconciliationOutputSchema.parse({
            batch: value,
            groups:
              input.groupIndex === undefined ? rows.rows[0]?.['page'] : [],
            members:
              input.groupIndex === undefined ? [] : rows.rows[0]?.['page'],
            totalCount: total,
            ...(offset + input.first < total
              ? {
                  nextCursor: Buffer.from(
                    JSON.stringify({
                      batchId: value.batchId,
                      version: value.version,
                      groupIndex: input.groupIndex ?? -1,
                      offset: offset + input.first,
                    }),
                  ).toString('base64url'),
                }
              : {}),
          });
        });
      },
    },
    {
      id: 'data.reconciliation.list',
      async execute(raw, context) {
        const input = ListReconciliationsInputSchema.parse(raw);
        return read(context, async (client) => {
          const rows = await client.query(
            `select ${META} from service.observation_reconciliation where input->'left'->>'versionId'=$1::text or input->'right'->>'versionId'=$1::text order by created_at desc,batch_id limit 100`,
            [input.versionId],
          );
          const items = [];
          for (const row of rows.rows) {
            const value = batch(row);
            try {
              await authorize(client, value.sources);
              items.push(value);
            } catch (error) {
              if (!(
                error instanceof DataCapabilityHandlerError &&
                error.code === 'NOT_FOUND'
              ))
                throw error;
            }
          }
          return { items };
        });
      },
    },
    {
      id: 'data.reconciliation.review',
      async execute(raw, context) {
        const input = ReviewReconciliationInputSchema.parse(raw);
        if (context.principal.actorType !== 'human')
          throw new DataCapabilityHandlerError('FORBIDDEN');
        return transactions.run(
          'data.reconciliation.review',
          input,
          context,
          (client, timestamp) =>
            commandErrors(async () => {
              await scope(client, context);
              const value = await load(client, input.batchId, true);
              if (
                value.status !== 'CANDIDATE' ||
                value.version !== input.expectedVersion
              )
                throw new DataCapabilityHandlerError('CONFLICT');
              if (
                input.decision === 'verify' &&
                value.summary.candidateObservationCount === null
              )
                throw new DataCapabilityHandlerError('CONFLICT');
              const updated = await client.query(
                `update service.observation_reconciliation set status=$2,row_version=row_version+1,reviewed_at=$3::timestamptz,review_note=$4 where batch_id=$1::uuid returning ${META}`,
                [
                  input.batchId,
                  input.decision === 'verify' ? 'VERIFIED' : 'REJECTED',
                  timestamp,
                  input.note,
                ],
              );
              const output = { batch: batch(updated.rows[0]) };
              return {
                output,
                replayResult: { batchId: input.batchId },
                aggregateId: input.batchId,
                eventType: 'data.reconciliation.reviewed',
                securityLevel: context.effectiveMaxSecurityLevel,
              };
            }),
          (client, _timestamp, ledger) =>
            commandErrors(async () => {
              await scope(client, context);
              return CreateReconciliationOutputSchema.parse({
                batch: await load(
                  client,
                  z.object({ batchId: z.uuid() }).parse(ledger.result).batchId,
                ),
              });
            }),
        );
      },
    },
  ];
}
