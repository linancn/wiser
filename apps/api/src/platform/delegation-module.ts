import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  PlatformPurposeSchema,
  PlatformScopeSchema,
  PlatformSecurityLevelSchema,
  PlatformUuidSchema,
  type PlatformRequestContext,
  type PlatformSecurityLevel,
} from '@wiser/platform-contracts';

import type { PlatformPrincipalResolver } from './identity-module.js';
import type { WiserApiModule } from './modules.js';

export interface PlatformDelegationView {
  readonly delegationId: string;
  readonly delegatedByActorId: string;
  readonly delegateActorId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly scopes: readonly string[];
  readonly purpose: string;
  readonly maxSecurityLevel: PlatformSecurityLevel;
  readonly status: 'active' | 'expired' | 'revoked';
  readonly version: number;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly revokedAt?: string;
}

export interface IssuedPlatformCredentialView {
  readonly credentialId: string;
  readonly delegationId: string;
  readonly token: string;
  readonly expiresAt: string;
}

interface DelegationCommandContext {
  readonly context: PlatformRequestContext;
  readonly idempotencyKey: string;
}

export interface PlatformDelegationCommandService {
  createDelegation(
    input: DelegationCommandContext & {
      readonly delegateActorId: string;
      readonly scopes: readonly string[];
      readonly purpose: string;
      readonly maxSecurityLevel: PlatformSecurityLevel;
      readonly expiresInSeconds: number;
    },
  ): Promise<PlatformDelegationView>;
  getDelegation(input: {
    readonly context: PlatformRequestContext;
    readonly delegationId: string;
  }): Promise<PlatformDelegationView | null>;
  issueCredential(
    input: DelegationCommandContext & {
      readonly delegationId: string;
      readonly expectedDelegationVersion: number;
    },
  ): Promise<IssuedPlatformCredentialView>;
  rotateCredential(
    input: DelegationCommandContext & {
      readonly delegationId: string;
      readonly expectedDelegationVersion: number;
    },
  ): Promise<IssuedPlatformCredentialView>;
  revokeDelegation(
    input: DelegationCommandContext & {
      readonly delegationId: string;
      readonly expectedDelegationVersion: number;
    },
  ): Promise<void>;
  revokeCredential(
    input: DelegationCommandContext & {
      readonly credentialId: string;
    },
  ): Promise<void>;
}

export interface PlatformDelegationModuleOptions {
  readonly resolver: PlatformPrincipalResolver;
  readonly service: PlatformDelegationCommandService;
  readonly knownScopes: ReadonlySet<string>;
}

const CreateDelegationBodySchema = z.strictObject({
  delegateActorId: PlatformUuidSchema,
  scopes: z.array(PlatformScopeSchema).min(1).max(128),
  purpose: PlatformPurposeSchema,
  maxSecurityLevel: PlatformSecurityLevelSchema,
  expiresInSeconds: z.number().int().min(60).max(3_600),
});

const ExpectedVersionBodySchema = z.strictObject({
  expectedDelegationVersion: z.number().int().positive(),
});

const EmptyBodySchema = z.strictObject({});
const DelegationParamsSchema = z.strictObject({
  delegationId: PlatformUuidSchema,
});
const DelegationRevokeParamsSchema = z.strictObject({
  delegationAction: z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:revoke$/i,
    )
    .transform((value) => value.slice(0, -':revoke'.length)),
});
const CredentialRevokeParamsSchema = z.strictObject({
  credentialAction: z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:revoke$/i,
    )
    .transform((value) => value.slice(0, -':revoke'.length)),
});

const SECURITY_RANK: Readonly<Record<PlatformSecurityLevel, number>> = {
  L0_PUBLIC: 0,
  L1_INTERNAL: 1,
  L2_RESTRICTED: 2,
  L3_CONFIDENTIAL: 3,
};

function singleHeader(value: string | readonly string[] | undefined) {
  return typeof value === 'string' ? value : undefined;
}

function bearerToken(authorization: string | undefined): string | null {
  if (authorization === undefined) return null;
  return /^Bearer ([^\s]+)$/.exec(authorization)?.[1] ?? null;
}

