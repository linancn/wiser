import { createHash } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  GraphQLError,
  GraphQLScalarType,
  Kind,
  NoSchemaIntrospectionCustomRule,
  OperationTypeNode,
  type ASTVisitor,
  type FieldNode,
  type ValidationContext,
  type ValidationRule,
  type ValueNode,
} from 'graphql';
import mercurius, { type IResolvers } from 'mercurius';

import type { DataCapabilityId } from '@wiser/data-contracts';
import {
  PlatformRequestContextSchema,
  type PlatformRequestContext,
} from '@wiser/platform-contracts';

import type {
  DataFoundationRequestContextResolver,
  DataFoundationRestCapabilityHandler,
} from './rest-module.js';
import type { WiserApiModule } from '../platform/modules.js';

export const DATA_FOUNDATION_GRAPHQL_SCHEMA = String.raw`
scalar JSON

type PageInfo {
  endCursor: String
  hasNextPage: Boolean!
}
type DataItemVersion {
  versionId: ID!
  version: Int
  sourceHash: String
}
type DataItem {
  dataItemId: ID!
  name: String!
  securityLevel: String!
  sourceOrganization: String
  selectedVersion: DataItemVersion
}
type DataItemConnection {
  nodes: [DataItem!]!
  pageInfo: PageInfo!
}
type DataItemVersionConnection {
  nodes: [DataItemVersion!]!
  pageInfo: PageInfo!
}
type SearchResultConnection {
  items: [JSON!]!
  nextCursor: String
}
type GraphResult {
  nodes: [JSON!]!
  edges: [JSON!]!
  nextCursor: String
}
type GeoQueryResult {
  features: [JSON!]!
  nextCursor: String
}
type Operation {
  operationId: ID!
  status: String
  progressPercent: Int
  version: Int!
  capabilityId: String
}

input DataCatalogFilter {
  query: String
  businessDomains: [String!]
}
input DataSearchInput {
  query: String!
  first: Int
  after: String
}
input KnowledgeSearchInput {
  query: String!
  first: Int
  after: String
}
input GraphExpandInput {
  entityId: ID!
  maxDepth: Int!
  first: Int
  after: String
}
input GeoQueryInput {
  geometry: JSON!
  predicates: [String!]!
  first: Int
  after: String
}
input CreateIngestionInput {
  assetIds: [ID!]!
  ownerProjectId: ID!
  intendedUses: [String!]!
  requestedSecurityLevel: String!
}
input ApprovalInput {
  expectedVersion: Int!
  reviewNote: String
  conditions: [String!]
}

type Query {
  dataCatalog(
    filter: DataCatalogFilter
    first: Int
    after: String
  ): DataItemConnection!
  dataItem(id: ID!, version: ID): DataItem
  dataQuery(input: JSON!): JSON!
  dataSearch(input: DataSearchInput!): SearchResultConnection!
  knowledgeSearch(input: KnowledgeSearchInput!): SearchResultConnection!
  graphExpand(input: GraphExpandInput!): GraphResult!
  graphFindPath(input: JSON!): GraphResult!
  geoQuery(input: GeoQueryInput!): GeoQueryResult!
  geoIntersect(input: JSON!): GeoQueryResult!
  dataOperation(id: ID!): Operation
  dataItemVersions(
    id: ID!
    first: Int
    after: String
  ): DataItemVersionConnection!
  dataItemVersion(id: ID!, version: ID!): DataItemVersion
  dataIngestion(id: ID!): JSON
  dataOperationEvents(id: ID!, first: Int, after: String): JSON!
}

type Mutation {
  createDataIngestion(input: CreateIngestionInput!): Operation!
  createDataItem(input: JSON!): DataItem!
  createDataUploadSession(input: JSON!): JSON!
  completeDataUploadSession(id: ID!, input: JSON!): JSON!
  submitDataIngestion(id: ID!): Operation!
  approveDataIngestion(id: ID!, input: ApprovalInput!): Operation!
  rejectDataIngestion(id: ID!, input: JSON!): JSON!
  cancelDataOperation(id: ID!): Operation!
}`;

export const GRAPHQL_CAPABILITY_BY_FIELD: Readonly<
  Record<string, DataCapabilityId>
