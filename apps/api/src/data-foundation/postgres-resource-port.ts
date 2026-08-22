import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { z } from 'zod';

import { deterministicStacCollectionId } from '@wiser/data-infra';
import {
  PlatformRequestContextSchema,
  type PlatformRequestContext,
} from '@wiser/platform-contracts';

import {
  DataFoundationResourceError,
  type DataFoundationResourcePort,
} from './resource-types.js';

export { DataFoundationResourceError } from './resource-types.js';

interface ResourceClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
  release(): void;
}

export interface DataFoundationResourcePool {
  connect(): Promise<ResourceClient>;
  end(): Promise<void>;
}

export interface StacResourceOptions {
  readonly baseUrl: string;
  readonly bearerToken: string;
  readonly publicApiOrigin: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

const SET_SCOPE_SQL = `
/* data.resource.scope */
select set_config('wiser.tenant_id', $1, true),
  set_config('wiser.project_id', $2, true),
  set_config('wiser.max_security_level', $3, true),
  set_config('wiser.policy_version', $4, true),
  set_config('statement_timeout', '5000', true)
`;

const EVIDENCE_LOOKUP_SQL = `
/* data.resource.evidence.lookup */
select fragment.evidence_fragment_id, fragment.data_item_id,
  fragment.version_id, fragment.asset_id, fragment.locator,
  encode(fragment.content_hash, 'hex') as content_hash, fragment.excerpt,
  fragment.security_level, fragment.policy_version, fragment.row_version,
  fragment.created_at
from knowledge.evidence_fragment as fragment
join catalog.data_item_version as version
  on version.tenant_id = fragment.tenant_id
 and version.project_id = fragment.project_id
 and version.version_id = fragment.version_id
where fragment.tenant_id = $1::uuid and fragment.project_id = $2::uuid
  and fragment.evidence_fragment_id = $3::uuid
  and version.committed_at is not null
  and security.authorized_row(fragment.tenant_id, fragment.project_id,
    fragment.security_level, fragment.policy_version)
  and security.authorized_row(version.tenant_id, version.project_id,
    version.security_level, version.policy_version)
  and octet_length(fragment.locator::text) <= 131072
  and octet_length(coalesce(fragment.excerpt, '')) <= 131072
limit 1
for key share of fragment, version
`;

const STAC_AUTHORIZE_SQL = `
/* data.resource.stac.authorize */
select fragment.evidence_fragment_id, fragment.data_item_id,
  fragment.version_id, encode(version.source_hash, 'hex') as content_hash,
  version.security_level, version.policy_version, version.row_version,
  version.publication_status, version.acceptance_status, version.quality_grade
from knowledge.evidence_fragment as fragment
join catalog.data_item_version as version
  on version.tenant_id = fragment.tenant_id
 and version.project_id = fragment.project_id
 and version.version_id = fragment.version_id
where fragment.tenant_id = $1::uuid and fragment.project_id = $2::uuid
  and fragment.evidence_fragment_id = $3::uuid
  and fragment.version_id = $4::uuid
  and fragment.data_item_id = $5::uuid
  and encode(version.source_hash, 'hex') = $6
  and publication_status = 'PUBLISHED'
  and version.acceptance_status in ('PASSED', 'CONDITIONALLY_PASSED')
  and security.authorized_row(fragment.tenant_id, fragment.project_id,
    fragment.security_level, fragment.policy_version)
  and security.authorized_row(version.tenant_id, version.project_id,
    version.security_level, version.policy_version)
limit 1
for key share of fragment, version
`;

const AUDIT_SQL = `
/* data.resource.audit */
insert into security.audit_event (
  tenant_id, project_id, actor_id, action, resource_type, resource_id,
  decision, purpose, context, security_level, policy_version, row_version
) values (
  $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, 'ALLOWED', $7,
  jsonb_build_object('traceId', $8::text, 'referenceHash', $6::text),
  $9, $10::bigint, 1
)
`;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const COLLECTION_PATTERN = /^wiser-[a-f0-9]{32}$/;
const ITEM_PATTERN = /^wiser-[a-f0-9]{48}$/;
const SECURITY_LEVELS = [
  'L0_PUBLIC',
  'L1_INTERNAL',
  'L2_RESTRICTED',
  'L3_CONFIDENTIAL',
] as const;
const SecurityLevelSchema = z.enum(SECURITY_LEVELS);
const QualityGradeSchema = z.enum(['A', 'B', 'C']);
const AcceptanceStatusSchema = z.enum([
  'PENDING',
  'PASSED',
  'CONDITIONALLY_PASSED',
  'CORRECTION_REQUIRED',
  'ARCHIVED_ONLY',
  'REJECTED',
]);
const PublicationStatusSchema = z.enum([
  'UNPUBLISHED',
  'PUBLISHING',
  'PUBLISHED',
  'WITHDRAWN',
]);
const GeometrySchema = z
  .object({
    type: z.enum([
      'Point',
      'MultiPoint',
      'LineString',
      'MultiLineString',
      'Polygon',
      'MultiPolygon',
    ]),
    coordinates: z.json(),
  })
  .strip();
const StacFeatureSchema = z
  .object({
    stac_version: z.literal('1.1.0'),
    stac_extensions: z.array(z.string().url().max(512)).max(16).default([]),
    type: z.literal('Feature'),
    id: z.string().regex(ITEM_PATTERN),
    collection: z.string().regex(COLLECTION_PATTERN),
    bbox: z.array(z.number().finite()).min(4).max(6),
    geometry: GeometrySchema,
    properties: z
      .object({
        datetime: z.string().datetime({ offset: true }),
        title: z.string().min(1).max(1024).optional(),
        description: z.string().min(1).max(8192).optional(),
        tenantId: z.string().uuid(),
        projectId: z.string().uuid(),
        dataItemId: z.string().uuid(),
        versionId: z.string().uuid(),
        evidenceId: z.string().uuid(),
        securityLevel: SecurityLevelSchema,
        policyVersion: z.number().int().positive(),
        sourceHash: z.string().regex(HASH_PATTERN),
        qualityGrade: QualityGradeSchema,
        acceptanceStatus: AcceptanceStatusSchema,
        publicationStatus: PublicationStatusSchema,
        businessDomains: z.array(z.string().min(1).max(128)).max(64),
        channels: z.array(z.string().min(1).max(64)).max(16),
        limitations: z.array(z.string().max(1024)).max(64),
      })
      .strip(),
    assets: z
      .object({
        source: z
          .object({
            href: z.string().url().max(2048),
            type: z.string().min(1).max(255),
            roles: z.array(z.string().min(1).max(64)).max(16),
            'file:checksum': z.string().regex(/^sha256:[a-f0-9]{64}$/),
            'file:size': z.number().int().nonnegative(),
          })
          .strip(),
      })
      .strip(),
  })
  .strip();

interface EvidenceRow {
  readonly evidenceId: string;
  readonly dataItemId: string;
  readonly versionId: string;
  readonly assetId?: string;
  readonly locator: z.infer<typeof z.json>;
  readonly contentHash: string;
  readonly excerpt?: string;
  readonly securityLevel: (typeof SECURITY_LEVELS)[number];
  readonly policyVersion: number;
  readonly rowVersion: number;
  readonly createdAt: string;
}

function resourceError(
  code: ConstructorParameters<typeof DataFoundationResourceError>[0],
  cause?: unknown,
) {
  return new DataFoundationResourceError(code, cause);
}

function rootUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw resourceError('UNAVAILABLE');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    (url.pathname !== '' && url.pathname !== '/')
  ) {
    throw resourceError('UNAVAILABLE');
  }
  return new URL(`${url.origin}/`);
}

