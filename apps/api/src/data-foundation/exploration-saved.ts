import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  CreateExplorationViewInputSchema,
  CreateExplorationViewOutputSchema,
  ListExplorationViewsInputSchema,
  ListExplorationViewsOutputSchema,
  OpenExplorationViewInputSchema,
  OpenExplorationViewOutputSchema,
  RevokeExplorationViewInputSchema,
  ExplorationSavedViewSchema,
  ExportExplorationInputSchema,
  ExportExplorationOutputSchema,
  ExplorationResultSchema,
  ExplorationViewSpecSchema,
  ExplorationVersionRefSchema,
  QuerySpecSchema,
  type ExplorationViewSpec,
  type ExplorationResult,
  type ExplorationResource,
} from '@wiser/data-contracts';
import {
  CommandTransactions,
  PostgresDataCommandError,
  type PostgresDataCommandPool,
} from './postgres-command-executors.js';
import {
  DataCapabilityHandlerError,
  type DataCapabilityExecutor,
  type DataCapabilityExecutionContext,
} from './capability-handler.js';
import type {
  QueryAdapterPgClient,
  QueryAdapterPgPool,
} from './query-adapters.js';
import { PostgresExplorationExecutor } from './exploration-runtime.js';
import { AUTHORIZED } from './exploration-authorization.js';
import { spatialMembers, spatialPredicate } from './exploration-spatial.js';
import { rebindExplorationView } from './exploration-saved-state.js';
const refsSchema = z
  .array(
    ExplorationVersionRefSchema.extend({
      analysisId: z.uuid().nullable().optional(),
    }),
  )
  .max(10000);
const snapshotSchema = z.object({
  query_id: z.uuid(),
  spec: QuerySpecSchema,
  version_refs: refsSchema,
});
const savedSchema = snapshotSchema.extend({
  view_id: z.uuid(),
  actor_id: z.uuid(),
  title: z.string(),
  visibility: z.enum(['private', 'project']),
  view_spec: ExplorationViewSpecSchema,
  created_at: z.coerce.date(),
  revoked_at: z.coerce.date().nullable(),
});
type Saved = z.infer<typeof savedSchema>;
const scopeSql = `select set_config('wiser.tenant_id',$1,true),set_config('wiser.project_id',$2,true),set_config('wiser.actor_id',$3,true),set_config('wiser.max_security_level',$4,true),set_config('wiser.policy_version',$5,true),set_config('wiser.purpose',$6,true),set_config('statement_timeout',$7,true)`;
const metadata = (row: Saved) =>
  ExplorationSavedViewSchema.parse({
    viewId: row.view_id,
    title: row.title,
    visibility: row.visibility,
    createdAt: row.created_at.toISOString(),
    revokedAt: row.revoked_at?.toISOString() ?? null,
  });
