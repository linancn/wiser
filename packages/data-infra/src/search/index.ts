import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FIELD_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
const DOMAIN_PATTERN = /^[a-z][a-z0-9-]{0,127}$/;
const RRF_K = 60;
const MAX_PAGE_SIZE = 200;
const MAX_CURSOR_OFFSET = 5_000;
const MAX_CANDIDATES = 10_000;

export type SearchBackendName =
  'opensearch' | 'weaviate' | 'neo4j' | 'postgis' | 'pgstac';

export type SearchChannel =
  'catalog' | 'fulltext' | 'semantic' | 'graph' | 'geo' | 'stac';

export type SearchSecurityLevel =
  'L0_PUBLIC' | 'L1_INTERNAL' | 'L2_RESTRICTED' | 'L3_CONFIDENTIAL';

export type SearchQualityGrade = 'A' | 'B' | 'C';
export type SearchAcceptanceStatus = 'PASSED' | 'CONDITIONALLY_PASSED';

export interface SearchExcerptFragment {
  readonly field: string;
  readonly text: string;
}

export interface SearchBackendHit {
  readonly tenantId: string;
  readonly projectId: string;
  readonly dataItemId: string;
  readonly versionId: string;
  readonly evidenceId: string;
  readonly qualityGrade: SearchQualityGrade;
  readonly acceptanceStatus:
    | SearchAcceptanceStatus
    | 'PENDING'
    | 'CORRECTION_REQUIRED'
    | 'ARCHIVED_ONLY'
    | 'REJECTED';
  readonly publicationStatus:
    'UNPUBLISHED' | 'PUBLISHING' | 'PUBLISHED' | 'WITHDRAWN';
  readonly securityLevel: SearchSecurityLevel;
  readonly policyVersion: number;
  readonly excerptFragments?: readonly SearchExcerptFragment[];
  readonly limitations?: readonly string[];
}

export interface SearchBackendRequest {
  readonly query: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly maxSecurityLevel: SearchSecurityLevel;
  readonly maximumPolicyVersion: number;
  readonly versionIds: readonly string[];
  readonly acceptanceStatuses: readonly SearchAcceptanceStatus[];
  readonly publicationStatuses: readonly ['PUBLISHED'];
  readonly businessDomains: readonly string[];
  readonly securityLevels: readonly SearchSecurityLevel[];
  readonly channels: readonly SearchChannel[];
  readonly limit: number;
}

export interface SearchBackendPort {
  readonly source: SearchBackendName;
  readonly search: (
    request: SearchBackendRequest,
  ) => Promise<readonly SearchBackendHit[]>;
}

export type OpenSearchBackendPort = SearchBackendPort;
export type WeaviateBackendPort = SearchBackendPort;
export type Neo4jBackendPort = SearchBackendPort;
export type PostGISBackendPort = SearchBackendPort;
export type PgSTACBackendPort = SearchBackendPort;

export interface SearchResult {
  readonly dataItemId: string;
  readonly versionId: string;
  readonly evidenceId: string;
  readonly source: string;
  readonly score: number;
  readonly qualityGrade: SearchQualityGrade;
  readonly acceptanceStatus: SearchAcceptanceStatus;
  readonly securityLevel: SearchSecurityLevel;
  readonly generatedAt: string;
  readonly limitations: readonly string[];
  readonly excerpt?: string;
}

export interface SearchResultPage {
  readonly items: readonly SearchResult[];
  readonly nextCursor?: string;
}

export interface SearchOrchestratorInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly query: string;
  readonly maxSecurityLevel: SearchSecurityLevel;
  readonly policyVersion: number;
  readonly businessDomains?: readonly string[];
  readonly securityLevels?: readonly SearchSecurityLevel[];
  readonly versionIds?: readonly string[];
  readonly sources?: readonly SearchChannel[];
  readonly allowedExcerptFields?: readonly string[];
  readonly first?: number;
  readonly after?: string;
}