function validSecret(value: string): boolean {
  return (
    value.length >= 16 &&
    value.length <= 2_048 &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  );
}

function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function timestamp(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    return null;
  }
  return new Date(value).toISOString();
}

function evidenceRow(row: Record<string, unknown> | undefined): EvidenceRow {
  const locator = z.json().safeParse(row?.['locator']);
  const securityLevel = SecurityLevelSchema.safeParse(row?.['security_level']);
  const policyVersion = positiveInteger(row?.['policy_version']);
  const rowVersion = positiveInteger(row?.['row_version']);
  const createdAt = timestamp(row?.['created_at']);
  const assetId = row?.['asset_id'];
  const excerpt = row?.['excerpt'];
  if (
    row === undefined ||
    typeof row['evidence_fragment_id'] !== 'string' ||
    !UUID_PATTERN.test(row['evidence_fragment_id']) ||
    typeof row['data_item_id'] !== 'string' ||
    !UUID_PATTERN.test(row['data_item_id']) ||
    typeof row['version_id'] !== 'string' ||
    !UUID_PATTERN.test(row['version_id']) ||
    (assetId !== null &&
      assetId !== undefined &&
      (typeof assetId !== 'string' || !UUID_PATTERN.test(assetId))) ||
    !locator.success ||
    typeof row['content_hash'] !== 'string' ||
    !HASH_PATTERN.test(row['content_hash']) ||
    (excerpt !== null &&
      excerpt !== undefined &&
      typeof excerpt !== 'string') ||
    !securityLevel.success ||
    policyVersion === null ||
    rowVersion === null ||
    createdAt === null
  ) {
    throw resourceError('INVALID_RESPONSE');
  }
  return Object.freeze({
    evidenceId: row['evidence_fragment_id'],
    dataItemId: row['data_item_id'],
    versionId: row['version_id'],
    ...(typeof assetId === 'string' ? { assetId } : {}),
    locator: locator.data,
    contentHash: row['content_hash'],
    ...(typeof excerpt === 'string' ? { excerpt } : {}),
    securityLevel: securityLevel.data,
    policyVersion,
    rowVersion,
    createdAt,
  });
}