async function scope(
  client: QueryAdapterPgClient,
  context: DataCapabilityExecutionContext,
) {
  if (context.signal.aborted)
    throw new DataCapabilityHandlerError('CAPABILITY_TIMEOUT');
  await client.query(scopeSql, [
    context.authorization.tenantId,
    context.authorization.projectId,
    context.principal.actorId,
    context.effectiveMaxSecurityLevel,
    String(context.authorization.authzVersion),
    context.authorization.purpose,
    String(context.timeoutMs),
  ]);
}
async function authorized(
  client: QueryAdapterPgClient,
  refs: z.infer<typeof refsSchema>,
) {
  const checked = await client.query(
    `${AUTHORIZED} select count(*)::int as total from authorized`,
    [JSON.stringify(refs)],
  );
  if (checked.rows[0]?.['total'] !== refs.length)
    throw new DataCapabilityHandlerError('CONFLICT');
}
async function readSaved(
  client: QueryAdapterPgClient,
  id: string,
  owner?: string,
  includeRevoked = false,
): Promise<Saved> {
  const result = await client.query(
    `select * from service.exploration_saved_view where view_id=$1::uuid and ($2::uuid is null or actor_id=$2::uuid) and ($3::boolean or revoked_at is null)`,
    [id, owner ?? null, includeRevoked],
  );
  if (!result.rows[0]) throw new DataCapabilityHandlerError('NOT_FOUND');
  return savedSchema.parse(result.rows[0]);
}
async function validateReferences(
  client: QueryAdapterPgClient,
  snapshot: z.infer<typeof snapshotSchema>,
  view: ExplorationViewSpec,
) {
  const refs = snapshot.version_refs;
  const serialized = JSON.stringify(refs);
  for (const request of Object.values(view.requests)) {
    if (!request) continue;
    if (
      request.versionId &&
      !refs.some((ref) => ref.versionId === request.versionId)
    )
      throw new DataCapabilityHandlerError('NOT_FOUND');
    const assetId = request.assetId ?? request.aggregate?.assetId;
    if (assetId) {
      const found = await client.query(
        `select 1 from catalog.asset asset join jsonb_array_elements($1::jsonb) ref on asset.version_id=(ref->>'versionId')::uuid where asset.asset_id=$2::uuid and ($3::uuid is null or asset.version_id=$3::uuid)`,
        [serialized, assetId, request.versionId ?? null],
      );
      if (
        !found.rows.length ||
        (snapshot.spec.recordQuery &&
          snapshot.spec.recordQuery.assetId !== assetId)
      )
        throw new DataCapabilityHandlerError('NOT_FOUND');
    }
  }
  const selection = view.selection;
  if (
    selection &&
    !refs.some(
      (ref) =>
        ref.versionId === selection.versionId &&
        ref.dataItemId === selection.dataItemId,
    )
  )
    throw new DataCapabilityHandlerError('NOT_FOUND');
  const recordRequests = [
    ...Object.values(view.requests).flatMap((request) =>
      request?.recordId && request.versionId
        ? [{ recordId: request.recordId, versionId: request.versionId }]
        : [],
    ),
    ...(selection?.recordId
      ? [{ recordId: selection.recordId, versionId: selection.versionId }]
      : []),
  ];
  for (const request of recordRequests) {
    const found = await client.query(
      `select 1 from catalog.analysis_record record join jsonb_array_elements($1::jsonb) ref on record.analysis_id=(ref->>'analysisId')::uuid where record.record_id=$2::uuid and ref->>'versionId'=$3::text and ($4::jsonb is null or (record.asset_id=($4->>'assetId')::uuid and service.exploration_record_matches(record.record_values,$4->'filters'))) and ($5::float8[] is null or ${spatialPredicate('record.geom', '$5::float8[]')})`,
      [
        serialized,
        request.recordId,
        request.versionId,
        snapshot.spec.recordQuery
          ? JSON.stringify(snapshot.spec.recordQuery)
          : null,
        snapshot.spec.spatialBounds ?? null,
      ],
    );
    if (!found.rows.length) throw new DataCapabilityHandlerError('NOT_FOUND');
  }
  rebindExplorationView(view, snapshot.query_id, snapshot.query_id);
  if (Buffer.byteLength(JSON.stringify(view), 'utf8') > 120000)
    throw new DataCapabilityHandlerError('VALIDATION_FAILED');
}
async function commandErrors<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
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
export function createExplorationSavedExecutors(
  pool: QueryAdapterPgPool & PostgresDataCommandPool,
  exploration = new PostgresExplorationExecutor(pool),
): readonly DataCapabilityExecutor[] {
  const transactions = new CommandTransactions(
    pool,
    randomUUID,
    () => new Date(),
  );
  async function read<T>(
    context: DataCapabilityExecutionContext,
    action: (client: QueryAdapterPgClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const client = await pool.connect();
      try {
        await client.query('begin isolation level repeatable read');
        await scope(client, context);
        const result = await action(client);
        if (context.signal.aborted)
          throw new DataCapabilityHandlerError('CAPABILITY_TIMEOUT');
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        if (error instanceof DataCapabilityHandlerError) throw error;
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          (error.code === '40001' || error.code === '40P01')
        )
          continue;
        throw new DataCapabilityHandlerError('EXECUTION_FAILED');
      } finally {
        client.release();
      }
    }
    throw new DataCapabilityHandlerError('EXECUTION_FAILED');
  }

  return [
    {
      id: 'data.explore.view.create',
      async execute(raw, context) {
        const input = CreateExplorationViewInputSchema.parse(raw);
        return transactions.run(
          'data.explore.view.create',
          input,
          context,
          (client, timestamp) =>
            commandErrors(async () => {
              await scope(client, context);
              const loaded = await client.query(
                'select * from service.exploration_snapshot where query_id=$1::uuid and expires_at>clock_timestamp()',
                [input.queryId],
              );
              if (!loaded.rows[0])
                throw new DataCapabilityHandlerError('NOT_FOUND');
              const snapshot = snapshotSchema.parse(loaded.rows[0]);
              await authorized(client, snapshot.version_refs);
              await validateReferences(client, snapshot, input.viewSpec);
              await client.query(
                'select pg_advisory_xact_lock(hashtextextended($1,0))',
                [
                  `${context.authorization.tenantId}:${context.authorization.projectId}:${context.principal.actorId}:saved`,
                ],
              );
              const count = await client.query(
                'select count(*)::int total from service.exploration_saved_view where actor_id=$1::uuid and revoked_at is null',
                [context.principal.actorId],
              );
              if (z.coerce.number().parse(count.rows[0]?.['total']) >= 100)
                throw new DataCapabilityHandlerError('VALIDATION_FAILED');
              const viewId = randomUUID();
              const inserted = await client.query(
                `insert into service.exploration_saved_view(view_id,query_id,tenant_id,project_id,actor_id,purpose,security_level,policy_version,title,visibility,spec,version_refs,view_spec,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14::timestamptz) returning *`,
                [
                  viewId,
                  input.queryId,
                  context.authorization.tenantId,
                  context.authorization.projectId,
                  context.principal.actorId,
                  context.authorization.purpose,
                  context.effectiveMaxSecurityLevel,
                  context.authorization.authzVersion,
                  input.title,
                  input.visibility,
                  JSON.stringify(snapshot.spec),
                  JSON.stringify(snapshot.version_refs),
                  JSON.stringify(input.viewSpec),
                  timestamp,
                ],
              );
              const output = {
                savedView: metadata(savedSchema.parse(inserted.rows[0])),
              };
              return {
                output,
                replayResult: output,
                aggregateId: viewId,
                eventType: 'data.exploration-view.created',
                securityLevel: context.effectiveMaxSecurityLevel,
              };
            }),
          (client, _timestamp, ledger) =>
            commandErrors(async () => {
              await scope(client, context);
              const previous = CreateExplorationViewOutputSchema.parse(
                ledger.result,
              );
              const saved = await readSaved(
                client,
                previous.savedView.viewId,
                context.principal.actorId,
              );
              await authorized(client, saved.version_refs);
              return { savedView: metadata(saved) };
            }),
        );
      },
    },
    {
      id: 'data.explore.view.list',
      async execute(raw, context) {
        ListExplorationViewsInputSchema.parse(raw);
        return read(context, async (client) => {
          const rows = await client.query(
            'select * from service.exploration_saved_view where actor_id=$1::uuid and revoked_at is null order by created_at desc,view_id limit 100',
            [context.principal.actorId],
          );
          return ListExplorationViewsOutputSchema.parse({
            items: rows.rows.map((row) => metadata(savedSchema.parse(row))),
          });
        });
      },
    },
    {
      id: 'data.explore.view.revoke',
      async execute(raw, context) {
        const input = RevokeExplorationViewInputSchema.parse(raw);
        const replay = async (client: QueryAdapterPgClient) =>
          commandErrors(async () => {
            await scope(client, context);
            await readSaved(
              client,
              input.viewId,
              context.principal.actorId,
              true,
            );
            return { viewId: input.viewId, revoked: true as const };
          });
        return transactions.run(
          'data.explore.view.revoke',
          input,
          context,
          (client, timestamp) =>
            commandErrors(async () => {
              await replay(client);
              await client.query(
                'update service.exploration_saved_view set revoked_at=coalesce(revoked_at,$2::timestamptz) where view_id=$1::uuid and actor_id=$3::uuid',
                [input.viewId, timestamp, context.principal.actorId],
              );
              const output = { viewId: input.viewId, revoked: true };
              return {
                output,
                replayResult: output,
                aggregateId: input.viewId,
                eventType: 'data.exploration-view.revoked',
                securityLevel: context.effectiveMaxSecurityLevel,
              };
            }),
          replay,
        );
      },
    },
    {
      id: 'data.explore.view.open',
      async execute(raw, context) {
        const input = OpenExplorationViewInputSchema.parse(raw);
        const restored = await read(context, async (client) => {
          const saved = await readSaved(client, input.viewId);
          await authorized(client, saved.version_refs);
          const queryId = randomUUID();
          await client.query(
            'select pg_advisory_xact_lock(hashtextextended($1,0))',
            [
              [
                context.authorization.tenantId,
                context.authorization.projectId,
                context.principal.actorId,
              ].join(':'),
            ],
          );
          await client.query(
            `delete from service.exploration_snapshot where expires_at<=clock_timestamp() or query_id in(select query_id from service.exploration_snapshot order by created_at desc offset 31)`,
          );
          await client.query(
            `insert into service.exploration_snapshot(query_id,tenant_id,project_id,actor_id,purpose,security_level,policy_version,spec,version_refs,created_at,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,statement_timestamp(),statement_timestamp()+interval '30 minutes')`,
            [
              queryId,
              context.authorization.tenantId,
              context.authorization.projectId,
              context.principal.actorId,
              context.authorization.purpose,
              context.effectiveMaxSecurityLevel,
              context.authorization.authzVersion,
              JSON.stringify(saved.spec),
              JSON.stringify(saved.version_refs),
            ],
          );
          const viewSpec = rebindExplorationView(
            saved.view_spec,
            saved.query_id,
            queryId,
          );
          const visible = await spatialMembers(
            client,
            saved.version_refs,
            saved.spec,
          );
          const selectionIndex = viewSpec.selection
            ? visible.findIndex(
                (ref) => ref.versionId === viewSpec.selection!.versionId,
              )
            : -1;
          return { saved, viewSpec, queryId, selectionIndex };
        });
        const { saved, viewSpec, queryId, selectionIndex } = restored;
        const result = ExplorationResultSchema.parse(
          await exploration.execute(
            viewSpec.requests.resources ?? {
              queryId,
              view: 'resources',
              first: 25,
            },
            context,
          ),
        );
        let selectedResource: ExplorationResource | undefined =
          result.resources.find(
            (resource) => resource.versionId === viewSpec.selection?.versionId,
          );
        if (!selectedResource && selectionIndex >= 0) {
          const page = ExplorationResultSchema.parse(
            await exploration.execute(
              {
                queryId,
                view: 'resources',
                first: 1,
                ...(selectionIndex
                  ? {
                      after: Buffer.from(
                        JSON.stringify({ queryId, offset: selectionIndex }),
                      ).toString('base64url'),
                    }
                  : {}),
              },
              context,
            ),
          );
          selectedResource = page.resources[0];
        }
        const selection = viewSpec.selection;
        const selectedRecord = selection?.recordId
          ? ExplorationResultSchema.parse(
              await exploration.execute(
                {
                  queryId,
                  view: 'records',
                  versionId: selection.versionId,
                  recordId: selection.recordId,
                },
                context,
              ),
            ).records?.[0]
          : undefined;
        const selectedNode = selection?.nodeId
          ? ExplorationResultSchema.parse(
              await exploration.execute(
                viewSpec.requests.graph ?? {
                  queryId,
                  view: 'graph',
                  versionId: selection.versionId,
                  ...(selection.recordId
                    ? { recordId: selection.recordId }
                    : {}),
                },
                context,
              ),
            ).graph?.nodes.find((node) => node.id === selection.nodeId)
          : undefined;
        return OpenExplorationViewOutputSchema.parse({
          savedView: metadata(saved),
          viewSpec,
          result,
          ...(selectedResource ? { selectedResource } : {}),
          ...(selectedRecord ? { selectedRecord } : {}),
          ...(selectedNode ? { selectedNode } : {}),
        });
      },
    },
    {
      id: 'data.explore.export',
      async execute(raw, context) {
        const { request } = ExportExplorationInputSchema.parse(raw);
        const result = ExplorationResultSchema.parse(
          await exploration.execute(request, context),
        );
        const coverage = exportCoverage(result, request.after !== undefined);
        return ExportExplorationOutputSchema.parse({
          request,
          result,
          coverage,
          exportedAt: new Date().toISOString(),
        });
      },
    },
  ];
}
function exportCoverage(result: ExplorationResult, continuation: boolean) {
  let unit:
    'resources' | 'records' | 'versions' | 'assets' | 'evidence' | 'groups' =
    'resources';
  let returnedCount = result.resources.length,
    totalCount = result.totalCount;
  let complete = !continuation && !result.nextCursor;
  if (result.view === 'records') {
    unit = 'records';
    returnedCount = result.records?.length ?? 0;
  }
  if (result.view === 'map') {
    unit = 'records';
    returnedCount = result.features?.length ?? 0;
  }
  if (result.graph) {
    unit = result.graph.grain ?? 'versions';
    const kind = {
      versions: 'VERSION',
      assets: 'ASSET',
      evidence: 'EVIDENCE',
      records: 'RECORD',
    }[unit];
    returnedCount = result.graph.nodes.filter(
      (node) => node.kind === kind,
    ).length;
    complete = complete && !result.graph.truncated;
  }
  if (result.aggregate) {
    unit = 'groups';
    returnedCount = result.aggregate.groups.length;
    totalCount = result.aggregate.groupCount;
    complete = complete && !result.aggregate.truncated;
  }
  return { unit, returnedCount, totalCount, complete };
}