export interface RerankerRequest {
  readonly query: string;
  readonly candidates: readonly SearchResult[];
}

export interface RerankerPort {
  readonly rerank: (request: RerankerRequest) => Promise<readonly unknown[]>;
}

export interface SearchOrchestratorOptions {
  readonly openSearch: OpenSearchBackendPort;
  readonly weaviate: WeaviateBackendPort;
  readonly neo4j: Neo4jBackendPort;
  readonly postgis: PostGISBackendPort;
  readonly pgstac: PgSTACBackendPort;
  readonly reranker?: RerankerPort;
  readonly clock?: () => Date;
}

export type SearchOrchestratorErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_INPUT'
  | 'INVALID_CURSOR'
  | 'INVALID_CLOCK'
  | 'ALL_BACKENDS_FAILED';

const ERROR_MESSAGES: Readonly<Record<SearchOrchestratorErrorCode, string>> = {
  INVALID_CONFIGURATION: 'Search backend configuration is invalid.',
  INVALID_INPUT: 'Search input is invalid.',
  INVALID_CURSOR: 'Search cursor is invalid for this request.',
  INVALID_CLOCK: 'Search clock returned an invalid timestamp.',
  ALL_BACKENDS_FAILED: 'All selected search backends are unavailable.',
};

export class SearchOrchestratorError extends Error {
  constructor(readonly code: SearchOrchestratorErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'SearchOrchestratorError';
  }
}

interface NormalizedInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly query: string;
  readonly maxSecurityLevel: SearchSecurityLevel;
  readonly policyVersion: number;
  readonly businessDomains: readonly string[];
  readonly securityLevels: readonly SearchSecurityLevel[];
  readonly versionIds: readonly string[];
  readonly sources: readonly SearchChannel[];
  readonly allowedExcerptFields: ReadonlySet<string>;
  readonly allowedExcerptFieldList: readonly string[];
  readonly first: number;
  readonly offset: number;
  readonly fingerprint: string;
}

interface BackendDefinition {
  readonly name: SearchBackendName;
  readonly port: SearchBackendPort;
  readonly channels: readonly SearchChannel[];
}

interface SuccessfulBackend {
  readonly source: SearchBackendName;
  readonly hits: readonly SearchBackendHit[];
}

interface AuthorizedSearchBackendHit extends SearchBackendHit {
  readonly acceptanceStatus: SearchAcceptanceStatus;
  readonly publicationStatus: 'PUBLISHED';
}

interface RankedHit {
  readonly source: SearchBackendName;
  readonly rank: number;
  readonly hit: AuthorizedSearchBackendHit;
  readonly excerpt?: string;
  readonly limitations: readonly string[];
}

interface FusedCandidate {
  readonly key: string;
  readonly dataItemId: string;
  readonly versionId: string;
  evidenceId: string;
  readonly sources: Set<SearchBackendName>;
  score: number;
  qualityGrade: SearchQualityGrade;
  acceptanceStatus: SearchAcceptanceStatus;
  securityLevel: SearchSecurityLevel;
  representativeSource: SearchBackendName;
  representativeRank: number;
  excerpt?: string;
  readonly limitations: Set<string>;
}

const SECURITY_RANK: Readonly<Record<SearchSecurityLevel, number>> = {
  L0_PUBLIC: 0,
  L1_INTERNAL: 1,
  L2_RESTRICTED: 2,
  L3_CONFIDENTIAL: 3,
};

const QUALITY_RANK: Readonly<Record<SearchQualityGrade, number>> = {
  A: 0,
  B: 1,
  C: 2,
};

const ALL_SECURITY_LEVELS = Object.freeze([
  'L0_PUBLIC',
  'L1_INTERNAL',
  'L2_RESTRICTED',
  'L3_CONFIDENTIAL',
] as const);

const ALL_CHANNELS = new Set<SearchChannel>([
  'catalog',
  'fulltext',
  'semantic',
  'graph',
  'geo',
  'stac',
]);

