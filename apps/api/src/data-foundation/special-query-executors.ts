import {
  DATA_CAPABILITY_REGISTRY,
  type DataCapabilityId,
  type SecurityLevel,
} from '@wiser/data-contracts';

import type {
  DataCapabilityExecutionContext,
  DataCapabilityExecutor,
} from './capability-handler.js';

const SPECIAL_IDS = Object.freeze([
  'data.query',
  'data.search.federated',
  'data.knowledge.search',
  'data.graph.expand',
  'data.graph.findPath',
  'data.geo.query',
  'data.geo.intersect',
] as const satisfies readonly DataCapabilityId[]);

const EXCERPT_FIELDS = Object.freeze([
  'content',
  'description',
  'excerpt',
  'title',
]);

const SECURITY_RANK: Readonly<Record<SecurityLevel, number>> = {
  L0_PUBLIC: 0,
  L1_INTERNAL: 1,
  L2_RESTRICTED: 2,
  L3_CONFIDENTIAL: 3,
};

export interface SpecialQueryScope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly maxSecurityLevel: SecurityLevel;
  readonly maximumPolicyVersion: number;
}

export interface ScopedSpecialQueryRequest {
  readonly scope: SpecialQueryScope;
  readonly input: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
}

export interface DataStructuredQueryPort {
  query(request: ScopedSpecialQueryRequest): Promise<unknown>;
}

export interface GraphQueryPort {
  expand(request: ScopedSpecialQueryRequest): Promise<unknown>;
  findPath(request: ScopedSpecialQueryRequest): Promise<unknown>;
}

export interface GeoQueryPort {
  query(request: ScopedSpecialQueryRequest): Promise<unknown>;
  intersect(request: ScopedSpecialQueryRequest): Promise<unknown>;
}

export interface SpecialSearchOrchestrator {
  search(request: unknown): Promise<unknown>;
}

export interface SpecialQueryExecutorOptions {
  readonly search: SpecialSearchOrchestrator;
  readonly data: DataStructuredQueryPort;
  readonly graph: GraphQueryPort;
  readonly geo: GeoQueryPort;
}

export type SpecialQueryExecutorErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_INPUT'
  | 'BACKEND_UNAVAILABLE'
  | 'INVALID_BACKEND_RESULT'
  | 'UNAUTHORIZED_BACKEND_RESULT';

const MESSAGES: Readonly<Record<SpecialQueryExecutorErrorCode, string>> = {
  INVALID_CONFIGURATION: 'Special query executor configuration is invalid.',
  INVALID_INPUT: 'Special query input is invalid.',
  BACKEND_UNAVAILABLE: 'The specialized query backend is unavailable.',
  INVALID_BACKEND_RESULT:
    'The specialized query backend returned an invalid result.',
  UNAUTHORIZED_BACKEND_RESULT:
    'The specialized query backend returned data outside the authorization ceiling.',
};

export class SpecialQueryExecutorError extends Error {
  constructor(readonly code: SpecialQueryExecutorErrorCode) {
    super(MESSAGES[code]);
    this.name = 'SpecialQueryExecutorError';
  }
}

interface ValidatedGraphOutput {
  readonly nodes: readonly { readonly securityLevel: SecurityLevel }[];
}

interface ValidatedSearchPage {
  readonly items: readonly {
    readonly dataItemId: string;
    readonly score: number;
    readonly securityLevel: SecurityLevel;
  }[];
  readonly nextCursor?: string;
}

function executorError(code: SpecialQueryExecutorErrorCode) {
  return new SpecialQueryExecutorError(code);
}

function validatedSearchPage(
  output: unknown,
  maximum: SecurityLevel,
): ValidatedSearchPage {
  const parsed =
    DATA_CAPABILITY_REGISTRY['data.search.federated'].outputSchema.safeParse(
      output,
    );
  if (!parsed.success) throw executorError('INVALID_BACKEND_RESULT');
  const page = parsed.data as ValidatedSearchPage;
  if (
    page.items.some(
      (item) => SECURITY_RANK[item.securityLevel] > SECURITY_RANK[maximum],
    )
  ) {
    throw executorError('UNAUTHORIZED_BACKEND_RESULT');
  }
  return page;
}

function scope(context: DataCapabilityExecutionContext): SpecialQueryScope {
  return Object.freeze({
    tenantId: context.authorization.tenantId,
    projectId: context.authorization.projectId,
    maxSecurityLevel: context.effectiveMaxSecurityLevel,
    maximumPolicyVersion: context.authorization.authzVersion,
  });
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw executorError('INVALID_INPUT');
  }
  return Object.freeze(structuredClone(value) as Record<string, unknown>);
}

function request(
  input: unknown,
  context: DataCapabilityExecutionContext,
): ScopedSpecialQueryRequest {
  return Object.freeze({
    scope: scope(context),
    input: record(input),
    signal: context.signal,
  });
}