function referenceHash(kind: string, ...parts: readonly string[]): string {
  return createHash('sha256')
    .update(`${kind}\0${parts.join('\0')}`)
    .digest('hex');
}

async function boundedResponseText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  const declared = response.headers.get('content-length');
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)
  ) {
    throw resourceError('RESPONSE_TOO_LARGE');
  }
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let result = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) {
        throw resourceError('INVALID_RESPONSE');
      }
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) {
        throw resourceError('RESPONSE_TOO_LARGE');
      }
      result += decoder.decode(chunk.value, { stream: true });
    }
    result += decoder.decode();
    return result;
  } finally {
    reader.releaseLock();
  }
}

function safeStacFeature(
  raw: unknown,
  expected: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly collectionId: string;
    readonly itemId: string;
    readonly publicApiOrigin: string;
  },
) {
  const parsed = StacFeatureSchema.safeParse(raw);
  if (!parsed.success) throw resourceError('INVALID_RESPONSE');
  const feature = parsed.data;
  const properties = feature.properties;
  const expectedHref =
    `${expected.publicApiOrigin}/api/data/v1/tenants/${expected.tenantId}` +
    `/projects/${expected.projectId}/versions/${properties.versionId}/assets/source`;
  if (
    feature.collection !== expected.collectionId ||
    feature.id !== expected.itemId ||
    properties.tenantId !== expected.tenantId ||
    properties.projectId !== expected.projectId ||
    feature.assets.source.href !== expectedHref ||
    !feature.assets.source.roles.includes('data') ||
    feature.assets.source['file:checksum'] !== `sha256:${properties.sourceHash}`
  ) {
    throw resourceError('INVALID_RESPONSE');
  }
  return Object.freeze({
    stac_version: feature.stac_version,
    stac_extensions: Object.freeze([...feature.stac_extensions]),
    type: feature.type,
    id: feature.id,
    collection: feature.collection,
    bbox: Object.freeze([...feature.bbox]),
    geometry: feature.geometry,
    properties: Object.freeze({
      ...properties,
      'wiser:tenant_id': properties.tenantId,
      'wiser:project_id': properties.projectId,
      'wiser:data_item_id': properties.dataItemId,
      'wiser:version_id': properties.versionId,
      'wiser:evidence_id': properties.evidenceId,
      'wiser:security_level': properties.securityLevel,
      'wiser:policy_version': properties.policyVersion,
      'wiser:source_hash': properties.sourceHash,
      'wiser:quality_grade': properties.qualityGrade,
    }),
    links: Object.freeze([]),
    assets: Object.freeze({ source: Object.freeze(feature.assets.source) }),
  });
}