function orchestratorError(code: SearchOrchestratorErrorCode) {
  return new SearchOrchestratorError(code);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function validStringArray(
  value: unknown,
  pattern: RegExp,
  maximum: number,
): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    value.every(
      (entry) =>
        typeof entry === 'string' && entry.length > 0 && pattern.test(entry),
    )
  );
}

function validSecurityLevel(value: unknown): value is SearchSecurityLevel {
  return typeof value === 'string' && Object.hasOwn(SECURITY_RANK, value);
}

function validSecurityLevels(
  value: unknown,
): value is readonly SearchSecurityLevel[] {
  return Array.isArray(value) && value.every(validSecurityLevel);
}

function validChannels(value: unknown): value is readonly SearchChannel[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 6 &&
    value.every(
      (channel) =>
        typeof channel === 'string' &&
        ALL_CHANNELS.has(channel as SearchChannel),
    )
  );
}

function fingerprint(input: {
  readonly tenantId: string;
  readonly projectId: string;
  readonly query: string;
  readonly maxSecurityLevel: SearchSecurityLevel;
  readonly policyVersion: number;
  readonly businessDomains: readonly string[];
  readonly securityLevels: readonly SearchSecurityLevel[];
  readonly versionIds: readonly string[];
  readonly sources: readonly SearchChannel[];
  readonly allowedExcerptFields: readonly string[];
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function encodeCursor(offset: number, requestFingerprint: string): string {
  return Buffer.from(
    JSON.stringify({ version: 1, offset, fingerprint: requestFingerprint }),
  ).toString('base64url');
}

function decodeCursor(value: string, expectedFingerprint: string): number {
  if (
    value.length < 1 ||
    value.length > 2_048 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw orchestratorError('INVALID_CURSOR');
  }
  let candidate: unknown;
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) {
      throw orchestratorError('INVALID_CURSOR');
    }
    candidate = JSON.parse(decoded.toString('utf8')) as unknown;
  } catch (error) {
    if (error instanceof SearchOrchestratorError) throw error;
    throw orchestratorError('INVALID_CURSOR');
  }
  if (
    !isRecord(candidate) ||
    candidate['version'] !== 1 ||
    candidate['fingerprint'] !== expectedFingerprint
  ) {
    throw orchestratorError('INVALID_CURSOR');
  }
  const offset = candidate['offset'];
  if (
    typeof offset !== 'number' ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > MAX_CURSOR_OFFSET
  ) {
    throw orchestratorError('INVALID_CURSOR');
  }
  return offset;
}

