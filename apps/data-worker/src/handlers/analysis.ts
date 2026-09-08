import { createHash } from 'node:crypto';
import {
  AnalysisJobPayloadSchema,
  SourceRegistrationManifestSchema,
  SourceRegistrationSchema,
} from '@wiser/data-contracts';
import {
  ANALYSIS_PARSER_VERSION,
  AnalysisContentError,
  parseAnalysisContent,
  type AnalysisColumn,
  type AnalysisContentEvent,
  type DataPostgresPool,
  type VersionObjectReadInput,
} from '@wiser/data-infra';
import type { ExternalAnalysisInput } from '../adapters/analysis-parser.js';
import { DataJobHandlerError, type DataJobHandler } from './registry.js';

const MAX_BYTES = 64 * 1024 * 1024;
function requiredText(
  row: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const value = row[key];
  if (typeof value !== 'string' || value.length === 0)
    throw failure('ANALYSIS_AUTHORITY_INVALID');
  return value;
}
function readRun(row: Readonly<Record<string, unknown>>) {
  const manifest = row['asset_manifest'];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
    throw failure('ANALYSIS_AUTHORITY_INVALID');
  const status = requiredText(row, 'status');
  if (!['PENDING', 'READY', 'PARTIAL'].includes(status))
    throw failure('ANALYSIS_AUTHORITY_INVALID');
  return {
    version_id: requiredText(row, 'version_id'),
    data_item_id: requiredText(row, 'data_item_id'),
    status,
    parser_version: requiredText(row, 'parser_version'),
    asset_manifest: manifest as Readonly<Record<string, unknown>>,
  };
}
function readAsset(row: Readonly<Record<string, unknown>>) {
  const byteSize = Number(row['byte_size']);
  const hash = requiredText(row, 'source_hash');
  if (
    !Number.isSafeInteger(byteSize) ||
    byteSize < 0 ||
    !/^[a-f0-9]{64}$/.test(hash)
  )
    throw failure('ANALYSIS_AUTHORITY_INVALID');
  return {
    asset_id: requiredText(row, 'asset_id'),
    source_hash: hash,
    media_type: requiredText(row, 'media_type'),
    byte_size: byteSize,
  };
}
type ParsedRecord = Extract<AnalysisContentEvent, { type: 'record' }>;
function failure(category: string, retryable = false): DataJobHandlerError {
  return new DataJobHandlerError(
    category,
    retryable,
    'Analysis could not be completed.',
  );
}

