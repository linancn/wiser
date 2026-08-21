import type { PlatformRequestContext } from '@wiser/platform-contracts';
import type { ResolveSupabasePrincipalInput } from '@wiser/platform-auth';

import type { WiserApiModule } from './modules.js';

export interface PlatformPrincipalResolver {
  resolve(
    input: ResolveSupabasePrincipalInput,
  ): Promise<PlatformRequestContext | null>;
}

function singleHeader(value: string | readonly string[] | undefined) {
  return typeof value === 'string' ? value : undefined;
}

function bearerToken(authorization: string | undefined): string | null {
  if (authorization === undefined) return null;
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  return match?.[1] ?? null;
}

function unauthorized(message: string) {
  return {
    code: 'NOT_AUTHENTICATED',
    message,
  };
}

export function createPlatformIdentityModule(
  resolver: PlatformPrincipalResolver,
): WiserApiModule {
  return {
    id: 'platform.identity',
    register(app) {
      app.get('/api/platform/v1/me', async (request, reply) => {
        const token = bearerToken(singleHeader(request.headers.authorization));
        const tenantId = singleHeader(request.headers['x-wiser-tenant-id']);
        const projectId = singleHeader(request.headers['x-wiser-project-id']);
        const purpose = singleHeader(request.headers['x-wiser-purpose']);
        if (
          token === null ||
          tenantId === undefined ||
          projectId === undefined ||
          purpose === undefined
        ) {
          return reply
            .status(401)
            .send(
              unauthorized(
                '需要 Bearer credential、Tenant、Project 与 Purpose。 / Bearer credential, Tenant, Project, and Purpose are required.',
              ),
            );
        }

        const context = await resolver.resolve({
          token,
          tenantId,
          projectId,
          purpose,
          traceId: request.id.replaceAll('-', ''),
        });
        if (context === null) {
          return reply.status(403).send({
            code: 'NOT_AUTHORIZED',
            message:
              '当前身份无权访问该项目上下文。 / The current identity is not authorized for this project context.',
          });
        }

        return {
          actorType: context.principal.actorType,
          actorId: context.principal.actorId,
          tenantId: context.authorization.tenantId,
          projectId: context.authorization.projectId,
          roles: context.authorization.roles,
          scopes: context.authorization.scopes,
          purpose: context.authorization.purpose,
          authzVersion: context.authorization.authzVersion,
        };
      });
    },
  };
}