function normalizeInput(input: SearchOrchestratorInput): NormalizedInput {
  if (
    input === null ||
    typeof input !== 'object' ||
    !UUID_PATTERN.test(input.tenantId) ||
    !UUID_PATTERN.test(input.projectId) ||
    typeof input.query !== 'string' ||
    input.query.length < 1 ||
    input.query.length > 2_048 ||
    !validSecurityLevel(input.maxSecurityLevel) ||
    !Number.isSafeInteger(input.policyVersion) ||
    input.policyVersion < 1 ||
    (input.businessDomains !== undefined &&
      !validStringArray(input.businessDomains, DOMAIN_PATTERN, 64)) ||
    (input.versionIds !== undefined &&
      !validStringArray(input.versionIds, UUID_PATTERN, 256)) ||
    (input.allowedExcerptFields !== undefined &&
      !validStringArray(input.allowedExcerptFields, FIELD_PATTERN, 256)) ||
    (input.securityLevels !== undefined &&
      !validSecurityLevels(input.securityLevels)) ||
    (input.sources !== undefined && !validChannels(input.sources))
  ) {
    throw orchestratorError('INVALID_INPUT');
  }
  const first = input.first ?? 50;
  if (!Number.isSafeInteger(first) || first < 1 || first > MAX_PAGE_SIZE) {
    throw orchestratorError('INVALID_INPUT');
  }
  const businessDomains = uniqueSorted(input.businessDomains ?? []);
  const versionIds = uniqueSorted(input.versionIds ?? []);
  const sources = uniqueSorted(
    input.sources ?? [...ALL_CHANNELS],
  ) as readonly SearchChannel[];
  const allowedExcerptFieldList = uniqueSorted(
    input.allowedExcerptFields ?? [],
  );
  const requestedSecurityLevels = input.securityLevels ?? ALL_SECURITY_LEVELS;
  const securityLevels = uniqueSorted(requestedSecurityLevels).filter(
    (level): level is SearchSecurityLevel =>
      validSecurityLevel(level) &&
      SECURITY_RANK[level] <= SECURITY_RANK[input.maxSecurityLevel],
  );
  const requestFingerprint = fingerprint({
    tenantId: input.tenantId,
    projectId: input.projectId,
    query: input.query,
    maxSecurityLevel: input.maxSecurityLevel,
    policyVersion: input.policyVersion,
    businessDomains,
    securityLevels,
    versionIds,
    sources,
    allowedExcerptFields: allowedExcerptFieldList,
  });
  const offset =
    input.after === undefined
      ? 0
      : decodeCursor(input.after, requestFingerprint);
  return {
    tenantId: input.tenantId,
    projectId: input.projectId,
    query: input.query,
    maxSecurityLevel: input.maxSecurityLevel,
    policyVersion: input.policyVersion,
    businessDomains,
    securityLevels,
    versionIds,
    sources,
    allowedExcerptFields: new Set(allowedExcerptFieldList),
    allowedExcerptFieldList,
    first,
    offset,
    fingerprint: requestFingerprint,
  };
}

function backendDefinitions(
  options: SearchOrchestratorOptions,
  sources: readonly SearchChannel[],
): readonly BackendDefinition[] {
  const selected = new Set(sources);
  const definitions: BackendDefinition[] = [];
  const openSearchChannels = (['catalog', 'fulltext'] as const).filter(
    (channel) => selected.has(channel),
  );
  if (openSearchChannels.length > 0) {
    definitions.push({
      name: 'opensearch',
      port: options.openSearch,
      channels: openSearchChannels,
    });
  }
  for (const definition of [
    { name: 'weaviate', port: options.weaviate, channel: 'semantic' },
    { name: 'neo4j', port: options.neo4j, channel: 'graph' },
    { name: 'postgis', port: options.postgis, channel: 'geo' },
    { name: 'pgstac', port: options.pgstac, channel: 'stac' },
  ] as const) {
    if (selected.has(definition.channel)) {
      definitions.push({
        name: definition.name,
        port: definition.port,
        channels: [definition.channel],
      });
    }
  }
  return definitions;
}

function exactBackendRequest(
  input: NormalizedInput,
  channels: readonly SearchChannel[],
  limit: number,
): SearchBackendRequest {
  return Object.freeze({
    query: input.query,
    tenantId: input.tenantId,
    projectId: input.projectId,
    maxSecurityLevel: input.maxSecurityLevel,
    maximumPolicyVersion: input.policyVersion,
    versionIds: Object.freeze([...input.versionIds]),
    acceptanceStatuses: Object.freeze([
      'PASSED',
      'CONDITIONALLY_PASSED',
    ] as const),
    publicationStatuses: Object.freeze(['PUBLISHED'] as const),
    businessDomains: Object.freeze([...input.businessDomains]),
    securityLevels: Object.freeze([...input.securityLevels]),
    channels: Object.freeze([...channels]),
    limit,
  });
}

function validLimitations(
  value: unknown,
): value is readonly string[] | undefined {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= 64 &&
      value.every(
        (limitation) =>
          typeof limitation === 'string' &&
          limitation.length >= 1 &&
          limitation.length <= 2_048,
      ))
  );
}

