import fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';

import type {
  TelemetryCredentialVerifier,
  TelemetryForwarder,
  TelemetryPrincipal,
  TelemetrySignal,
} from './types.js';

const envelopeKeys = {
  traces: { root: 'resourceSpans', scopes: 'scopeSpans', records: 'spans' },
  metrics: {
    root: 'resourceMetrics',
    scopes: 'scopeMetrics',
    records: 'metrics',
  },
  logs: { root: 'resourceLogs', scopes: 'scopeLogs', records: 'logRecords' },
} as const;

const EnvelopeSchemaBySignal = {
  traces: z.strictObject({
    resourceSpans: z.array(z.unknown()).min(1).max(200),
  }),
  metrics: z.strictObject({
    resourceMetrics: z.array(z.unknown()).min(1).max(200),
  }),
  logs: z.strictObject({ resourceLogs: z.array(z.unknown()).min(1).max(200) }),
} satisfies Record<TelemetrySignal, z.ZodType>;

const sensitiveAttributePattern =
  /^(?:gen_ai\.(?:input|output|prompt|completion)|tool\.(?:arguments|result)|wiser\.(?:content|submission|feedback|hidden)\.(?:body|payload|outcome))/i;
const protectedResourceKeys = new Set([
  'service.name',
  'service.namespace',
  'service.instance.id',
  'wiser.exercise.run.id',
  'wiser.agent.session.id',
  'wiser.agent.role',
  'wiser.telemetry.source',
  'wiser.telemetry.trust',
]);

type JsonRecord = Record<string, unknown>;

class TelemetryIngressError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'TelemetryIngressError';
  }
}

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function resourceGroups(
  body: JsonRecord,
  signal: TelemetrySignal,
): JsonRecord[] {
  const root = body[envelopeKeys[signal].root];
  if (!Array.isArray(root)) return [];
  return root
    .map(record)
    .filter((value): value is JsonRecord => value !== undefined);
}

function countRecords(body: JsonRecord, signal: TelemetrySignal): number {
  const keys = envelopeKeys[signal];
  let count = 0;
  for (const group of resourceGroups(body, signal)) {
    const scopes = group[keys.scopes];
    if (!Array.isArray(scopes)) continue;
    for (const scope of scopes) {
      const records = record(scope)?.[keys.records];
      if (Array.isArray(records)) count += records.length;
    }
  }
  return count;
}

function containsSensitiveAttribute(
  value: unknown,
  visited = new Set<object>(),
): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (visited.has(value)) return false;
  visited.add(value);
  if (Array.isArray(value)) {
    return value.some((item) => containsSensitiveAttribute(item, visited));
  }
  const candidate = value as JsonRecord;
  if (
    typeof candidate['key'] === 'string' &&
    sensitiveAttributePattern.test(candidate['key'])
  ) {
    return true;
  }
  return Object.values(candidate).some((item) =>
    containsSensitiveAttribute(item, visited),
  );
}

function stringAttribute(key: string, value: string): JsonRecord {
  return { key, value: { stringValue: value } };
}

function removeProtectedIdentityAttributes(
  value: unknown,
  visited = new Set<object>(),
): void {
  if (value === null || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  if (Array.isArray(value)) {
    for (const item of value) removeProtectedIdentityAttributes(item, visited);
    return;
  }
  const candidate = value as JsonRecord;
  if (Array.isArray(candidate['attributes'])) {
    candidate['attributes'] = candidate['attributes'].filter((attribute) => {
      const key = record(attribute)?.['key'];
      return (
        typeof key !== 'string' || !protectedResourceKeys.has(key.toLowerCase())
      );
    });
  }
  for (const item of Object.values(candidate)) {
    removeProtectedIdentityAttributes(item, visited);
  }
}

function normalizeIdentity(
  body: JsonRecord,
  signal: TelemetrySignal,
  principal: TelemetryPrincipal,
): JsonRecord {
  const cloned = structuredClone(body);
  removeProtectedIdentityAttributes(cloned);
  for (const group of resourceGroups(cloned, signal)) {
    const resource = record(group['resource']) ?? {};
    const attributes = Array.isArray(resource['attributes'])
      ? resource['attributes']
      : [];
    attributes.push(
      stringAttribute('service.name', 'wiser-participant-agent'),
      stringAttribute('service.namespace', 'wiser.participant'),
      stringAttribute('service.instance.id', principal.runAgentId),
      stringAttribute('wiser.exercise.run.id', principal.runId),
      stringAttribute('wiser.agent.session.id', principal.runAgentId),
      stringAttribute('wiser.telemetry.source', 'participant_exporter'),
      stringAttribute('wiser.telemetry.trust', 'participant_reported'),
    );
    if (principal.role !== undefined) {
      attributes.push(stringAttribute('wiser.agent.role', principal.role));
    }
    resource['attributes'] = attributes;
    group['resource'] = resource;
  }
  return cloned;
}

function bearerToken(request: FastifyRequest): string {
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.authorization ?? '');
  if (match === null || match[1]!.length < 32) {
    throw new TelemetryIngressError(
      'TELEMETRY_NOT_AUTHORIZED',
      401,
      'A valid participant telemetry credential is required.',
    );
  }
  return match[1]!;
}

