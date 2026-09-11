import { assessmentOverview } from './assessment-overview.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AssessmentSchema,
  CreateAssessmentInputSchema,
  GetAssessmentInputSchema,
  ListAssessmentsInputSchema,
  IntakeSourceFactsSchema,
  type Assessment,
} from '@wiser/data-contracts';
import { assessIntake } from '@wiser/data-core';
import {
  CommandTransactions,
  PostgresDataCommandError,
  type PostgresDataCommandPool,
  type PostgresDataCommandClient,
} from './postgres-command-executors.js';
import {
  DataCapabilityHandlerError,
  type DataCapabilityExecutor,
  type DataCapabilityExecutionContext,
} from './capability-handler.js';
import { AUTHORIZED } from './exploration-authorization.js';

type Client = PostgresDataCommandClient;
async function authorize(
  client: Client,
  ref: { dataItemId: string; versionId: string },
) {
  const result = await client.query(
    `${AUTHORIZED} select count(*)::int total from authorized`,
    [JSON.stringify([ref])],
  );
  if (result.rows[0]?.['total'] !== 1)
    throw new PostgresDataCommandError('NOT_FOUND');
}
function assessment(row: Readonly<Record<string, unknown>>): Assessment {
  return AssessmentSchema.parse({
    assessmentId: row['assessment_id'],
    dataItemId: row['data_item_id'],
    versionId: row['version_id'],
    assetId: row['asset_id'],
    analysisId: row['analysis_id'],
    createdAt: z.coerce.date().parse(row['created_at']).toISOString(),
    declaration: row['declaration'],
    facts: row['facts'],
    result: row['result'],
  });
}
async function load(client: Client, id: string) {
  const rows = await client.query(
    'select * from service.intake_assessment where assessment_id=$1::uuid',
    [id],
  );
  if (!rows.rows[0]) throw new PostgresDataCommandError('NOT_FOUND');
  const value = assessment(rows.rows[0]);
  await authorize(client, value);
  // Recheck the exact asset on every read/replay, not just its parent Version.
  const source = await client.query(
    "select asset_id from catalog.asset where asset_id=$1::uuid and version_id=$2::uuid and content_hash=decode($3,'hex') and lifecycle_state='RAW'",
    [value.assetId, value.versionId, value.facts.sourceHash],
  );
  if (!source.rows[0]) throw new PostgresDataCommandError('NOT_FOUND');
  return value;
}
export function createAssessmentExecutors(
  pool: PostgresDataCommandPool,
): readonly DataCapabilityExecutor[] {
  const transactions = new CommandTransactions(
    pool,
    randomUUID,
    () => new Date(),
  );
  const read = async <T>(
    context: DataCapabilityExecutionContext,
    work: (client: Client) => Promise<T>,
  ): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query('begin isolation level repeatable read');
      await client.query(
        "select set_config('wiser.tenant_id',$1,true),set_config('wiser.project_id',$2,true),set_config('wiser.max_security_level',$3,true),set_config('wiser.policy_version',$4,true),set_config('statement_timeout',$5,true)",
        [
          context.authorization.tenantId,
          context.authorization.projectId,
          context.effectiveMaxSecurityLevel,
          String(context.authorization.authzVersion),
          String(context.timeoutMs),
        ],
      );
      const result = await work(client);
      if (context.signal.aborted)
        throw new DataCapabilityHandlerError('CAPABILITY_TIMEOUT');
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      if (
        error instanceof PostgresDataCommandError &&
        error.code === 'NOT_FOUND'
      )
        throw new DataCapabilityHandlerError('NOT_FOUND');
      if (error instanceof DataCapabilityHandlerError) throw error;
      throw new DataCapabilityHandlerError('EXECUTION_FAILED');
    } finally {
      client.release();
    }
  };
  return [
    {
      id: 'data.assessment.overview',
      execute: (raw, context) =>
        read(context, (client) => assessmentOverview(client, raw)),
    },
    {
      id: 'data.assessment.create',
      async execute(raw, context) {
        const input = CreateAssessmentInputSchema.parse(raw);
        return transactions.run(
          'data.assessment.create',
          input,
          context,
          async (client, timestamp) => {
            await authorize(client, input);
            const rows = await client.query(
              `select encode(a.content_hash,'hex') source_hash,a.media_type,a.byte_size,
        aa.analysis_id,aa.parser_version,aa.status,aa.record_count,aa.feature_count,aa.reason,aa.columns
        from catalog.asset a left join lateral (
          select ar.analysis_id,ar.parser_version,r.status,r.record_count,r.feature_count,r.reason,r.columns
          from service.analysis_run ar join service.analysis_asset r using(tenant_id,project_id,analysis_id)
          where ar.version_id=a.version_id and r.asset_id=a.asset_id and r.source_hash=a.content_hash and ar.completed_at is not null
          order by ar.completed_at desc,ar.analysis_id limit 1
        ) aa on true where a.asset_id=$1::uuid and a.version_id=$2::uuid and a.lifecycle_state='RAW'`,
              [input.assetId, input.versionId],
            );
            const row = rows.rows[0];
            if (!row) throw new PostgresDataCommandError('NOT_FOUND');
            const facts = IntakeSourceFactsSchema.parse({
              sourceHash: row['source_hash'],
              mediaType: row['media_type'],
              byteSize: Number(row['byte_size']),
              parserVersion: row['parser_version'],
              status: row['status'],
              columns: z
                .array(z.object({ key: z.string() }))
                .parse(row['columns'] ?? [])
                .map((c) => c.key),
              recordCount:
                row['record_count'] === null
                  ? null
                  : Number(row['record_count']),
              featureCount:
                row['feature_count'] === null
                  ? null
                  : Number(row['feature_count']),
              reason: row['reason'],
              sourceRegistered: true,
            });
            const result = assessIntake(input.declaration, facts);
            const id = randomUUID();
            const inserted = await client.query(
              `insert into service.intake_assessment(assessment_id,tenant_id,project_id,actor_id,purpose,data_item_id,version_id,asset_id,analysis_id,source_hash,security_level,policy_version,declaration,facts,result,created_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,decode($10,'hex'),$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16::timestamptz) returning *`,
              [
                id,
                context.authorization.tenantId,
                context.authorization.projectId,
                context.principal.actorId,
                context.authorization.purpose,
                input.dataItemId,
                input.versionId,
                input.assetId,
                row['analysis_id'],
                facts.sourceHash,
                context.effectiveMaxSecurityLevel,
                context.authorization.authzVersion,
                JSON.stringify(input.declaration),
                JSON.stringify(facts),
                JSON.stringify(result),
                timestamp,
              ],
            );
            return {
              output: { assessment: assessment(inserted.rows[0]!) },
              replayResult: { assessmentId: id },
              aggregateId: id,
              eventType: 'data.assessment.created',
              securityLevel: context.effectiveMaxSecurityLevel,
            };
          },
          async (client, _timestamp, ledger) => ({
            assessment: await load(
              client,
              z.object({ assessmentId: z.uuid() }).parse(ledger.result)
                .assessmentId,
            ),
          }),
        );
      },
    },
    {
      id: 'data.assessment.get',
      async execute(raw, context) {
        const input = GetAssessmentInputSchema.parse(raw);
        return read(context, async (client) => ({
          assessment: await load(client, input.assessmentId),
        }));
      },
    },
    {
      id: 'data.assessment.list',
      async execute(raw, context) {
        const input = ListAssessmentsInputSchema.parse(raw);
        return read(context, async (client) => {
          await authorize(client, input);
          if (input.after) {
            const cursor = await load(client, input.after);
            if (
              cursor.versionId !== input.versionId ||
              cursor.dataItemId !== input.dataItemId
            )
              throw new DataCapabilityHandlerError('VALIDATION_FAILED');
          }
          const rows = await client.query(
            `select r.* from service.intake_assessment r join catalog.asset a on a.asset_id=r.asset_id and a.version_id=r.version_id and a.content_hash=r.source_hash and a.lifecycle_state='RAW' where r.version_id=$1::uuid and r.data_item_id=$2::uuid and ($3::uuid is null or r.assessment_id>$3::uuid) order by r.assessment_id limit $4`,
            [
              input.versionId,
              input.dataItemId,
              input.after ?? null,
              input.first + 1,
            ],
          );
          const items = rows.rows.slice(0, input.first).map(assessment);
          return {
            items,
            ...(rows.rows.length > input.first
              ? { nextCursor: items.at(-1)!.assessmentId }
              : {}),
          };
        });
      },
    },
  ];
}