export function createAnalysisHandler(options: {
  readonly pool: DataPostgresPool;
  readonly read: (input: VersionObjectReadInput) => Promise<Uint8Array>;
  readonly parseExternal?: (
    input: ExternalAnalysisInput,
  ) => AsyncIterable<AnalysisContentEvent>;
}): DataJobHandler {
  return async (job) => {
    const { analysisId } = AnalysisJobPayloadSchema.parse(job.payload);
    if (
      !job.tenantId ||
      !job.projectId ||
      !job.securityLevel ||
      !job.policyVersion ||
      job.cancelRequested
    )
      throw failure('ANALYSIS_SCOPE_INVALID');
    const scope = [
      job.tenantId,
      job.projectId,
      job.securityLevel,
      String(job.policyVersion),
    ];
    const client = await options.pool.connect();
    const result = {
      analysisId,
      recordCount: 0,
      featureCount: 0,
      assetCount: 0,
      invalidAssetCount: 0,
      unsupportedAssetCount: 0,
      partialAssetCount: 0,
    };
    try {
      await client.query('begin');
      await client.query(
        `select set_config('wiser.tenant_id',$1,true),set_config('wiser.project_id',$2,true),set_config('wiser.max_security_level',$3,true),set_config('wiser.policy_version',$4,true),set_config('statement_timeout','30000',true)`,
        scope,
      );
      const runRow = (
        await client.query(
          `
        /* analysis.load-run */
        select run.version_id,version.data_item_id,run.status,run.parser_version,version.asset_manifest
        from service.analysis_run run join catalog.data_item_version version using (tenant_id,project_id,version_id)
        join catalog.data_item item using (tenant_id,project_id,data_item_id)
        where run.analysis_id=$1::uuid and run.operation_id=$2::uuid
          and version.publication_status='PUBLISHED' and item.publication_status='PUBLISHED'
          and version.acceptance_status in ('PASSED','CONDITIONALLY_PASSED') and item.acceptance_status in ('PASSED','CONDITIONALLY_PASSED')
        for update of run
      `,
          [analysisId, job.operationId],
        )
      ).rows[0];
      if (!runRow) throw failure('ANALYSIS_VERSION_UNAVAILABLE');
      const run = readRun(runRow);
      if (run.parser_version !== ANALYSIS_PARSER_VERSION)
        throw failure('ANALYSIS_PARSER_VERSION_UNAVAILABLE');
      const leaseFence = async () => {
        const lease = await client.query(
          `
          /* analysis.lease-fence */
          select job_id from ingestion.job where job_id=$1::uuid and operation_id=$2::uuid
            and status='RUNNING' and lease_owner=$3 and attempt_count=$4
            and lease_expires_at>clock_timestamp() and cancel_requested_at is null
            and timeout_at>clock_timestamp() for update
        `,
          [job.jobId, job.operationId, job.leaseOwner, job.attemptCount],
        );
        if (lease.rows.length !== 1) throw failure('ANALYSIS_LEASE_LOST');
      };
      if (run.status !== 'PENDING') {
        const totals = (
          await client.query(
            `select count(*)::integer asset_count,coalesce(sum(record_count),0)::text record_count,coalesce(sum(feature_count),0)::text feature_count,count(*) filter(where status='PARTIAL')::integer partial_count,count(*) filter(where status='INVALID')::integer invalid_count,count(*) filter(where status in ('UNSUPPORTED','RESTRICTED'))::integer unsupported_count from service.analysis_asset where analysis_id=$1::uuid`,
            [analysisId],
          )
        ).rows[0];
        if (!totals) throw failure('ANALYSIS_RESULT_UNAVAILABLE');
        result.assetCount = Number(totals['asset_count']);
        result.recordCount = Number(totals['record_count']);
        result.featureCount = Number(totals['feature_count']);
        result.partialAssetCount = Number(totals['partial_count'] ?? 0);
        result.invalidAssetCount = Number(totals['invalid_count']);
        result.unsupportedAssetCount = Number(totals['unsupported_count']);
        await leaseFence();
        await client.query('commit');
        return { status: 'SUCCEEDED', result };
      }
      const assets = (
        await client.query(
          `
        /* analysis.load-assets */
        select asset_id,encode(content_hash,'hex') source_hash,media_type,byte_size::text
        from catalog.asset where version_id=$1::uuid and lifecycle_state in ('RAW','PUBLISHED') order by asset_id
      `,
          [run.version_id],
        )
      ).rows.map(readAsset);
      const read = (asset: ReturnType<typeof readAsset>) =>
        options.read({
          tenantId: job.tenantId!,
          projectId: job.projectId!,
          versionId: run.version_id,
          sha256: asset.source_hash,
          maximumBytes: Math.min(MAX_BYTES, Math.max(1, asset.byte_size)),
        });
      const registration =
        run.asset_manifest['sourceRegistration'] === undefined
          ? null
          : SourceRegistrationSchema.parse(
              run.asset_manifest['sourceRegistration'],
            );
      let files: ReturnType<
        typeof SourceRegistrationManifestSchema.parse
      >['files'] = [];
      if (registration) {
        const manifestAsset = assets.find(
          (asset) => asset.asset_id === registration.manifestAssetId,
        );
        if (!manifestAsset || manifestAsset.byte_size > 512 * 1024)
          throw failure('ANALYSIS_MANIFEST_UNAVAILABLE');
        const manifestBytes = await read(manifestAsset);
        if (
          createHash('sha256').update(manifestBytes).digest('hex') !==
          registration.manifestSha256
        )
          throw failure('ANALYSIS_MANIFEST_HASH_MISMATCH');
        files = SourceRegistrationManifestSchema.parse(
          JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes),
          ),
        ).files;
        if (
          files.some(
            (file) =>
              file.assetId !== undefined &&
              !assets.some(
                (asset) =>
                  asset.asset_id === file.assetId &&
                  asset.source_hash === file.preparedSha256,
              ),
          )
        )
          throw failure('ANALYSIS_ASSET_UNAVAILABLE');
      }
      for (const asset of assets) {
        result.assetCount += 1;
        const paths = files.filter((file) => file.assetId === asset.asset_id);
        const isManifest = asset.asset_id === registration?.manifestAssetId;
        const suffixes = paths.map((file) =>
          file.path.toLowerCase().split('.').at(-1),
        );
        const format =
          asset.media_type.includes('csv') || suffixes.includes('csv')
            ? 'csv'
            : /(?:json|geo\+json)/.test(asset.media_type) ||
                suffixes.includes('json') ||
                suffixes.includes('geojson')
              ? 'json'
              : ((
                  ['xlsx', 'xls', 'html', 'md', 'pdf', 'txt', 'zip'] as const
                ).find(
                  (kind) =>
                    suffixes.includes(kind) ||
                    {
                      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                      xls: 'application/vnd.ms-excel',
                      html: 'text/html',
                      md: 'text/markdown',
                      pdf: 'application/pdf',
                      txt: 'text/plain',
                      zip: 'application/zip',
                    }[kind] === asset.media_type,
                ) ?? null);
        let status = isManifest ? 'MANIFEST' : 'UNSUPPORTED';
        let reason: string | null = isManifest
          ? 'REGISTRATION_MANIFEST'
          : 'FORMAT_UNSUPPORTED';
        let columns: readonly AnalysisColumn[] = [];
        let records: number | null = null;
        let features: number | null = null;
        await client.query(
          `
          /* analysis.insert-asset */
          insert into service.analysis_asset (analysis_id,asset_id,tenant_id,project_id,source_hash,status,reason,source_paths,security_level,policy_version)
          values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,decode($5,'hex'),$6,$7,$8::jsonb,$9,$10::bigint)
        `,
          [
            analysisId,
            asset.asset_id,
            job.tenantId,
            job.projectId,
            asset.source_hash,
            status,
            reason,
            JSON.stringify(paths),
            job.securityLevel,
            job.policyVersion,
          ],
        );
        if (
          !isManifest &&
          format !== null &&
          asset.byte_size <= MAX_BYTES &&
          (format === 'csv' || format === 'json' || options.parseExternal)
        ) {
          await client.query('savepoint analysis_asset_records');
          try {
            const batch: ParsedRecord[] = [];
            const flush = async () => {
              if (batch.length === 0) return;
              await client.query(
                `
                /* analysis.insert-records */
                insert into catalog.analysis_record (analysis_id,record_id,asset_id,tenant_id,project_id,record_index,source_id,record_values,geom,security_level,policy_version)
                select $1::uuid,(r->>'recordId')::uuid,$2::uuid,$3::uuid,$4::uuid,(r->>'index')::bigint,r->>'sourceId',r->'values',
                  case when r->'geometry'='null'::jsonb then null else st_setsrid(st_geomfromgeojson((r->'geometry')::text),4326) end,$5,$6::bigint
                from jsonb_array_elements($7::jsonb) r
              `,
                [
                  analysisId,
                  asset.asset_id,
                  job.tenantId,
                  job.projectId,
                  job.securityLevel,
                  job.policyVersion,
                  JSON.stringify(batch),
                ],
              );
              batch.length = 0;
            };
            const input = {
              bytes: await read(asset),
              format,
              dataItemId: run.data_item_id,
              versionId: run.version_id,
              assetId: asset.asset_id,
              sourceHash: asset.source_hash,
            };
            const events =
              format === 'csv' || format === 'json'
                ? parseAnalysisContent({ ...input, format })
                : options.parseExternal!({
                    ...input,
                    path: paths[0]?.path ?? `${asset.asset_id}.${format}`,
                  });
            for await (const event of events) {
              if (event.type === 'schema') columns = event.columns;
              if (event.type === 'record') {
                batch.push(event);
                if (batch.length === 500) await flush();
              }
              if (event.type === 'summary') {
                status = event.status;
                records = event.recordCount;
                features = event.featureCount;
                reason = event.reason ?? null;
              }
            }
            await flush();
            await client.query('release savepoint analysis_asset_records');
          } catch (error) {
            await client.query('rollback to savepoint analysis_asset_records');
            await client.query('release savepoint analysis_asset_records');
            if (!(error instanceof AnalysisContentError)) throw error;
            status = [
              'RECORD_LIMIT',
              'SIZE_LIMIT',
              'UNKNOWN_CRS',
              'COLUMN_LIMIT',
              'ARCHIVE_LIMIT',
              'CAPACITY_LIMIT',
              'PARSING_FAILED',
            ].includes(error.code)
              ? 'UNSUPPORTED'
              : error.code === 'ENCRYPTED_CONTENT'
                ? 'RESTRICTED'
                : 'INVALID';
            reason = error.code;
            records = null;
            features = null;
            columns = [];
          }
        } else if (!isManifest && asset.byte_size > MAX_BYTES)
          reason = 'SIZE_LIMIT';
        else if (!isManifest && format && !options.parseExternal)
          reason = 'PARSER_NOT_CONFIGURED';
        if (status === 'PARTIAL') result.partialAssetCount += 1;
        if (status === 'INVALID') result.invalidAssetCount += 1;
        if (status === 'UNSUPPORTED' || status === 'RESTRICTED')
          result.unsupportedAssetCount += 1;
        result.recordCount += records ?? 0;
        result.featureCount += features ?? 0;
        await client.query(
          `
          /* analysis.finish-asset */
          update service.analysis_asset set status=$3,reason=$4,record_count=$5,feature_count=$6,columns=$7::jsonb
          where analysis_id=$1::uuid and asset_id=$2::uuid
        `,
          [
            analysisId,
            asset.asset_id,
            status,
            reason,
            records,
            features,
            JSON.stringify(columns),
          ],
        );
      }
      await leaseFence();
      await client.query(
        `/* analysis.finish-run */ update service.analysis_run set status=$2,completed_at=clock_timestamp() where analysis_id=$1::uuid and status='PENDING'`,
        [
          analysisId,
          result.invalidAssetCount +
            result.unsupportedAssetCount +
            result.partialAssetCount >
          0
            ? 'PARTIAL'
            : 'READY',
        ],
      );
      await client.query('commit');
      return { status: 'SUCCEEDED', result };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      if (error instanceof DataJobHandlerError) throw error;
      throw failure('ANALYSIS_PROCESSING_FAILED', true);
    } finally {
      client.release();
    }
  };
}
