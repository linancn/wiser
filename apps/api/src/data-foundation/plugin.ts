import type { FastifyReply } from 'fastify';
import { z } from 'zod';

import {
  DATA_CAPABILITY_IDS,
  DATA_CAPABILITY_REGISTRY,
} from '@wiser/data-contracts';

import type { WiserApiModule } from '../platform/modules.js';

export interface DataFoundationReadiness {
  readonly database: boolean;
  readonly objectStore: boolean;
  readonly worker: boolean;
}

export interface DataFoundationModuleOptions {
  readonly readiness: () => Promise<DataFoundationReadiness>;
}

function setNoStore(reply: FastifyReply): void {
  reply.header(
    'Cache-Control',
    'private, no-cache, no-store, max-age=0, must-revalidate',
  );
  reply.header('Expires', '0');
  reply.header('Pragma', 'no-cache');
}

const capabilities = Object.freeze(
  DATA_CAPABILITY_IDS.map((id) => {
    const definition = DATA_CAPABILITY_REGISTRY[id];
    return Object.freeze({
      id: definition.id,
      version: definition.version,
      kind: definition.kind,
      requiredScopes: definition.requiredScopes,
      maxSecurityLevel: definition.maxSecurityLevel,
      executionMode: definition.executionMode,
      timeout: definition.timeout,
      idempotent: definition.idempotent,
      auditLevel: definition.auditLevel,
      restMapping: definition.restMapping,
      graphqlMapping: definition.graphqlMapping,
      mcpMapping: definition.mcpMapping,
      skillMapping: definition.skillMapping,
      inputSchema: z.toJSONSchema(definition.inputSchema, {
        target: 'draft-7',
      }),
      outputSchema: z.toJSONSchema(definition.outputSchema, {
        target: 'draft-7',
      }),
    });
  }),
);
const capabilityById: ReadonlyMap<string, (typeof capabilities)[number]> =
  new Map(
    capabilities.map((capability) => [capability.id, capability] as const),
  );
const capabilityResourceParams = z.strictObject({
  capabilityId: z.string().min(1).max(128),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
});

function healthProjection(readiness: DataFoundationReadiness) {
  const ready = readiness.database && readiness.objectStore && readiness.worker;
  return {
    status: ready ? ('ready' as const) : ('degraded' as const),
    system: 'data-foundation' as const,
    authority: {
      database: readiness.database,
      objectStore: readiness.objectStore,
    },
    worker: readiness.worker,
    projections: 'rebuildable' as const,
  };
}

export function createDataFoundationModule(
  options: DataFoundationModuleOptions,
): WiserApiModule {
  return {
    id: 'data.foundation',
    register(app) {
      app.get('/api/data/v1/health', async (_request, reply) => {
        setNoStore(reply);
        try {
          const projection = healthProjection(await options.readiness());
          return reply
            .status(projection.status === 'ready' ? 200 : 503)
            .send(projection);
        } catch {
          return reply.status(503).send(
            healthProjection({
              database: false,
              objectStore: false,
              worker: false,
            }),
          );
        }
      });

      app.get('/api/data/v1/capabilities', (_request, reply) => {
        setNoStore(reply);
        return reply.send({
          registryVersion: '1.0.0',
          capabilities,
        });
      });

      app.get(
        '/api/data/v1/capabilities/:capabilityId/:version',
        (request, reply) => {
          setNoStore(reply);
          const parsed = capabilityResourceParams.safeParse(request.params);
          const capability = parsed.success
            ? capabilityById.get(parsed.data.capabilityId)
            : undefined;
          if (
            capability === undefined ||
            !parsed.success ||
            capability.version !== parsed.data.version
          ) {
            return reply.status(404).send({
              code: 'CAPABILITY_SCHEMA_NOT_FOUND',
              message:
                '数据能力版本不存在。 / The Data Capability version does not exist.',
            });
          }
          return reply.send(capability);
        },
      );
    },
  };
}
