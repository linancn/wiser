import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ImportRelationsInputSchema,
  ImportRelationsOutputSchema,
  RelationGetInputSchema,
  RelationReviewInputSchema,
  RelationListInputSchema,
  RelationAssertionSchema,
  type RelationAssertion,
  type RelationCandidate,
} from '@wiser/data-contracts';
import {
  assertRelationEntityConsistency,
  groupRelationCandidates,
} from '@wiser/data-core';
import {
  CommandTransactions,
  PostgresDataCommandError,
  type PostgresDataCommandPool,
  type PostgresDataCommandClient,
} from './postgres-command-executors.js';
import {
  DataCapabilityHandlerError,
  type DataCapabilityExecutionContext,
  type DataCapabilityExecutor,
} from './capability-handler.js';
import { AUTHORIZED } from './exploration-authorization.js';

type Client = PostgresDataCommandClient;
const fail = (code: 'NOT_FOUND' | 'STATE_CONFLICT' | 'IDEMPOTENCY_CONFLICT') =>
  new PostgresDataCommandError(code);
const SELECT = `select b.*,a.status,a.row_version,a.created_at,
 coalesce((select jsonb_agg(jsonb_build_object('reviewId',r.review_record_id,'reviewerId',r.reviewer_actor_id,'decision',r.decision,'rationale',r.rationale,'createdAt',r.created_at) order by r.row_version) from knowledge.review_record r where r.assertion_id=a.assertion_id),'[]'::jsonb) reviews
 from knowledge.assertion_binding b join knowledge.assertion a using(tenant_id,project_id,assertion_id)`;
/** Reauthorize every source file at read time, independently of graph projection lag. */
const VISIBLE = `exists(select 1 from catalog.data_item_version v join catalog.data_item i using(tenant_id,project_id,data_item_id)
 where v.version_id=b.version_id and i.data_item_id=b.data_item_id and v.publication_status='PUBLISHED' and i.publication_status='PUBLISHED'
 and v.acceptance_status in ('PASSED','CONDITIONALLY_PASSED') and i.acceptance_status in ('PASSED','CONDITIONALLY_PASSED'))
 and not exists(select 1 from jsonb_array_elements(b.candidate->'evidence') e where not exists(select 1 from catalog.asset s where s.asset_id=(e->>'assetId')::uuid and s.version_id=b.version_id and s.content_hash=decode(e->>'sourceHash','hex') and s.lifecycle_state='RAW'))`;