function sanitizeExcerpt(
  fragments: readonly SearchExcerptFragment[] | undefined,
  allowedFields: ReadonlySet<string>,
): {
  readonly excerpt?: string;
  readonly limitations: readonly string[];
} | null {
  if (fragments === undefined) return { limitations: [] };
  const candidate: unknown = fragments;
  if (!validExcerptFragments(candidate)) {
    return null;
  }
  const allowed = candidate
    .filter(({ field }) => allowedFields.has(field))
    .map(({ text }) => text)
    .filter((text) => text.length > 0);
  const redacted = uniqueSorted(
    candidate
      .map(({ field }) => field)
      .filter((field) => !allowedFields.has(field)),
  );
  return {
    ...(allowed.length === 0
      ? {}
      : { excerpt: allowed.join(' … ').slice(0, 8192) }),
    limitations:
      redacted.length === 0
        ? []
        : [`excerpt_fields_redacted:${redacted.join(',')}`.slice(0, 2_048)],
  };
}

function validExcerptFragments(
  value: unknown,
): value is readonly SearchExcerptFragment[] {
  return (
    Array.isArray(value) &&
    value.length <= 256 &&
    value.every((entry: unknown) => {
      if (!isRecord(entry)) return false;
      const field = entry['field'];
      const text = entry['text'];
      return (
        typeof field === 'string' &&
        FIELD_PATTERN.test(field) &&
        typeof text === 'string' &&
        text.length <= 8_192
      );
    })
  );
}

function authorizedHit(
  hit: SearchBackendHit,
  input: NormalizedInput,
  source: SearchBackendName,
  rank: number,
): RankedHit | null {
  if (
    hit === null ||
    typeof hit !== 'object' ||
    hit.tenantId !== input.tenantId ||
    hit.projectId !== input.projectId ||
    !UUID_PATTERN.test(hit.dataItemId) ||
    !UUID_PATTERN.test(hit.versionId) ||
    !UUID_PATTERN.test(hit.evidenceId) ||
    !['A', 'B', 'C'].includes(hit.qualityGrade) ||
    (hit.acceptanceStatus !== 'PASSED' &&
      hit.acceptanceStatus !== 'CONDITIONALLY_PASSED') ||
    hit.publicationStatus !== 'PUBLISHED' ||
    !validSecurityLevel(hit.securityLevel) ||
    SECURITY_RANK[hit.securityLevel] > SECURITY_RANK[input.maxSecurityLevel] ||
    !input.securityLevels.includes(hit.securityLevel) ||
    !Number.isSafeInteger(hit.policyVersion) ||
    hit.policyVersion < 1 ||
    hit.policyVersion > input.policyVersion ||
    (input.versionIds.length > 0 &&
      !input.versionIds.includes(hit.versionId)) ||
    !validLimitations(hit.limitations)
  ) {
    return null;
  }
  const excerpt = sanitizeExcerpt(
    hit.excerptFragments,
    input.allowedExcerptFields,
  );
  if (excerpt === null) return null;
  return {
    source,
    rank,
    hit: {
      ...hit,
      acceptanceStatus: hit.acceptanceStatus,
      publicationStatus: hit.publicationStatus,
    },
    ...(excerpt.excerpt === undefined ? {} : { excerpt: excerpt.excerpt }),
    limitations: uniqueSorted([
      ...(hit.limitations ?? []),
      ...excerpt.limitations,
    ]),
  };
}

function candidateKey(dataItemId: string, versionId: string): string {
  return `${dataItemId}:${versionId}`;
}

function representativePrecedes(hit: RankedHit, candidate: FusedCandidate) {
  return (
    hit.rank < candidate.representativeRank ||
    (hit.rank === candidate.representativeRank &&
      hit.source.localeCompare(candidate.representativeSource) < 0)
  );
}

