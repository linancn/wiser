import { createHmac } from 'node:crypto';

import type { QueryResultRow } from 'pg';

import type {
  TelemetryCredentialVerifier,
  TelemetryPrincipal,
} from './types.js';

export interface TelemetryCredentialQuery {
  query<T extends QueryResultRow>(
    text: string,
    values: readonly unknown[],
  ): Promise<{ readonly rows: readonly T[] }>;
}

interface CredentialRow extends QueryResultRow {
  readonly credential_id: string;
  readonly run_id: string;
  readonly run_agent_id: string;
  readonly role_key: string | null;
}

export class PostgresTelemetryCredentialVerifier implements TelemetryCredentialVerifier {
  readonly #database: TelemetryCredentialQuery;
  readonly #pepper: string;

  constructor(options: { database: TelemetryCredentialQuery; pepper: string }) {
    if (options.pepper.length < 16) {
      throw new Error(
        'WISER telemetry token pepper must be at least 16 characters.',
      );
    }
    this.#database = options.database;
    this.#pepper = options.pepper;
  }

  async authenticate(token: string): Promise<TelemetryPrincipal | null> {
    const tokenHash = createHmac('sha256', this.#pepper)
      .update(token, 'utf8')
      .digest();
    const result = await this.#database.query<CredentialRow>(
      `select
         credential.id as credential_id,
         credential.run_id,
         credential.run_agent_id,
         role.role_key
       from excon_private.run_agent_credentials as credential
       join public.run_agents as run_agent
         on run_agent.id = credential.run_agent_id
        and run_agent.run_id = credential.run_id
       join public.agent_versions as agent_version
         on agent_version.id = run_agent.agent_version_id
       join public.agent_identities as agent_identity
         on agent_identity.id = agent_version.agent_identity_id
       left join lateral (
         select definition.role_key
         from public.run_role_assignments as assignment
         join public.role_definitions as definition
           on definition.id = assignment.role_definition_id
         where assignment.run_id = credential.run_id
           and assignment.run_agent_id = credential.run_agent_id
           and assignment.released_at is null
           and assignment.assignment_kind = 'primary'
         order by assignment.assigned_at desc
         limit 1
       ) as role on true
       where credential.token_hash = $1
         and credential.revoked_at is null
         and credential.expires_at > now()
         and 'telemetry:write' = any(credential.scopes)
         and run_agent.state not in ('removed', 'done')
         and agent_version.lifecycle_state = 'published'
         and agent_identity.lifecycle_state = 'active'
       limit 1`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      credentialId: row.credential_id,
      runId: row.run_id,
      runAgentId: row.run_agent_id,
      ...(row.role_key === null ? {} : { role: row.role_key }),
    };
  }
}