export class PostgresDataFoundationResourcePort implements DataFoundationResourcePort {
  readonly #pool: DataFoundationResourcePool;
  readonly #stacBaseUrl: URL;
  readonly #publicApiOrigin: string;
  readonly #authorization: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;

  constructor(options: {
    readonly pool: DataFoundationResourcePool;
    readonly stac: StacResourceOptions;
  }) {
    const timeoutMs = options.stac.timeoutMs ?? 5_000;
    const maxResponseBytes = options.stac.maxResponseBytes ?? 262_144;
    if (
      options.pool === null ||
      typeof options.pool?.connect !== 'function' ||
      !validSecret(options.stac.bearerToken) ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 100 ||
      timeoutMs > 120_000 ||
      !Number.isSafeInteger(maxResponseBytes) ||
      maxResponseBytes < 1_024 ||
      maxResponseBytes > 1_048_576 ||
      typeof (options.stac.fetch ?? globalThis.fetch) !== 'function'
    ) {
      throw resourceError('UNAVAILABLE');
    }
    this.#pool = options.pool;
    this.#stacBaseUrl = rootUrl(options.stac.baseUrl);
    this.#publicApiOrigin = rootUrl(options.stac.publicApiOrigin).origin;
    this.#authorization = `Bearer ${options.stac.bearerToken}`;
    this.#fetch = options.stac.fetch ?? globalThis.fetch;
    this.#timeoutMs = timeoutMs;
    this.#maxResponseBytes = maxResponseBytes;
  }