> = Object.freeze({
  dataCatalog: 'data.catalog.search',
  dataItem: 'data.catalog.get',
  dataQuery: 'data.query',
  dataSearch: 'data.search.federated',
  knowledgeSearch: 'data.knowledge.search',
  graphExpand: 'data.graph.expand',
  graphFindPath: 'data.graph.findPath',
  geoQuery: 'data.geo.query',
  geoIntersect: 'data.geo.intersect',
  dataOperation: 'data.operation.get',
  dataItemVersions: 'data.catalog.versions.list',
  dataItemVersion: 'data.catalog.versions.get',
  dataIngestion: 'data.ingestion.get',
  dataOperationEvents: 'data.operation.events',
  createDataIngestion: 'data.ingestion.create',
  createDataItem: 'data.catalog.create',
  createDataUploadSession: 'data.uploadSession.create',
  completeDataUploadSession: 'data.uploadSession.complete',
  submitDataIngestion: 'data.ingestion.submit',
  approveDataIngestion: 'data.ingestion.approve',
  rejectDataIngestion: 'data.ingestion.reject',
  cancelDataOperation: 'data.operation.cancel',
});

export type DataFoundationGraphqlCapabilityHandler =
  DataFoundationRestCapabilityHandler;

export interface DataFoundationGraphqlModuleOptions {
  readonly resolver: DataFoundationRequestContextResolver;
  readonly handler: DataFoundationGraphqlCapabilityHandler;
  readonly production?: boolean;
  readonly queryDepth?: number;
  readonly maxComplexity?: number;
  readonly queryTimeoutMs?: number;
}