function setNoStore(reply: FastifyReply): void {
  reply.header(
    'Cache-Control',
    'private, no-cache, no-store, max-age=0, must-revalidate',
  );
  reply.header('Expires', '0');
  reply.header('Pragma', 'no-cache');
}

function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
) {
  setNoStore(reply);
  return reply.status(status).send({ code, message });
}

async function resolveManagingHuman(
  request: FastifyRequest,
  reply: FastifyReply,
  resolver: PlatformPrincipalResolver,
): Promise<PlatformRequestContext | null> {
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
    sendError(
      reply,
      401,
      'NOT_AUTHENTICATED',
      '需要 Bearer credential、Tenant、Project 与 Purpose。 / Bearer credential, Tenant, Project, and Purpose are required.',
    );
    return null;
  }

  const context = await resolver.resolve({
    token,
    tenantId,
    projectId,
    purpose,
    traceId: request.id.replaceAll('-', ''),
  });
  if (
    context === null ||
    context.principal.actorType !== 'human' ||
    context.principal.authenticationMethod !== 'supabase_jwt' ||
    !context.authorization.scopes.includes('platform.delegation.manage')
  ) {
    sendError(
      reply,
      403,
      'NOT_AUTHORIZED',
      '当前身份无权管理委托凭据。 / The current identity may not manage delegated credentials.',
    );
    return null;
  }
  return context;
}

function idempotencyKey(request: FastifyRequest): string | null {
  const parsed = PlatformUuidSchema.safeParse(
    singleHeader(request.headers['idempotency-key']),
  );
  return parsed.success ? parsed.data : null;
}

function hasUniqueKnownDelegableScopes(
  scopes: readonly string[],
  context: PlatformRequestContext,
  knownScopes: ReadonlySet<string>,
): boolean {
  return (
    new Set(scopes).size === scopes.length &&
    scopes.every(
      (scope) =>
        knownScopes.has(scope) &&
        scope !== 'platform.delegation.manage' &&
        context.authorization.scopes.includes(scope),
    )
  );
}

function validSecurityCeiling(
  requested: PlatformSecurityLevel,
  context: PlatformRequestContext,
): boolean {
  return (
    SECURITY_RANK[requested] <=
    SECURITY_RANK[context.authorization.maxSecurityLevel]
  );
}

function requireCommandIdempotency(
  request: FastifyRequest,
  reply: FastifyReply,
): string | null {
  const key = idempotencyKey(request);
  if (key === null) {
    sendError(
      reply,
      422,
      'VALIDATION_FAILED',
      '命令需要 UUID Idempotency-Key。 / Commands require a UUID Idempotency-Key.',
    );
  }
  return key;
}

