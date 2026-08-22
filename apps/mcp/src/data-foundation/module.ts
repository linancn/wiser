import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  CallToolResult,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import {
  DATA_CAPABILITY_IDS,
  DATA_CAPABILITY_REGISTRY,
  type DataCapabilityId,
} from '@wiser/data-contracts';

import type { JsonObject } from '../http-client.js';
import type { WiserMcpModule } from '../platform/modules.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_RESOURCE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const IDEMPOTENCY_KEY_SCHEMA = z
  .string()
  .uuid('idempotencyKey 必须是 UUID。 / idempotencyKey must be a UUID.');
const VERSIONED_COMMANDS = new Set<DataCapabilityId>([
  'data.ingestion.submit',
  'data.uploadSession.complete',
  'data.ingestion.approve',
  'data.ingestion.reject',
  'data.operation.cancel',
]);
const RESPONSE_CHARACTER_LIMIT = 32_000;

const readAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const commandAnnotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const ToolOutputSchema = z
  .strictObject({
    ok: z.boolean(),
    data: z.json().optional(),
    resource: z
      .string()
      .regex(
        /^operation:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      )
      .optional(),
    error: z
      .strictObject({
        code: z.string(),
        message: z.string(),
        action: z.string(),
      })
      .optional(),
  })
  .superRefine((output, context) => {
    if (output.ok && output.data === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['data'],
        message: 'Successful MCP output requires data.',
      });
    }
    if (!output.ok && output.error === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'Failed MCP output requires a safe error.',
      });
    }
  });

export interface DataFoundationHttpRequest {
  readonly method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly query?: Readonly<
    Record<string, boolean | number | string | readonly string[]>
  >;
  readonly body?: JsonObject;
}

export interface DataFoundationHttpClient {
  request(request: DataFoundationHttpRequest): Promise<JsonObject>;
}

export interface DataFoundationMcpModuleOptions {
  readonly http: DataFoundationHttpClient;
  readonly tenantId: string;
  readonly projectId: string;
  readonly purpose: string;
}

function ownProperty(value: unknown, property: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  return Object.getOwnPropertyDescriptor(value, property)?.value;
}

function safeFailure(error: unknown) {
  const status = ownProperty(error, 'status');
  const code = ownProperty(error, 'code');
  const name = ownProperty(error, 'name');
  if (code === 'REQUEST_FAILED' && name === 'DataFoundationApiError') {
    if (status === 401) {
      return {
        code: 'NOT_AUTHENTICATED',
        message:
          '需要有效的统一 WISER 身份。 / A valid unified WISER identity is required.',
        action:
          '刷新或重新配置 Data API credential 后重试。 / Refresh or reconfigure the Data API credential before retrying.',
      } as const;
    }
    if (status === 403) {
      return {
        code: 'NOT_AUTHORIZED',
        message:
          '当前身份无权执行该数据操作。 / The current identity is not authorized for this data operation.',
        action:
          '核对 Tenant、Project、Purpose、Scope 与安全等级。 / Reconcile Tenant, Project, Purpose, scopes, and security level.',
      } as const;
    }
  }
  return {
    code: 'DATA_API_ERROR',
    message:
      '数据基座 API 暂时无法完成请求。 / The Data Foundation API could not complete the request.',
    action:
      '核对身份、范围与 Operation 状态后安全重试。 / Reconcile identity, scope, and Operation status before a safe retry.',
  } as const;
}

function safeError(error?: unknown): CallToolResult {
  const structuredContent = {
    ok: false,
    error: safeFailure(error),
  } as const;
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `${structuredContent.error.message}\n${structuredContent.error.action}`,
      },
    ],
    structuredContent,
  };
}

function operationResource(data: JsonObject): string | undefined {
  const nested = data['operation'];
  const nestedOperation =
    nested !== null && typeof nested === 'object' && !Array.isArray(nested)
      ? (nested as JsonObject)
      : undefined;
  const operationId =
    typeof data['operationId'] === 'string'
      ? data['operationId']
      : nestedOperation !== undefined
        ? nestedOperation['operationId']
        : undefined;
  return typeof operationId === 'string' && UUID_PATTERN.test(operationId)
    ? `operation://${operationId}`
    : undefined;
}