interface GraphqlContext {
  readonly requestContext: PlatformRequestContext;
  readonly handler: DataFoundationGraphqlCapabilityHandler;
  readonly idempotencyKey: string | undefined;
  readonly loader: CapabilityLoader;
  readonly signal: AbortSignal;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function jsonValue(node: ValueNode): unknown {
  switch (node.kind) {
    case Kind.NULL:
      return null;
    case Kind.BOOLEAN:
    case Kind.STRING:
      return node.value;
    case Kind.INT:
    case Kind.FLOAT:
      return Number(node.value);
    case Kind.LIST:
      return node.values.map(jsonValue);
    case Kind.OBJECT:
      return Object.fromEntries(
        node.fields.map((field) => [field.name.value, jsonValue(field.value)]),
      );
    case Kind.ENUM:
      return node.value;
    case Kind.VARIABLE:
      return undefined;
  }
}

const JsonScalar = new GraphQLScalarType({
  name: 'JSON',
  serialize: (value) => value,
  parseValue: (value) => value,
  parseLiteral: jsonValue,
});

function compact(value: Readonly<Record<string, unknown>>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

class CapabilityLoader {
  readonly #handler: DataFoundationGraphqlCapabilityHandler;
  readonly #requestContext: PlatformRequestContext;
  readonly #signal: AbortSignal;
  readonly #cache = new Map<string, Promise<unknown>>();

  constructor(
    handler: DataFoundationGraphqlCapabilityHandler,
    requestContext: PlatformRequestContext,
    signal: AbortSignal,
  ) {
    this.#handler = handler;
    this.#requestContext = requestContext;
    this.#signal = signal;
  }

  load(capabilityId: DataCapabilityId, input: unknown): Promise<unknown> {
    if (this.#signal.aborted)
      return Promise.reject(new GraphQLError('Request timed out.'));
    const key = `${capabilityId}:${JSON.stringify(input)}`;
    const cached = this.#cache.get(key);
    if (cached !== undefined) return cached;
    const work = this.#handler.execute({
      capabilityId,
      input,
      requestContext: this.#requestContext,
    });
    this.#cache.set(key, work);
    return work;
  }
}

function complexityRule(maximum: number): ValidationRule {
  return (context: ValidationContext): ASTVisitor => {
    let complexity = 0;
    let reported = false;
    return {
      Field(node: FieldNode) {
        const weight = [
          'dataSearch',
          'knowledgeSearch',
          'graphExpand',
          'geoQuery',
        ].includes(node.name.value)
          ? 5
          : 1;
        const first = node.arguments?.find(
          (argument) => argument.name.value === 'first',
        )?.value;
        const multiplier =
          first?.kind === Kind.INT ? Math.min(Number(first.value), 100) : 1;
        complexity += weight * multiplier;
        if (complexity > maximum && !reported) {
          reported = true;
          context.reportError(
            new GraphQLError('GraphQL query exceeds the complexity limit.'),
          );
        }
      },
    };
  };
}

function singleMutationRule(context: ValidationContext): ASTVisitor {
  return {
    OperationDefinition(node) {
      if (
        node.operation === OperationTypeNode.MUTATION &&
        node.selectionSet.selections.length > 1
      ) {
        context.reportError(
          new GraphQLError(
            'A GraphQL HTTP request may execute only one mutation field.',
          ),
        );
      }
    },
  };
}

function traceId(request: FastifyRequest): string {
  return createHash('sha256').update(request.id).digest('hex').slice(0, 32);
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

async function resolveRequestContext(
  request: FastifyRequest,
  resolver: DataFoundationRequestContextResolver,
) {
  const token = /^Bearer ([^\s]+)$/.exec(
    header(request, 'authorization') ?? '',
  )?.[1];
  const tenantId = header(request, 'x-wiser-tenant-id');
  const projectId = header(request, 'x-wiser-project-id');
  const purpose = header(request, 'x-wiser-purpose');
  if (
    token === undefined ||
    tenantId === undefined ||
    projectId === undefined ||
    purpose === undefined
  )
    return null;
  try {
    const context = await resolver.resolve({
      token,
      tenantId,
      projectId,
      purpose,
      traceId: traceId(request),
    });
    const parsed = PlatformRequestContextSchema.safeParse(context);
    return parsed.success &&
      parsed.data.authorization.tenantId === tenantId &&
      parsed.data.authorization.projectId === projectId
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}

function setNoStore(reply: FastifyReply): void {
  reply.header(
    'Cache-Control',
    'private, no-cache, no-store, max-age=0, must-revalidate',
  );
  reply.header('Pragma', 'no-cache');
  reply.header('Expires', '0');
}

async function executeQuery(
  context: GraphqlContext,
  capabilityId: DataCapabilityId,
  input: unknown,
) {
  return context.loader.load(capabilityId, input);
}

async function executeCommand(
  context: GraphqlContext,
  capabilityId: DataCapabilityId,
  input: unknown,
) {
  const idempotencyKey = context.idempotencyKey;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      idempotencyKey ?? '',
    )
  ) {
    throw new GraphQLError('Mutation requires an Idempotency-Key.', {
      extensions: { code: 'IDEMPOTENCY_KEY_REQUIRED' },
    });
  }
  return context.handler.execute({
    capabilityId,
    input,
    requestContext: context.requestContext,
    idempotencyKey: idempotencyKey!,
  });
}

function operationFrom(value: unknown): unknown {
  return record(value)['operation'] ?? value;
}

function connectionFrom(value: unknown) {
  const output = record(value);
  const nodes = Array.isArray(output['items']) ? output['items'] : [];
  const endCursor =
    typeof output['nextCursor'] === 'string' ? output['nextCursor'] : null;
  return {
    nodes,
    pageInfo: { endCursor, hasNextPage: endCursor !== null },
  };
}

const resolvers = {
  JSON: JsonScalar,
  Query: {
    dataCatalog: async (
      _: unknown,
      args: {
        filter?: Record<string, unknown>;
        first?: number;
        after?: string;
      },
      context: GraphqlContext,
    ) => {
      const output = record(
        await executeQuery(
          context,
          'data.catalog.search',
          compact({
            ...(args.filter ?? {}),
            first: args.first,
            after: args.after,
          }),
        ),
      );
      const items = Array.isArray(output['items']) ? output['items'] : [];
      const nextCursor =
        typeof output['nextCursor'] === 'string' ? output['nextCursor'] : null;
      return {
        nodes: items,
        pageInfo: { endCursor: nextCursor, hasNextPage: nextCursor !== null },
      };
    },
    dataItem: async (
      _: unknown,
      args: { id: string; version?: string },
      context: GraphqlContext,
    ) => {
      const output = record(
        await executeQuery(
          context,
          'data.catalog.get',
          compact({ dataItemId: args.id, versionId: args.version }),
        ),
      );
      const item = record(output['item']);
      return Object.keys(item).length === 0
        ? null
        : { ...item, __selectedVersion: output['selectedVersion'] };
    },
    dataQuery: (
      _: unknown,
      args: { input: unknown },
      context: GraphqlContext,
    ) => executeQuery(context, 'data.query', args.input),
    dataSearch: (
      _: unknown,
      args: { input: unknown },
      context: GraphqlContext,
    ) => executeQuery(context, 'data.search.federated', args.input),
    knowledgeSearch: (
      _: unknown,
      args: { input: unknown },
      context: GraphqlContext,
    ) => executeQuery(context, 'data.knowledge.search', args.input),
    graphExpand: (
      _: unknown,
      args: { input: unknown },
      context: GraphqlContext,
    ) => executeQuery(context, 'data.graph.expand', args.input),
    graphFindPath: (
      _: unknown,
      args: { input: unknown },
      context: GraphqlContext,
    ) => executeQuery(context, 'data.graph.findPath', args.input),
    geoQuery: (_: unknown, args: { input: unknown }, context: GraphqlContext) =>
      executeQuery(context, 'data.geo.query', args.input),
    geoIntersect: (
      _: unknown,
      args: { input: unknown },
      context: GraphqlContext,
    ) => executeQuery(context, 'data.geo.intersect', args.input),
    dataOperation: (
      _: unknown,
      args: { id: string },
      context: GraphqlContext,
    ) => executeQuery(context, 'data.operation.get', { operationId: args.id }),
    dataItemVersions: async (
      _: unknown,
      args: { id: string; first?: number; after?: string },
      context: GraphqlContext,
    ) =>
      connectionFrom(
        await executeQuery(
          context,
          'data.catalog.versions.list',
          compact({
            dataItemId: args.id,
            first: args.first,
            after: args.after,
          }),
        ),
      ),
    dataItemVersion: async (
      _: unknown,
      args: { id: string; version: string },
      context: GraphqlContext,
    ) =>
      record(
        await executeQuery(context, 'data.catalog.versions.get', {
          dataItemId: args.id,
          versionId: args.version,
        }),
      )['version'] ?? null,
    dataIngestion: async (
      _: unknown,
      args: { id: string },
      context: GraphqlContext,
    ) =>
      record(
        await executeQuery(context, 'data.ingestion.get', {
          ingestionId: args.id,
        }),
      )['ingestion'] ?? null,
    dataOperationEvents: (
      _: unknown,
      args: { id: string; first?: number; after?: string },
      context: GraphqlContext,
    ) =>
      executeQuery(
        context,
        'data.operation.events',
        compact({
          operationId: args.id,
          first: args.first,
          after: args.after,
        }),
      ),
  },
  Mutation: {
    createDataIngestion: async (
      _: unknown,
      args: { input: unknown },
      context: GraphqlContext,
    ) =>
      operationFrom(
        await executeCommand(context, 'data.ingestion.create', args.input),
      ),
    createDataItem: async (
      _: unknown,
      args: { input: unknown },
      context: GraphqlContext,
    ) =>
      record(await executeCommand(context, 'data.catalog.create', args.input))[
        'item'
      ],
    createDataUploadSession: (
      _: unknown,
      args: { input: unknown },
      context: GraphqlContext,
    ) => executeCommand(context, 'data.uploadSession.create', args.input),
    completeDataUploadSession: (
      _: unknown,
      args: { id: string; input: Record<string, unknown> },
      context: GraphqlContext,
    ) =>
      executeCommand(context, 'data.uploadSession.complete', {
        uploadSessionId: args.id,
        ...args.input,
      }),
    submitDataIngestion: async (
      _: unknown,
      args: { id: string },
      context: GraphqlContext,
    ) => {
      const current = record(
        await executeQuery(context, 'data.ingestion.get', {
          ingestionId: args.id,
        }),
      );
      const version = record(current['ingestion'])['version'];
      return operationFrom(
        await executeCommand(context, 'data.ingestion.submit', {
          ingestionId: args.id,
          expectedVersion: version,
        }),
      );
    },
    approveDataIngestion: async (
      _: unknown,
      args: { id: string; input: Record<string, unknown> },
      context: GraphqlContext,
    ) =>
      operationFrom(
        await executeCommand(context, 'data.ingestion.approve', {
          ingestionId: args.id,
          ...args.input,
        }),
      ),
    rejectDataIngestion: (
      _: unknown,
      args: { id: string; input: Record<string, unknown> },
      context: GraphqlContext,
    ) =>
      executeCommand(context, 'data.ingestion.reject', {
        ingestionId: args.id,
        ...args.input,
      }),
    cancelDataOperation: async (
      _: unknown,
      args: { id: string },
      context: GraphqlContext,
    ) => {
      const current = record(
        await executeQuery(context, 'data.operation.get', {
          operationId: args.id,
        }),
      );
      return executeCommand(context, 'data.operation.cancel', {
        operationId: args.id,
        expectedVersion: current['version'],
      });
    },
  },
  DataItem: {
    sourceOrganization: (
      item: Record<string, unknown>,
      _: unknown,
      context: GraphqlContext,
    ) =>
      context.requestContext.authorization.scopes.includes(
        'data.catalog.sensitive.read',
      )
        ? (item['sourceOrganization'] ?? null)
        : null,
  },
};

export const GRAPHQL_RESOLVER_FIELDS = Object.freeze({
  query: Object.freeze(Object.keys(resolvers.Query)),
  mutation: Object.freeze(Object.keys(resolvers.Mutation)),
});

export function createDataFoundationGraphqlModule(
  options: DataFoundationGraphqlModuleOptions,
): WiserApiModule {
  const queryDepth = options.queryDepth ?? 8;
  const maxComplexity = options.maxComplexity ?? 500;
  const timeoutMs = options.queryTimeoutMs ?? 30_000;
  return {
    id: 'data.foundation.graphql',
    register(app) {
      void app.register(mercurius, {
        schema: DATA_FOUNDATION_GRAPHQL_SCHEMA,
        resolvers: resolvers as unknown as IResolvers,
        loaders: {
          DataItem: {
            selectedVersion: (
              queries: readonly { obj: Record<string, unknown> }[],
            ) =>
              Promise.resolve(
                queries.map(({ obj }) => obj['__selectedVersion'] ?? null),
              ),
          },
        },
        routes: false,
        graphiql: false,
        subscription: false,
        queryDepth,
        allowBatchedQueries: false,
        validationRules: [
          complexityRule(maxComplexity),
          singleMutationRule,
          ...(options.production === true
            ? [NoSchemaIntrospectionCustomRule]
            : []),
        ],
      });
      app.post('/graphql', async (request, reply) => {
        setNoStore(reply);
        const body = record(request.body);
        const query = body['query'];
        const variables = record(body['variables']);
        const operationName =
          typeof body['operationName'] === 'string'
            ? body['operationName']
            : undefined;
        if (
          typeof query !== 'string' ||
          query.length === 0 ||
          query.length > 100_000
        )
          return reply
            .status(400)
            .send({ errors: [{ message: 'Invalid GraphQL request.' }] });
        const context = await resolveRequestContext(request, options.resolver);
        if (context === null)
          return reply.status(401).send({
            errors: [
              {
                message: 'Authentication required.',
                extensions: { code: 'NOT_AUTHENTICATED' },
              },
            ],
          });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        timer.unref();
        const graphqlContext: GraphqlContext = {
          requestContext: context,
          handler: options.handler,
          idempotencyKey: header(request, 'idempotency-key'),
          loader: new CapabilityLoader(
            options.handler,
            context,
            controller.signal,
          ),
          signal: controller.signal,
        };
        try {
          const result = await Promise.race([
            app.graphql(query, graphqlContext, variables, operationName),
            new Promise<never>((_, reject) =>
              controller.signal.addEventListener(
                'abort',
                () => reject(new GraphQLError('Request timed out.')),
                { once: true },
              ),
            ),
          ]);
          if (result.errors === undefined) return reply.send(result);
          return reply.send({
            data: result.data ?? null,
            errors: result.errors.map((error) => ({
              message: 'GraphQL request failed.',
              extensions: {
                code:
                  typeof error.extensions?.code === 'string'
                    ? error.extensions.code
                    : 'GRAPHQL_ERROR',
              },
            })),
          });
        } catch {
          return reply.status(400).send({
            errors: [
              {
                message: 'GraphQL request failed.',
                extensions: { code: 'GRAPHQL_ERROR' },
              },
            ],
          });
        } finally {
          clearTimeout(timer);
        }
      });
    },
  };
}
