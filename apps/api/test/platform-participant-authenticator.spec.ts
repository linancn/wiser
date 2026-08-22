import { describe, expect, it, vi } from 'vitest';

import type { PlatformRequestContext } from '@wiser/platform-contracts';

import {
  PlatformParticipantAuthenticator,
  loadPlatformParticipantContext,
} from '../src/platform/participant-authenticator.js';
import type { PlatformPrincipalResolver } from '../src/platform/identity-module.js';

const ACTOR_ID = 'f1000000-0000-4000-8000-000000000001';
const TENANT_ID = 'f1000000-0000-4000-8000-000000000002';
const PROJECT_ID = 'f1000000-0000-4000-8000-000000000003';
const TRACE_ID = 'f1000000000040008000000000000004';

function context(roles: readonly string[]): PlatformRequestContext {
  return {
    principal: {
      actorType: 'agent',
      actorId: ACTOR_ID,
      credentialId: 'f1000000-0000-4000-8000-000000000005',
      delegationId: 'f1000000-0000-4000-8000-000000000006',
      delegatedBy: 'f1000000-0000-4000-8000-000000000007',
      authenticationMethod: 'delegated_credential',
    },
    authorization: {
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      roles: [...roles],
      scopes: [],
      purpose: 'operate',
      maxSecurityLevel: 'L2_RESTRICTED',
      authzVersion: 3,
    },
    traceId: TRACE_ID,
  };
}

describe('unified Platform participant authenticator', () => {
  it('strictly loads the default EXCON authorization context', () => {
    expect(
      loadPlatformParticipantContext({
        EXCON_TENANT_ID: TENANT_ID,
        EXCON_PROJECT_ID: PROJECT_ID,
        EXCON_PURPOSE: 'operate',
      }),
    ).toEqual({
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      purpose: 'operate',
    });

    for (const environment of [
      { EXCON_PROJECT_ID: PROJECT_ID, EXCON_PURPOSE: 'operate' },
      {
        EXCON_TENANT_ID: 'not-a-uuid',
        EXCON_PROJECT_ID: PROJECT_ID,
        EXCON_PURPOSE: 'operate',
      },
      {
        EXCON_TENANT_ID: TENANT_ID,
        EXCON_PROJECT_ID: PROJECT_ID,
        EXCON_PURPOSE: 'Operate with spaces',
      },
    ]) {
      expect(() => loadPlatformParticipantContext(environment)).toThrow(
        /EXCON_(TENANT_ID|PURPOSE)/,
      );
    }
  });

  it.each(['platform-owner', 'excon-operator'])(
    'maps %s to an EXCON operator through the shared resolver',
    async (role) => {
      const resolve = vi.fn(() => Promise.resolve(context([role])));
      const authenticator = new PlatformParticipantAuthenticator({
        resolver: { resolve },
        context: {
          tenantId: TENANT_ID,
          projectId: PROJECT_ID,
          purpose: 'operate',
        },
        traceIdFactory: () => TRACE_ID,
      });

      await expect(
        authenticator.authenticate('verified-token'),
      ).resolves.toEqual({
        id: ACTOR_ID,
        participantVersionIds: [],
        roles: ['operator'],
      });
      expect(resolve).toHaveBeenCalledWith({
        token: 'verified-token',
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        purpose: 'operate',
        traceId: TRACE_ID,
      });
    },
  );

  it('maps excon-run-agent to a run-agent credential bound to the platform actor id', async () => {
    const resolver: PlatformPrincipalResolver = {
      resolve: () => Promise.resolve(context(['excon-run-agent'])),
    };
    const authenticator = new PlatformParticipantAuthenticator({
      resolver,
      context: {
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        purpose: 'operate',
      },
      traceIdFactory: () => TRACE_ID,
    });

    await expect(
      authenticator.authenticate('delegated-token'),
    ).resolves.toEqual({
      id: ACTOR_ID,
      participantVersionIds: [],
      roles: ['run_agent'],
      runAgentIds: [ACTOR_ID],
    });
  });

  it('fails closed for unknown roles and unresolved credentials', async () => {
    const resolve = vi
      .fn<PlatformPrincipalResolver['resolve']>()
      .mockResolvedValueOnce(context(['data-reader']))
      .mockResolvedValueOnce(null);
    const authenticator = new PlatformParticipantAuthenticator({
      resolver: { resolve },
      context: {
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        purpose: 'operate',
      },
      traceIdFactory: () => TRACE_ID,
    });

    await expect(authenticator.authenticate('data-only')).resolves.toBeNull();
    await expect(authenticator.authenticate('invalid')).resolves.toBeNull();
  });
});