function assertion(row: Record<string, unknown>): RelationAssertion {
  return RelationAssertionSchema.parse({
    assertionId: row['assertion_id'],
    dataItemId: row['data_item_id'],
    versionId: row['version_id'],
    version: Number(row['row_version']),
    mappingVersion: row['mapping_version'],
    candidate: row['candidate'],
    status: row['status'],
    confidence: null,
    createdAt: z.coerce.date().parse(row['created_at']).toISOString(),
    reviews: z
      .array(z.record(z.string(), z.unknown()))
      .parse(row['reviews'])
      .map((r) => ({
        ...r,
        createdAt: z.coerce.date().parse(r['createdAt']).toISOString(),
      })),
  });
}
async function authorize(
  client: Client,
  ref: { dataItemId: string; versionId: string },
  candidates: readonly RelationCandidate[] = [],
) {
  const checked = await client.query(
    `${AUTHORIZED} select count(*)::int total from authorized`,
    [JSON.stringify([ref])],
  );
  if (checked.rows[0]?.['total'] !== 1) throw fail('NOT_FOUND');
  const evidence = [
    ...new Map(
      candidates
        .flatMap((c) => c.evidence)
        .map((e) => [`${e.assetId}:${e.sourceHash}`, e]),
    ).values(),
  ];
  if (evidence.length) {
    const saved = await client.query(
      `select count(*)::int total from jsonb_array_elements($1::jsonb) e join catalog.asset a on a.asset_id=(e->>'assetId')::uuid and a.version_id=$2::uuid and a.content_hash=decode(e->>'sourceHash','hex') and a.lifecycle_state='RAW'`,
      [JSON.stringify(evidence), ref.versionId],
    );
    if (saved.rows[0]?.['total'] !== evidence.length) throw fail('NOT_FOUND');
  }
}
async function load(client: Client, id: string) {
  const rows = await client.query(
    `${SELECT} where b.assertion_id=$1::uuid and ${VISIBLE}`,
    [id],
  );
  if (!rows.rows[0]) throw fail('NOT_FOUND');
  return assertion(rows.rows[0]);
}
export function createKnowledgeRelationExecutors(
  pool: PostgresDataCommandPool,
): readonly DataCapabilityExecutor[] {
  const tx = new CommandTransactions(pool, randomUUID, () => new Date());
  async function read<T>(
    context: DataCapabilityExecutionContext,
    work: (c: Client) => Promise<T>,
  ) {
    const c = await pool.connect();
    try {
      await c.query('begin isolation level repeatable read');
      await c.query(
        "select set_config('wiser.tenant_id',$1,true),set_config('wiser.project_id',$2,true),set_config('wiser.max_security_level',$3,true),set_config('wiser.policy_version',$4,true),set_config('statement_timeout',$5,true)",
        [
          context.authorization.tenantId,
          context.authorization.projectId,
          context.effectiveMaxSecurityLevel,
          String(context.authorization.authzVersion),
          String(context.timeoutMs),
        ],
      );
      const result = await work(c);
      if (context.signal.aborted)
        throw new DataCapabilityHandlerError('CAPABILITY_TIMEOUT');
      await c.query('commit');
      return result;
    } catch (error) {
      await c.query('rollback').catch(() => undefined);
      if (error instanceof PostgresDataCommandError)
        throw new DataCapabilityHandlerError(
          error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'EXECUTION_FAILED',
        );
      if (error instanceof DataCapabilityHandlerError) throw error;
      throw new DataCapabilityHandlerError('EXECUTION_FAILED');
    } finally {
      c.release();
    }
  }
  return [
    {
      id: 'data.knowledge.relations.import',
      async execute(raw, context) {
        const input = ImportRelationsInputSchema.parse(raw);
        let grouped: ReturnType<typeof groupRelationCandidates>;
        try {
          grouped = groupRelationCandidates(input.candidates);
        } catch {
          throw new PostgresDataCommandError('INVALID_INPUT');
        }
        if (
          Buffer.byteLength(JSON.stringify(input)) > 262144 ||
          grouped.some(
            (g) => Buffer.byteLength(JSON.stringify(g.candidate)) > 100000,
          )
        )
          throw new PostgresDataCommandError('INVALID_INPUT');
        return tx.run(
          'data.knowledge.relations.import',
          input,
          context,
          async (client, timestamp) => {
            await authorize(
              client,
              input,
              grouped.map((g) => g.candidate),
            );
            // Serialize the source/mapping only, so a changed command key cannot race a duplicate import.
            await client.query(
              'select pg_advisory_xact_lock(hashtextextended($1,0))',
              [
                `${context.authorization.tenantId}:${context.authorization.projectId}:${input.versionId}:${input.mappingVersion}`,
              ],
            );
            const keys = [
              ...new Set(
                grouped.flatMap((g) => [
                  g.candidate.subject.key,
                  g.candidate.object.key,
                ]),
              ),
            ];
            const existingEntities = await client.query(
              `select value from knowledge.assertion_binding b cross join lateral (values(b.candidate->'subject'),(b.candidate->'object')) entity(value) where b.version_id=$1::uuid and b.mapping_version=$2 and value->>'key'=any($3::text[])`,
              [input.versionId, input.mappingVersion, keys],
            );
            try {
              assertRelationEntityConsistency([
                ...existingEntities.rows.map((r) => r['value']),
                ...grouped.flatMap((g) => [
                  g.candidate.subject,
                  g.candidate.object,
                ]),
              ]);
            } catch {
              throw fail('STATE_CONFLICT');
            }
            const items: RelationAssertion[] = [];
            let createdCount = 0;
            for (const { identity, candidate } of grouped) {
              const fingerprint = createHash('sha256')
                .update(JSON.stringify(candidate))
                .digest('hex');
              const old = await client.query(
                `select assertion_id,encode(fingerprint,'hex') fingerprint from knowledge.assertion_binding where version_id=$1::uuid and mapping_version=$2 and identity_key=$3`,
                [input.versionId, input.mappingVersion, identity],
              );
              if (old.rows[0]) {
                if (old.rows[0]['fingerprint'] !== fingerprint)
                  throw fail('IDEMPOTENCY_CONFLICT');
                items.push(
                  await load(client, String(old.rows[0]['assertion_id'])),
                );
                continue;
              }
              if (candidate.supersedesId) {
                const previous = await load(client, candidate.supersedesId);
                if (
                  previous.dataItemId !== input.dataItemId ||
                  previous.candidate.subject.key !== candidate.subject.key ||
                  previous.candidate.predicate !== candidate.predicate ||
                  previous.candidate.object.key !== candidate.object.key
                )
                  throw fail('STATE_CONFLICT');
              }
              const id = randomUUID(),
                evidenceId = randomUUID(),
                first = candidate.evidence[0]!;
              const scope = [
                context.authorization.tenantId,
                context.authorization.projectId,
              ];
              await client.query(
                `insert into knowledge.evidence_fragment(evidence_fragment_id,tenant_id,project_id,data_item_id,version_id,asset_id,locator,content_hash,excerpt,security_level,policy_version,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$7::jsonb,decode($8,'hex'),$9,$10,$11,$12,$12)`,
                [
                  evidenceId,
                  ...scope,
                  input.dataItemId,
                  input.versionId,
                  first.assetId,
                  JSON.stringify({
                    kind: 'RELATION_EVIDENCE',
                    locations: candidate.evidence,
                  }),
                  first.sourceHash,
                  first.excerpt,
                  context.effectiveMaxSecurityLevel,
                  context.authorization.authzVersion,
                  timestamp,
                ],
              );
              await client.query(
                `insert into knowledge.assertion(assertion_id,tenant_id,project_id,evidence_fragment_id,subject,predicate,object,confidence,generation_method,status,security_level,policy_version,created_at,updated_at) values($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,null,$8,'PENDING_REVIEW',$9,$10,$11,$11)`,
                [
                  id,
                  ...scope,
                  evidenceId,
                  JSON.stringify(candidate.subject),
                  candidate.predicate,
                  JSON.stringify(candidate.object),
                  candidate.generation.method,
                  context.effectiveMaxSecurityLevel,
                  context.authorization.authzVersion,
                  timestamp,
                ],
              );
              await client.query(
                `insert into knowledge.assertion_binding(assertion_id,tenant_id,project_id,data_item_id,version_id,mapping_version,identity_key,fingerprint,candidate,security_level,policy_version) values($1,$2,$3,$4,$5,$6,$7,decode($8,'hex'),$9::jsonb,$10,$11)`,
                [
                  id,
                  ...scope,
                  input.dataItemId,
                  input.versionId,
                  input.mappingVersion,
                  identity,
                  fingerprint,
                  JSON.stringify(candidate),
                  context.effectiveMaxSecurityLevel,
                  context.authorization.authzVersion,
                ],
              );
              items.push(await load(client, id));
              createdCount++;
            }
            const output = {
              items,
              createdCount,
              reusedCount: items.length - createdCount,
            };
            return {
              output,
              replayResult: {
                ids: items.map((x) => x.assertionId),
                createdCount,
              },
              aggregateId: input.versionId,
              eventType: 'data.knowledge.relations.imported',
              securityLevel: context.effectiveMaxSecurityLevel,
            };
          },
          async (client, _time, ledger) => {
            const saved = z
              .object({ ids: z.array(z.uuid()), createdCount: z.number() })
              .parse(ledger.result);
            const items = [];
            for (const id of saved.ids) items.push(await load(client, id));
            return ImportRelationsOutputSchema.parse({
              items,
              createdCount: saved.createdCount,
              reusedCount: items.length - saved.createdCount,
            });
          },
        );
      },
    },
    {
      id: 'data.knowledge.relations.get',
      execute: (raw, context) =>
        read(context, async (c) => ({
          assertion: await load(
            c,
            RelationGetInputSchema.parse(raw).assertionId,
          ),
        })),
    },
    {
      id: 'data.knowledge.relations.list',
      execute: (raw, context) =>
        read(context, async (c) => {
          const input = RelationListInputSchema.parse(raw);
          await authorize(c, input);
          if (input.after) {
            const cursor = await load(c, input.after);
            if (cursor.versionId !== input.versionId) throw fail('NOT_FOUND');
          }
          const where = `b.data_item_id=$1::uuid and b.version_id=$2::uuid and a.status=$3 and ($4::text is null or a.subject->>'key'=$4 or a.object->>'key'=$4) and ($5::text is null or b.mapping_version=$5) and ${VISIBLE}`;
          const values = [
            input.dataItemId,
            input.versionId,
            input.status,
            input.entityKey ?? null,
            input.mappingVersion ?? null,
          ];
          const count = await c.query(
            `select count(*)::int total from knowledge.assertion_binding b join knowledge.assertion a using(tenant_id,project_id,assertion_id) where ${where}`,
            values,
          );
          const page = await c.query(
            `${SELECT} where ${where} and ($6::uuid is null or b.assertion_id>$6::uuid) order by b.assertion_id limit $7`,
            [...values, input.after ?? null, input.first + 1],
          );
          const items = page.rows.slice(0, input.first).map(assertion);
          return {
            items,
            totalCount: count.rows[0]?.['total'],
            ...(page.rows.length > input.first
              ? { nextCursor: items.at(-1)!.assertionId }
              : {}),
          };
        }),
    },
    {
      id: 'data.knowledge.relations.review',
      async execute(raw, context) {
        if (context.principal.actorType !== 'human')
          throw new DataCapabilityHandlerError('FORBIDDEN');
        const input = RelationReviewInputSchema.parse(raw);
        return tx.run(
          'data.knowledge.relations.review',
          input,
          context,
          async (c, timestamp) => {
            await c.query(
              'select assertion_id from knowledge.assertion where assertion_id=$1::uuid for update',
              [input.assertionId],
            );
            const previous = await load(c, input.assertionId);
            if (
              previous.version !== input.expectedVersion ||
              previous.reviews.length >= 100
            )
              throw fail('STATE_CONFLICT');
            await c.query(
              `insert into knowledge.review_record(review_record_id,tenant_id,project_id,assertion_id,reviewer_actor_id,decision,rationale,security_level,policy_version,row_version,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
              [
                randomUUID(),
                context.authorization.tenantId,
                context.authorization.projectId,
                input.assertionId,
                context.principal.actorId,
                input.decision,
                input.rationale,
                context.effectiveMaxSecurityLevel,
                context.authorization.authzVersion,
                input.expectedVersion + 1,
                timestamp,
              ],
            );
            await c.query(
              `update knowledge.assertion set status=$2,row_version=row_version+1,updated_at=$3 where assertion_id=$1::uuid and row_version=$4`,
              [
                input.assertionId,
                input.decision,
                timestamp,
                input.expectedVersion,
              ],
            );
            const output = { assertion: await load(c, input.assertionId) };
            return {
              output,
              replayResult: { assertionId: input.assertionId },
              aggregateId: input.assertionId,
              eventType: 'data.knowledge.relation.reviewed',
              securityLevel: context.effectiveMaxSecurityLevel,
            };
          },
          async (c, _time, ledger) => ({
            assertion: await load(
              c,
              RelationGetInputSchema.parse(ledger.result).assertionId,
            ),
          }),
        );
      },
    },
  ];
}