function validateGraphSecurity(output: unknown, maximum: SecurityLevel): void {
  const parsed =
    DATA_CAPABILITY_REGISTRY['data.graph.expand'].outputSchema.safeParse(
      output,
    );
  if (!parsed.success) throw executorError('INVALID_BACKEND_RESULT');
  const graph = parsed.data as ValidatedGraphOutput;
  if (
    graph.nodes.some(
      (node) => SECURITY_RANK[node.securityLevel] > SECURITY_RANK[maximum],
    )
  ) {
    throw executorError('UNAUTHORIZED_BACKEND_RESULT');
  }
}

function define(
  id: (typeof SPECIAL_IDS)[number],
  run: (
    input: Readonly<Record<string, unknown>>,
    context: DataCapabilityExecutionContext,
  ) => Promise<unknown>,
): DataCapabilityExecutor {
  return Object.freeze({
    id,
    async execute(
      rawInput: unknown,
      context: DataCapabilityExecutionContext,
    ): Promise<unknown> {
      const input =
        DATA_CAPABILITY_REGISTRY[id].inputSchema.safeParse(rawInput);
      if (!input.success) throw executorError('INVALID_INPUT');
      let output: unknown;
      try {
        output = await run(record(input.data), context);
      } catch (error) {
        if (error instanceof SpecialQueryExecutorError) throw error;
        throw executorError('BACKEND_UNAVAILABLE');
      }
      const parsed =
        DATA_CAPABILITY_REGISTRY[id].outputSchema.safeParse(output);
      if (!parsed.success) throw executorError('INVALID_BACKEND_RESULT');
      return parsed.data;
    },
  });
}

function assertOptions(options: SpecialQueryExecutorOptions): void {
  if (
    options.search === null ||
    typeof options.search?.search !== 'function' ||
    options.data === null ||
    typeof options.data?.query !== 'function' ||
    options.graph === null ||
    typeof options.graph?.expand !== 'function' ||
    typeof options.graph?.findPath !== 'function' ||
    options.geo === null ||
    typeof options.geo?.query !== 'function' ||
    typeof options.geo?.intersect !== 'function'
  ) {
    throw executorError('INVALID_CONFIGURATION');
  }
}

export function createSpecialQueryExecutors(
  options: SpecialQueryExecutorOptions,
): readonly DataCapabilityExecutor[] {
  assertOptions(options);

  return Object.freeze([
    define('data.query', (input, context) =>
      options.data.query(request(input, context)),
    ),
    define('data.search.federated', async (input, context) => {
      const output = await options.search.search({
        tenantId: context.authorization.tenantId,
        projectId: context.authorization.projectId,
        query: input.query,
        maxSecurityLevel: context.effectiveMaxSecurityLevel,
        policyVersion: context.authorization.authzVersion,
        businessDomains: input.businessDomains,
        securityLevels: input.securityLevels,
        sources: input.sources,
        allowedExcerptFields: EXCERPT_FIELDS,
        first: input.first,
        after: input.after,
      });
      validatedSearchPage(output, context.effectiveMaxSecurityLevel);
      return output;
    }),
    define('data.knowledge.search', async (input, context) => {
      const raw = await options.search.search({
        tenantId: context.authorization.tenantId,
        projectId: context.authorization.projectId,
        query: input.query,
        maxSecurityLevel: context.effectiveMaxSecurityLevel,
        policyVersion: context.authorization.authzVersion,
        sources: ['semantic'],
        allowedExcerptFields: EXCERPT_FIELDS,
        first: input.first,
        after: input.after,
      });
      const validatedPage = validatedSearchPage(
        raw,
        context.effectiveMaxSecurityLevel,
      );
      const dataItemIds = new Set(
        Array.isArray(input.dataItemIds)
          ? (input.dataItemIds as readonly string[])
          : [],
      );
      const minimumConfidence =
        typeof input.minimumConfidence === 'number'
          ? input.minimumConfidence
          : 0;
      return {
        items: validatedPage.items.filter(
          (item) =>
            (dataItemIds.size === 0 || dataItemIds.has(item.dataItemId)) &&
            item.score >= minimumConfidence,
        ),
        ...(validatedPage.nextCursor === undefined
          ? {}
          : { nextCursor: validatedPage.nextCursor }),
      };
    }),
    define('data.graph.expand', async (input, context) => {
      const output = await options.graph.expand(request(input, context));
      validateGraphSecurity(output, context.effectiveMaxSecurityLevel);
      return output;
    }),
    define('data.graph.findPath', async (input, context) => {
      const output = await options.graph.findPath(request(input, context));
      validateGraphSecurity(output, context.effectiveMaxSecurityLevel);
      return output;
    }),
    define('data.geo.query', (input, context) =>
      options.geo.query(request(input, context)),
    ),
    define('data.geo.intersect', (input, context) =>
      options.geo.intersect(request(input, context)),
    ),
  ]);
}