function fuse(
  backends: readonly SuccessfulBackend[],
  input: NormalizedInput,
): FusedCandidate[] {
  const candidates = new Map<string, FusedCandidate>();
  for (const backend of backends) {
    const seen = new Set<string>();
    for (const [index, raw] of backend.hits.entries()) {
      const ranked = authorizedHit(raw, input, backend.source, index + 1);
      if (ranked === null) continue;
      const key = candidateKey(ranked.hit.dataItemId, ranked.hit.versionId);
      if (seen.has(key)) continue;
      seen.add(key);
      const contribution = 1 / (RRF_K + ranked.rank);
      const existing = candidates.get(key);
      if (existing === undefined) {
        candidates.set(key, {
          key,
          dataItemId: ranked.hit.dataItemId,
          versionId: ranked.hit.versionId,
          evidenceId: ranked.hit.evidenceId,
          sources: new Set([ranked.source]),
          score: contribution,
          qualityGrade: ranked.hit.qualityGrade,
          acceptanceStatus: ranked.hit.acceptanceStatus,
          securityLevel: ranked.hit.securityLevel,
          representativeSource: ranked.source,
          representativeRank: ranked.rank,
          ...(ranked.excerpt === undefined ? {} : { excerpt: ranked.excerpt }),
          limitations: new Set(ranked.limitations),
        });
        continue;
      }
      existing.sources.add(ranked.source);
      existing.score += contribution;
      if (
        QUALITY_RANK[ranked.hit.qualityGrade] >
        QUALITY_RANK[existing.qualityGrade]
      ) {
        existing.qualityGrade = ranked.hit.qualityGrade;
      }
      if (ranked.hit.acceptanceStatus === 'CONDITIONALLY_PASSED') {
        existing.acceptanceStatus = 'CONDITIONALLY_PASSED';
      }
      if (
        SECURITY_RANK[ranked.hit.securityLevel] >
        SECURITY_RANK[existing.securityLevel]
      ) {
        existing.securityLevel = ranked.hit.securityLevel;
      }
      for (const limitation of ranked.limitations) {
        existing.limitations.add(limitation);
      }
      if (representativePrecedes(ranked, existing)) {
        existing.evidenceId = ranked.hit.evidenceId;
        existing.representativeSource = ranked.source;
        existing.representativeRank = ranked.rank;
        if (ranked.excerpt === undefined) {
          delete existing.excerpt;
        } else {
          existing.excerpt = ranked.excerpt;
        }
      }
    }
  }
  return [...candidates.values()];
}

function stableCompare(left: FusedCandidate, right: FusedCandidate): number {
  if (left.score !== right.score) return right.score - left.score;
  return (
    left.dataItemId.localeCompare(right.dataItemId) ||
    left.versionId.localeCompare(right.versionId) ||
    left.evidenceId.localeCompare(right.evidenceId) ||
    [...left.sources]
      .sort()
      .join('+')
      .localeCompare([...right.sources].sort().join('+'))
  );
}

function toResult(
  candidate: FusedCandidate,
  generatedAt: string,
  sharedLimitations: readonly string[],
): SearchResult {
  const limitations = uniqueSorted([
    ...candidate.limitations,
    ...sharedLimitations,
  ]).slice(0, 64);
  return {
    dataItemId: candidate.dataItemId,
    versionId: candidate.versionId,
    evidenceId: candidate.evidenceId,
    source: [...candidate.sources].sort().join('+'),
    score: candidate.score,
    qualityGrade: candidate.qualityGrade,
    acceptanceStatus: candidate.acceptanceStatus,
    securityLevel: candidate.securityLevel,
    generatedAt,
    limitations,
    ...(candidate.excerpt === undefined ? {} : { excerpt: candidate.excerpt }),
  };
}

function rerankerKey(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const dataItemId = value['dataItemId'];
  const versionId = value['versionId'];
  return typeof dataItemId === 'string' &&
    typeof versionId === 'string' &&
    UUID_PATTERN.test(dataItemId) &&
    UUID_PATTERN.test(versionId)
    ? candidateKey(dataItemId, versionId)
    : null;
}