export interface BuildTelemetryIngressOptions {
  readonly credentialVerifier: TelemetryCredentialVerifier;
  readonly forwarder: TelemetryForwarder;
  readonly logger?: boolean;
  readonly bodyLimitBytes?: number;
  readonly maxRecordsPerRequest?: number;
  readonly maxRequestsPerMinute?: number;
}

export function buildTelemetryIngress(
  options: BuildTelemetryIngressOptions,
): FastifyInstance {
  const app = fastify({
    logger: options.logger ?? true,
    bodyLimit: options.bodyLimitBytes ?? 1_048_576,
  });
  const maxRecords = options.maxRecordsPerRequest ?? 1_000;
  const maxRequests = options.maxRequestsPerMinute ?? 120;
  const rateWindows = new Map<string, { startedAt: number; count: number }>();

  app.get('/health/live', () => ({ status: 'live' }));
  app.get('/health/ready', () => ({ status: 'ready' }));

  for (const signal of ['traces', 'metrics', 'logs'] as const) {
    app.post(`/v1/${signal}`, async (request, reply) => {
      const token = bearerToken(request);
      let principal: TelemetryPrincipal | null;
      try {
        principal = await options.credentialVerifier.authenticate(token);
      } catch {
        throw new TelemetryIngressError(
          'TELEMETRY_AUTH_UNAVAILABLE',
          503,
          'Telemetry credential verification is temporarily unavailable.',
        );
      }
      if (principal === null) {
        throw new TelemetryIngressError(
          'TELEMETRY_NOT_AUTHORIZED',
          401,
          'The participant telemetry credential is invalid or expired.',
        );
      }

      const now = Date.now();
      const window = rateWindows.get(principal.credentialId);
      const current =
        window === undefined || now - window.startedAt >= 60_000
          ? { startedAt: now, count: 0 }
          : window;
      if (current.count >= maxRequests) {
        const retryAfter = Math.max(
          1,
          Math.ceil((60_000 - (now - current.startedAt)) / 1_000),
        );
        throw new TelemetryIngressError(
          'TELEMETRY_RATE_LIMITED',
          429,
          'The participant telemetry request quota is exhausted.',
          retryAfter,
        );
      }
      current.count += 1;
      rateWindows.set(principal.credentialId, current);

      const body = EnvelopeSchemaBySignal[signal].parse(
        request.body,
      ) as JsonRecord;
      const acceptedRecords = countRecords(body, signal);
      if (acceptedRecords < 1 || acceptedRecords > maxRecords) {
        throw new TelemetryIngressError(
          'TELEMETRY_RECORD_LIMIT',
          400,
          `Telemetry payloads must contain between 1 and ${maxRecords} records.`,
        );
      }
      if (containsSensitiveAttribute(body)) {
        throw new TelemetryIngressError(
          'TELEMETRY_SENSITIVE_CONTENT',
          400,
          'Prompt, completion, tool-body, feedback-body, and hidden-outcome attributes are not accepted.',
        );
      }
      const normalized = normalizeIdentity(body, signal, principal);
      try {
        await options.forwarder.forward(signal, normalized);
      } catch {
        throw new TelemetryIngressError(
          'TELEMETRY_COLLECTOR_UNAVAILABLE',
          503,
          'The internal telemetry pipeline is temporarily unavailable.',
        );
      }
      return reply
        .header('x-wiser-accepted-records', String(acceptedRecords))
        .header('x-wiser-telemetry-trust', 'participant_reported')
        .send({ partialSuccess: {} });
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    const errorStatusCode = record(error)?.['statusCode'];
    const known =
      error instanceof TelemetryIngressError
        ? error
        : error instanceof ZodError
          ? new TelemetryIngressError(
              'TELEMETRY_INVALID_PAYLOAD',
              400,
              'The OTLP JSON payload is invalid.',
            )
          : errorStatusCode === 413
            ? new TelemetryIngressError(
                'TELEMETRY_BODY_TOO_LARGE',
                413,
                'The telemetry payload exceeds the configured body limit.',
              )
            : new TelemetryIngressError(
                'TELEMETRY_INTERNAL_ERROR',
                500,
                'The telemetry request could not be processed.',
              );
    if (known.retryAfterSeconds !== undefined) {
      reply.header('retry-after', String(known.retryAfterSeconds));
    }
    void reply.code(known.statusCode).send({
      error: { code: known.code, message: known.message },
    });
  });

  return app;
}