function success(data: JsonObject): CallToolResult {
  const resource = operationResource(data);
  const structuredContent = {
    ok: true,
    data,
    ...(resource === undefined ? {} : { resource }),
  } as const;
  const machineData = JSON.stringify(structuredContent);
  if (machineData.length > RESPONSE_CHARACTER_LIMIT) {
    const result = safeError();
    return {
      ...result,
      structuredContent: {
        ok: false,
        error: {
          code: 'MCP_RESPONSE_TOO_LARGE',
          message:
            '数据响应超过 MCP 安全上限。 / The data response exceeds the MCP safety limit.',
          action:
            '缩小 first、过滤条件或游标范围后重试。 / Reduce first, filters, or cursor scope and retry.',
        },
      },
    };
  }
  return {
    content: [
      {
        type: 'text',
        text: `数据能力调用成功。 / Data Capability call succeeded.\nMACHINE_DATA ${machineData}`,
      },
    ],
    structuredContent,
  };
}

function resourceText(payload: JsonObject): string {
  const serialized = JSON.stringify(payload);
  if (serialized.length <= RESPONSE_CHARACTER_LIMIT) return serialized;
  return JSON.stringify({
    error: 'MCP_RESOURCE_TOO_LARGE',
    message:
      '数据资源超过 MCP 安全上限。 / The data resource exceeds the MCP safety limit.',
  });
}

function objectSchema(id: DataCapabilityId): z.ZodObject<z.ZodRawShape> {
  const schema = DATA_CAPABILITY_REGISTRY[id].inputSchema;
  if (!(schema instanceof z.ZodObject)) {
    throw new Error(`Data Capability ${id} input must be a Zod object.`);
  }
  return schema;
}

function toolInputSchema(id: DataCapabilityId): z.ZodObject<z.ZodRawShape> {
  const schema = objectSchema(id);
  return DATA_CAPABILITY_REGISTRY[id].kind === 'command'
    ? schema.safeExtend({ idempotencyKey: IDEMPOTENCY_KEY_SCHEMA })
    : schema;
}

function contextHeaders(options: DataFoundationMcpModuleOptions) {
  return {
    'X-Wiser-Tenant-Id': options.tenantId,
    'X-Wiser-Project-Id': options.projectId,
    'X-Wiser-Purpose': options.purpose,
  } as const;
}

function jsonObject(value: unknown): JsonObject {
  const parsed = z.json().safeParse(value);
  if (!parsed.success || parsed.data === null || Array.isArray(parsed.data)) {
    throw new Error('Data MCP arguments must be a JSON object.');
  }
  return parsed.data as JsonObject;
}

function queryValue(
  value: unknown,
): boolean | number | string | readonly string[] {
  if (
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value;
  }
  if (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string')
  ) {
    return value;
  }
  throw new Error('Data MCP GET argument cannot be encoded safely.');
}

function transportRequest(
  id: DataCapabilityId,
  raw: Readonly<Record<string, unknown>>,
  options: DataFoundationMcpModuleOptions,
): DataFoundationHttpRequest {
  const definition = DATA_CAPABILITY_REGISTRY[id];
  const values: Record<string, unknown> = { ...raw };
  const headers: Record<string, string> = { ...contextHeaders(options) };
  let path = definition.restMapping.path.replace(/^\/api\/data\/v1/, '');
  for (const match of path.matchAll(/:([A-Za-z][A-Za-z0-9]*)/g)) {
    const name = match[1]!;
    const value = values[name];
    if (typeof value !== 'string') {
      throw new Error(`Data MCP path parameter ${name} is invalid.`);
    }
    path = path.replace(`:${name}`, encodeURIComponent(value));
    delete values[name];
  }

  if (definition.kind === 'command') {
    const idempotencyKey = values['idempotencyKey'];
    if (typeof idempotencyKey !== 'string') {
      throw new Error('Data MCP command idempotency key is invalid.');
    }
    headers['Idempotency-Key'] = idempotencyKey;
    delete values['idempotencyKey'];
  }
  if (VERSIONED_COMMANDS.has(id)) {
    const expectedVersion = values['expectedVersion'];
    if (
      typeof expectedVersion !== 'number' ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1
    ) {
      throw new Error('Data MCP command expectedVersion is invalid.');
    }
    headers['If-Match'] = `"v${expectedVersion}"`;
    delete values['expectedVersion'];
  }

  if (definition.restMapping.method === 'GET') {
    const query = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, queryValue(value)]),
    );
    return {
      method: 'GET',
      path,
      headers,
      ...(Object.keys(query).length === 0 ? {} : { query }),
    };
  }
  return {
    method: definition.restMapping.method,
    path,
    headers,
    body: jsonObject(values),
  };
}