export class SearchOrchestrator {
  readonly #options: SearchOrchestratorOptions;
  readonly #clock: () => Date;

  constructor(options: SearchOrchestratorOptions) {
    const expected: readonly [SearchBackendName, SearchBackendPort][] = [
      ['opensearch', options.openSearch],
      ['weaviate', options.weaviate],
      ['neo4j', options.neo4j],
      ['postgis', options.postgis],
      ['pgstac', options.pgstac],
    ];
    if (
      expected.some(
        ([source, port]) =>
          port === null ||
          typeof port !== 'object' ||
          port.source !== source ||
          typeof port.search !== 'function',
      ) ||
      (options.reranker !== undefined &&
        typeof options.reranker.rerank !== 'function')
    ) {
      throw orchestratorError('INVALID_CONFIGURATION');
    }
    this.#options = options;
    this.#clock = options.clock ?? (() => new Date());
  }

  async search(rawInput: SearchOrchestratorInput): Promise<SearchResultPage> {
    const input = normalizeInput(rawInput);
    const now = this.#clock();
    if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) {
      throw orchestratorError('INVALID_CLOCK');
    }
    const generatedAt = now.toISOString();
    const definitions = backendDefinitions(this.#options, input.sources);
    const limit = Math.min(MAX_CANDIDATES, input.offset + input.first + 100);
    const settled = await Promise.allSettled(
      definitions.map(async (definition) => ({
        source: definition.name,
        hits: await definition.port.search(
          exactBackendRequest(input, definition.channels, limit),
        ),
      })),
    );
    const successes: SuccessfulBackend[] = [];
    const failures: SearchBackendName[] = [];
    for (const [index, result] of settled.entries()) {
      const definition = definitions[index];
      if (definition === undefined) continue;
      if (result.status === 'fulfilled' && Array.isArray(result.value.hits)) {
        successes.push({
          source: result.value.source,
          hits: result.value.hits.slice(0, limit),
        });
      } else {
        failures.push(definition.name);
      }
    }
    if (successes.length === 0) {
      throw orchestratorError('ALL_BACKENDS_FAILED');
    }

    const candidates = fuse(successes, input).sort(stableCompare);
    const sharedLimitations = failures
      .sort()
      .map((source) => `backend_unavailable:${source}`);
    let rerankerUnavailable = false;
    if (this.#options.reranker !== undefined && candidates.length > 0) {
      const safeCandidates = candidates.map((candidate) =>
        toResult(candidate, generatedAt, sharedLimitations),
      );
      try {
        const selections = await this.#options.reranker.rerank({
          query: input.query,
          candidates: safeCandidates,
        });
        const rank = new Map<string, number>();
        for (const selection of selections) {
          const key = rerankerKey(selection);
          if (key !== null && !rank.has(key)) rank.set(key, rank.size);
        }
        candidates.sort((left, right) => {
          const leftRank = rank.get(left.key);
          const rightRank = rank.get(right.key);
          if (leftRank !== undefined || rightRank !== undefined) {
            if (leftRank === undefined) return 1;
            if (rightRank === undefined) return -1;
            if (leftRank !== rightRank) return leftRank - rightRank;
          }
          return stableCompare(left, right);
        });
      } catch {
        rerankerUnavailable = true;
      }
    }
    if (rerankerUnavailable) sharedLimitations.push('reranker_unavailable');

    const pageEnd = input.offset + input.first;
    const items = candidates
      .slice(input.offset, pageEnd)
      .map((candidate) => toResult(candidate, generatedAt, sharedLimitations));
    const saturated = successes.some(({ hits }) => hits.length >= limit);
    const hasMore =
      pageEnd <= MAX_CURSOR_OFFSET &&
      (candidates.length > pageEnd ||
        (items.length === input.first && saturated));
    return {
      items,
      ...(hasMore
        ? { nextCursor: encodeCursor(pageEnd, input.fingerprint) }
        : {}),
    };
  }
}
