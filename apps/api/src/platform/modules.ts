import type { FastifyInstance } from 'fastify';

export interface WiserApiModule {
  readonly id: string;
  register(app: FastifyInstance): Promise<void> | void;
}

const moduleIdPattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;

export function registerWiserApiModules(
  app: FastifyInstance,
  modules: readonly WiserApiModule[],
): void {
  app.register(async (moduleScope) => {
    const registeredIds = new Set<string>();
    for (const module of modules) {
      if (!moduleIdPattern.test(module.id)) {
        throw new Error(`Invalid WISER API module id: ${module.id}`);
      }
      if (registeredIds.has(module.id)) {
        throw new Error(`Duplicate WISER API module id: ${module.id}`);
      }
      registeredIds.add(module.id);
      await module.register(moduleScope);
    }
  });
}