export function createPlatformDelegationModule(
  options: PlatformDelegationModuleOptions,
): WiserApiModule {
  return {
    id: 'platform.delegation',
    register(app) {
      app.post('/api/platform/v1/delegations', async (request, reply) => {
        const context = await resolveManagingHuman(
          request,
          reply,
          options.resolver,
        );
        if (context === null) return reply;
        const key = requireCommandIdempotency(request, reply);
        if (key === null) return reply;

        const body = CreateDelegationBodySchema.safeParse(request.body);
        if (
          !body.success ||
          body.data.purpose !== context.authorization.purpose ||
          !hasUniqueKnownDelegableScopes(
            body.data.scopes,
            context,
            options.knownScopes,
          ) ||
          !validSecurityCeiling(body.data.maxSecurityLevel, context)
        ) {
          return sendError(
            reply,
            422,
            'VALIDATION_FAILED',
            '委托边界无效或超出当前授权。 / The delegation boundary is invalid or exceeds current authorization.',
          );
        }

        const view = await options.service.createDelegation({
          context,
          delegateActorId: body.data.delegateActorId,
          scopes: body.data.scopes,
          purpose: body.data.purpose,
          maxSecurityLevel: body.data.maxSecurityLevel,
          expiresInSeconds: body.data.expiresInSeconds,
          idempotencyKey: key,
        });
        setNoStore(reply);
        reply.header(
          'Location',
          `/api/platform/v1/delegations/${view.delegationId}`,
        );
        return reply.status(201).send(view);
      });

      app.get(
        '/api/platform/v1/delegations/:delegationId',
        async (request, reply) => {
          const context = await resolveManagingHuman(
            request,
            reply,
            options.resolver,
          );
          if (context === null) return reply;
          const params = DelegationParamsSchema.safeParse(request.params);
          if (!params.success) {
            return sendError(
              reply,
              422,
              'VALIDATION_FAILED',
              'Delegation id 无效。 / Delegation id is invalid.',
            );
          }
          const view = await options.service.getDelegation({
            context,
            delegationId: params.data.delegationId,
          });
          if (view === null) {
            return sendError(
              reply,
              404,
              'DELEGATION_NOT_FOUND',
              '未找到委托。 / Delegation was not found.',
            );
          }
          setNoStore(reply);
          return reply.send(view);
        },
      );

      const credentialCommand = async (
        request: FastifyRequest,
        reply: FastifyReply,
        rotate: boolean,
      ) => {
        const context = await resolveManagingHuman(
          request,
          reply,
          options.resolver,
        );
        if (context === null) return reply;
        const key = requireCommandIdempotency(request, reply);
        if (key === null) return reply;
        const params = DelegationParamsSchema.safeParse(request.params);
        const body = ExpectedVersionBodySchema.safeParse(request.body);
        if (!params.success || !body.success) {
          return sendError(
            reply,
            422,
            'VALIDATION_FAILED',
            'Credential command 无效。 / Credential command is invalid.',
          );
        }
        const input = {
          context,
          delegationId: params.data.delegationId,
          expectedDelegationVersion: body.data.expectedDelegationVersion,
          idempotencyKey: key,
        };
        const issued = rotate
          ? await options.service.rotateCredential(input)
          : await options.service.issueCredential(input);
        setNoStore(reply);
        return reply.status(201).send(issued);
      };

      app.post(
        '/api/platform/v1/delegations/:delegationId/credentials',
        (request, reply) => credentialCommand(request, reply, false),
      );
      app.post(
        '/api/platform/v1/delegations/:delegationId/credentials::rotate',
        (request, reply) => credentialCommand(request, reply, true),
      );

      app.post(
        '/api/platform/v1/delegations/:delegationAction',
        async (request, reply) => {
          const context = await resolveManagingHuman(
            request,
            reply,
            options.resolver,
          );
          if (context === null) return reply;
          const key = requireCommandIdempotency(request, reply);
          if (key === null) return reply;
          const params = DelegationRevokeParamsSchema.safeParse(request.params);
          const body = ExpectedVersionBodySchema.safeParse(request.body);
          if (!params.success || !body.success) {
            return sendError(
              reply,
              422,
              'VALIDATION_FAILED',
              'Delegation revoke command 无效。 / Delegation revoke command is invalid.',
            );
          }
          await options.service.revokeDelegation({
            context,
            delegationId: params.data.delegationAction,
            expectedDelegationVersion: body.data.expectedDelegationVersion,
            idempotencyKey: key,
          });
          setNoStore(reply);
          return reply.status(204).send();
        },
      );

      app.post(
        '/api/platform/v1/credentials/:credentialAction',
        async (request, reply) => {
          const context = await resolveManagingHuman(
            request,
            reply,
            options.resolver,
          );
          if (context === null) return reply;
          const key = requireCommandIdempotency(request, reply);
          if (key === null) return reply;
          const params = CredentialRevokeParamsSchema.safeParse(request.params);
          const body = EmptyBodySchema.safeParse(request.body ?? {});
          if (!params.success || !body.success) {
            return sendError(
              reply,
              422,
              'VALIDATION_FAILED',
              'Credential revoke command 无效。 / Credential revoke command is invalid.',
            );
          }
          await options.service.revokeCredential({
            context,
            credentialId: params.data.credentialAction,
            idempotencyKey: key,
          });
          setNoStore(reply);
          return reply.status(204).send();
        },
      );
    },
  };
}