  async #client(): Promise<ResourceClient> {
    try {
      return await this.#pool.connect();
    } catch (error) {
      throw resourceError('UNAVAILABLE', error);
    }
  }

  async #scope(client: ResourceClient, context: PlatformRequestContext) {
    await client.query(SET_SCOPE_SQL, [
      context.authorization.tenantId,
      context.authorization.projectId,
      context.authorization.maxSecurityLevel,
      String(context.authorization.authzVersion),
    ]);
  }

  async #audit(
    client: ResourceClient,
    input: {
      readonly context: PlatformRequestContext;
      readonly action: 'data.evidence.read' | 'data.stac-item.read';
      readonly resourceType: 'evidence_fragment' | 'stac_item';
      readonly referenceHash: string;
      readonly securityLevel: string;
      readonly policyVersion: number;
    },
  ) {
    await client.query(AUDIT_SQL, [
      input.context.authorization.tenantId,
      input.context.authorization.projectId,
      input.context.principal.actorId,
      input.action,
      input.resourceType,
      input.referenceHash,
      input.context.authorization.purpose,
      input.context.traceId,
      input.securityLevel,
      input.policyVersion,
    ]);
  }

  async readEvidence(input: {
    readonly context: PlatformRequestContext;
    readonly evidenceId: string;
  }): Promise<unknown> {
    const context = PlatformRequestContextSchema.safeParse(input.context);
    if (!context.success || !UUID_PATTERN.test(input.evidenceId)) {
      throw resourceError('NOT_FOUND');
    }
    const client = await this.#client();
    try {
      await client.query('BEGIN');
      await this.#scope(client, context.data);
      const result = await client.query(EVIDENCE_LOOKUP_SQL, [
        context.data.authorization.tenantId,
        context.data.authorization.projectId,
        input.evidenceId,
      ]);
      if (result.rows.length !== 1) throw resourceError('NOT_FOUND');
      const evidence = evidenceRow(result.rows[0]);
      if (evidence.evidenceId !== input.evidenceId) {
        throw resourceError('INVALID_RESPONSE');
      }
      if (Buffer.byteLength(JSON.stringify(evidence)) > 240_000) {
        throw resourceError('RESPONSE_TOO_LARGE');
      }
      const hash = referenceHash('evidence', input.evidenceId);
      await this.#audit(client, {
        context: context.data,
        action: 'data.evidence.read',
        resourceType: 'evidence_fragment',
        referenceHash: hash,
        securityLevel: evidence.securityLevel,
        policyVersion: evidence.policyVersion,
      });
      await client.query('COMMIT');
      return evidence;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The stable resource error remains authoritative.
      }
      if (error instanceof DataFoundationResourceError) throw error;
      throw resourceError('UNAVAILABLE', error);
    } finally {
      client.release();
    }
  }

  async #fetchStacItem(collectionId: string, itemId: string): Promise<unknown> {
    const url = new URL(
      `collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(itemId)}`,
      this.#stacBaseUrl,
    );
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/geo+json, application/json',
          authorization: this.#authorization,
        },
        redirect: 'error',
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      throw resourceError('UNAVAILABLE', error);
    }
    if (response.status === 404) throw resourceError('NOT_FOUND');
    if (!response.ok) throw resourceError('UNAVAILABLE');
    const text = await boundedResponseText(response, this.#maxResponseBytes);
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw resourceError('INVALID_RESPONSE', error);
    }
  }

  async readStacItem(input: {
    readonly context: PlatformRequestContext;
    readonly collectionId: string;
    readonly itemId: string;
  }): Promise<unknown> {
    const context = PlatformRequestContextSchema.safeParse(input.context);
    if (
      !context.success ||
      !COLLECTION_PATTERN.test(input.collectionId) ||
      !ITEM_PATTERN.test(input.itemId) ||
      deterministicStacCollectionId({
        tenantId: context.success
          ? context.data.authorization.tenantId
          : '00000000-0000-4000-8000-000000000000',
        projectId: context.success
          ? context.data.authorization.projectId
          : '00000000-0000-4000-8000-000000000000',
      }) !== input.collectionId
    ) {
      throw resourceError('NOT_FOUND');
    }
    const feature = safeStacFeature(
      await this.#fetchStacItem(input.collectionId, input.itemId),
      {
        tenantId: context.data.authorization.tenantId,
        projectId: context.data.authorization.projectId,
        collectionId: input.collectionId,
        itemId: input.itemId,
        publicApiOrigin: this.#publicApiOrigin,
      },
    );
    const client = await this.#client();
    try {
      await client.query('BEGIN');
      await this.#scope(client, context.data);
      const result = await client.query(STAC_AUTHORIZE_SQL, [
        context.data.authorization.tenantId,
        context.data.authorization.projectId,
        feature.properties.evidenceId,
        feature.properties.versionId,
        feature.properties.dataItemId,
        feature.properties.sourceHash,
      ]);
      if (result.rows.length !== 1) throw resourceError('NOT_FOUND');
      const row = result.rows[0]!;
      const policyVersion = positiveInteger(row['policy_version']);
      const securityLevel = SecurityLevelSchema.safeParse(
        row['security_level'],
      );
      if (
        row['evidence_fragment_id'] !== feature.properties.evidenceId ||
        row['data_item_id'] !== feature.properties.dataItemId ||
        row['version_id'] !== feature.properties.versionId ||
        row['content_hash'] !== feature.properties.sourceHash ||
        row['publication_status'] !== 'PUBLISHED' ||
        row['publication_status'] !== feature.properties.publicationStatus ||
        row['acceptance_status'] !== feature.properties.acceptanceStatus ||
        row['quality_grade'] !== feature.properties.qualityGrade ||
        !securityLevel.success ||
        securityLevel.data !== feature.properties.securityLevel ||
        policyVersion === null ||
        policyVersion !== feature.properties.policyVersion
      ) {
        throw resourceError('INVALID_RESPONSE');
      }
      const hash = referenceHash('stac', input.collectionId, input.itemId);
      await this.#audit(client, {
        context: context.data,
        action: 'data.stac-item.read',
        resourceType: 'stac_item',
        referenceHash: hash,
        securityLevel: securityLevel.data,
        policyVersion,
      });
      await client.query('COMMIT');
      return feature;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The stable resource error remains authoritative.
      }
      if (error instanceof DataFoundationResourceError) throw error;
      throw resourceError('UNAVAILABLE', error);
    } finally {
      client.release();
    }
  }
}