function registerTools(
  server: McpServer,
  options: DataFoundationMcpModuleOptions,
): void {
  for (const id of DATA_CAPABILITY_IDS) {
    const definition = DATA_CAPABILITY_REGISTRY[id];
    server.registerTool(
      definition.mcpMapping.toolName,
      {
        title: `${id} 数据能力 / Data Capability`,
        description:
          `通过 WISER HTTP API 调用 ${id}；不会直连数据库或投影存储。 / ` +
          `Invoke ${id} through the WISER HTTP API; never connects directly to a database or projection store.`,
        inputSchema: toolInputSchema(id),
        outputSchema: ToolOutputSchema,
        annotations:
          definition.kind === 'query' ? readAnnotations : commandAnnotations,
      },
      async (input) => {
        try {
          const request = transportRequest(id, input, options);
          return success(await options.http.request(request));
        } catch (error) {
          return safeError(error);
        }
      },
    );
  }
}

interface ResourceDefinition {
  readonly name: string;
  readonly template: string;
  readonly path: (variables: Readonly<Record<string, string>>) => string;
}

const RESOURCES = Object.freeze([
  {
    name: 'data-item-version',
    template: 'data://items/{dataItemId}/versions/{versionId}',
    path: ({ dataItemId, versionId }) =>
      `/catalog/data-items/${encodeURIComponent(dataItemId!)}/versions/${encodeURIComponent(versionId!)}`,
  },
  {
    name: 'evidence-fragment',
    template: 'evidence://fragments/{evidenceId}',
    path: ({ evidenceId }) =>
      `/evidence/fragments/${encodeURIComponent(evidenceId!)}`,
  },
  {
    name: 'data-operation',
    template: 'operation://{operationId}',
    path: ({ operationId }) =>
      `/operations/${encodeURIComponent(operationId!)}`,
  },
  {
    name: 'data-capability-schema',
    template: 'schema://capabilities/{capabilityId}/{version}',
    path: ({ capabilityId, version }) =>
      `/capabilities/${encodeURIComponent(capabilityId!)}/${encodeURIComponent(version!)}`,
  },
  {
    name: 'stac-item',
    template: 'stac://collections/{collectionId}/items/{itemId}',
    path: ({ collectionId, itemId }) =>
      `/stac/collections/${encodeURIComponent(collectionId!)}/items/${encodeURIComponent(itemId!)}`,
  },
] as const satisfies readonly ResourceDefinition[]);

function resourceVariables(
  raw: Readonly<Record<string, string | string[]>>,
): Readonly<Record<string, string>> | null {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      !SAFE_RESOURCE_SEGMENT.test(value)
    ) {
      return null;
    }
    result[key] = value;
  }
  return result;
}

function registerResources(
  server: McpServer,
  options: DataFoundationMcpModuleOptions,
): void {
  for (const resource of RESOURCES) {
    server.registerResource(
      resource.name,
      new ResourceTemplate(resource.template, { list: undefined }),
      {
        title: `${resource.name} / Data Foundation resource`,
        description:
          '由 WISER HTTP API 授权读取的数据基座资源。 / A Data Foundation resource authorized through the WISER HTTP API.',
        mimeType: 'application/json',
      },
      async (uri, rawVariables) => {
        const variables = resourceVariables(rawVariables);
        let payload: JsonObject;
        if (variables === null) {
          payload = { error: 'INVALID_RESOURCE_REFERENCE' };
        } else {
          try {
            payload = await options.http.request({
              method: 'GET',
              path: resource.path(variables),
              headers: contextHeaders(options),
            });
          } catch {
            payload = { error: 'DATA_RESOURCE_UNAVAILABLE' };
          }
        }
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: resourceText(payload),
            },
          ],
        };
      },
    );
  }
}

function assertOptions(options: DataFoundationMcpModuleOptions): void {
  if (
    options.http === null ||
    typeof options.http?.request !== 'function' ||
    !UUID_PATTERN.test(options.tenantId) ||
    !UUID_PATTERN.test(options.projectId) ||
    options.purpose.length < 1 ||
    options.purpose.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(options.purpose)
  ) {
    throw new Error('Invalid Data Foundation MCP module configuration.');
  }
}

export function createDataFoundationMcpModule(
  options: DataFoundationMcpModuleOptions,
): WiserMcpModule {
  assertOptions(options);
  return {
    id: 'data.foundation',
    register(server) {
      registerTools(server, options);
      registerResources(server, options);
    },
  };
}
