import { randomBytes } from 'node:crypto';

import {
  PlatformPurposeSchema,
  PlatformUuidSchema,
} from '@wiser/platform-contracts';
import { z } from 'zod';

import type {
  ParticipantAuthenticator,
  ParticipantPrincipal,
} from '../types.js';
import type { PlatformPrincipalResolver } from './identity-module.js';

export interface PlatformParticipantContext {
  readonly tenantId: string;
  readonly projectId: string;
  readonly purpose: string;
}

export interface PlatformParticipantAuthenticatorOptions {
  readonly resolver: PlatformPrincipalResolver;
  readonly context: PlatformParticipantContext;
  readonly traceIdFactory?: () => string;
}

const ParticipantContextSchema = z.strictObject({
  tenantId: PlatformUuidSchema,
  projectId: PlatformUuidSchema,
  purpose: PlatformPurposeSchema,
});

function contextField(path: PropertyKey | undefined): string {
  switch (path) {
    case 'tenantId':
      return 'EXCON_TENANT_ID';
    case 'projectId':
      return 'EXCON_PROJECT_ID';
    case 'purpose':
      return 'EXCON_PURPOSE';
    default:
      return 'EXCON participant context';
  }
}

export function loadPlatformParticipantContext(
  environment: NodeJS.ProcessEnv,
): PlatformParticipantContext {
  const result = ParticipantContextSchema.safeParse({
    tenantId: environment['EXCON_TENANT_ID'],
    projectId: environment['EXCON_PROJECT_ID'],
    purpose: environment['EXCON_PURPOSE'],
  });
  if (!result.success) {
    const fields = [
      ...new Set(
        result.error.issues.map((issue) => contextField(issue.path[0])),
      ),
    ];
    throw new Error(
      `Invalid Agent EXCON participant configuration: ${fields.join(', ')}.`,
    );
  }
  return Object.freeze(result.data);
}

function traceId(): string {
  return randomBytes(16).toString('hex');
}

export class PlatformParticipantAuthenticator implements ParticipantAuthenticator {
  readonly #resolver: PlatformPrincipalResolver;
  readonly #context: PlatformParticipantContext;
  readonly #traceIdFactory: () => string;

  constructor(options: PlatformParticipantAuthenticatorOptions) {
    const parsedContext = ParticipantContextSchema.safeParse(options.context);
    if (!parsedContext.success) {
      throw new Error('Invalid Agent EXCON participant configuration.');
    }
    this.#resolver = options.resolver;
    this.#context = Object.freeze(parsedContext.data);
    this.#traceIdFactory = options.traceIdFactory ?? traceId;
  }

  async authenticate(token: string): Promise<ParticipantPrincipal | null> {
    if (token.length === 0) return null;
    const context = await this.#resolver.resolve({
      token,
      tenantId: this.#context.tenantId,
      projectId: this.#context.projectId,
      purpose: this.#context.purpose,
      traceId: this.#traceIdFactory(),
    });
    if (context === null) return null;

    const platformRoles = new Set(context.authorization.roles);
    const roles: Array<'operator' | 'run_agent'> = [];
    if (
      platformRoles.has('platform-owner') ||
      platformRoles.has('excon-operator')
    ) {
      roles.push('operator');
    }
    if (platformRoles.has('excon-run-agent')) roles.push('run_agent');
    if (roles.length === 0) return null;

    return Object.freeze({
      id: context.principal.actorId,
      participantVersionIds: Object.freeze([]),
      roles: Object.freeze(roles),
      ...(roles.includes('run_agent')
        ? { runAgentIds: Object.freeze([context.principal.actorId]) }
        : {}),
    });
  }
}
