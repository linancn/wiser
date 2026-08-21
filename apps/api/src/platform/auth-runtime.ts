import { createClient } from '@supabase/supabase-js';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { z } from 'zod';

import {
  DATA_CAPABILITY_IDS,
  DATA_CAPABILITY_REGISTRY,
} from '@wiser/data-contracts';
import {
  DelegatedCredentialPrincipalResolver,
  PlatformCredentialPrincipalResolver,
  PostgresPlatformDelegationService,
  SupabaseJwtPrincipalResolver,
  createPostgresAuthorizationContextLoader,
  createPostgresDelegatedCredentialRecordLoader,
  createSupabaseJwtClaimsVerifier,
  parseDelegatedCredentialHmacKeyRing,
  type AuthorizationQuery,
  type AuthorizationRow,
  type DelegatedCredentialAuthorizationQuery,
  type DelegatedCredentialAuthorizationRow,
  type DelegatedCredentialHmacKeyRing,
  type PlatformDelegationTransactionClient,
  type PlatformDelegationTransactionPool,
  type SupabaseClaimsClient,
} from '@wiser/platform-auth';

import { createPlatformDelegationModule } from './delegation-module.js';
import {
  createPlatformIdentityModule,
  type PlatformPrincipalResolver,
} from './identity-module.js';
import type { WiserApiModule } from './modules.js';

export type PlatformAuthRuntimeConfig =
  | { readonly mode: 'off' }
  | {
      readonly mode: 'supabase';
      readonly supabaseUrl: string;
      readonly supabasePublishableKey: string;
      readonly databaseUrl: string;
      readonly delegatedCredentialHmacKeyRing: DelegatedCredentialHmacKeyRing;
    };

export interface AuthorizationDatabase {
  readonly query: AuthorizationQuery;
  readonly delegatedCredentialQuery: DelegatedCredentialAuthorizationQuery;
  readonly transactionPool: PlatformDelegationTransactionPool;
  close(): Promise<void>;
}

export interface PlatformAuthRuntimeFactories {
  createClaimsClient(config: {
    readonly supabaseUrl: string;
    readonly supabasePublishableKey: string;
  }): SupabaseClaimsClient;
  createAuthorizationDatabase(config: {
    readonly databaseUrl: string;
  }): AuthorizationDatabase;
}

export interface PlatformAuthRuntime {
  readonly module: WiserApiModule | null;
  readonly resolver: PlatformPrincipalResolver | null;
}

const SupabaseRuntimeFields = z.strictObject({
  supabaseUrl: z
    .string()
    .url()
    .refine((value) => {
      const protocol = new URL(value).protocol;
      return protocol === 'http:' || protocol === 'https:';
    }),
  supabasePublishableKey: z.string().min(24),
  databaseUrl: z.string().regex(/^postgres(?:ql)?:\/\//),
  delegatedCredentialHmacKeys: z.string().min(1).max(65_536),
});

function environmentField(path: PropertyKey | undefined): string {
  switch (path) {
    case 'supabaseUrl':
      return 'SUPABASE_URL';
    case 'supabasePublishableKey':
      return 'SUPABASE_PUBLISHABLE_KEY';
    case 'databaseUrl':
      return 'DATABASE_URL';
    case 'delegatedCredentialHmacKeys':
      return 'WISER_DELEGATED_CREDENTIAL_HMAC_KEYS';
    default:
      return 'configuration';
  }
}

export function loadPlatformAuthRuntimeConfig(
  environment: NodeJS.ProcessEnv,
): PlatformAuthRuntimeConfig {
  const production = environment['NODE_ENV'] === 'production';
  const configuredMode = environment['WISER_AUTH_MODE'];
  const mode = configuredMode ?? (production ? 'supabase' : 'off');
  if (mode !== 'off' && mode !== 'supabase') {
    throw new Error('WISER_AUTH_MODE must be off or supabase.');
  }
  if (mode === 'off') {
    if (production) {
      throw new Error('WISER_AUTH_MODE=off is forbidden in production.');
    }
    return { mode };
  }

  const parsed = SupabaseRuntimeFields.safeParse({
    supabaseUrl: environment['SUPABASE_URL'],
    supabasePublishableKey: environment['SUPABASE_PUBLISHABLE_KEY'],
    databaseUrl: environment['DATABASE_URL'],
    delegatedCredentialHmacKeys:
      environment['WISER_DELEGATED_CREDENTIAL_HMAC_KEYS'],
  });
  if (!parsed.success) {
    const fields = parsed.error.issues
      .map((issue) => environmentField(issue.path[0]))
      .join(', ');
    throw new Error(`Invalid platform Auth configuration: ${fields}.`);
  }
  let delegatedCredentialHmacKeyRing: DelegatedCredentialHmacKeyRing;
  try {
    delegatedCredentialHmacKeyRing = parseDelegatedCredentialHmacKeyRing(
      parsed.data.delegatedCredentialHmacKeys,
    );
  } catch {
    throw new Error(
      'Invalid platform Auth configuration: WISER_DELEGATED_CREDENTIAL_HMAC_KEYS.',
    );
  }
  return {
    mode,
    supabaseUrl: parsed.data.supabaseUrl,
    supabasePublishableKey: parsed.data.supabasePublishableKey,
    databaseUrl: parsed.data.databaseUrl,
    delegatedCredentialHmacKeyRing,
  };
}

function delegationClient(
  client: PoolClient,
): PlatformDelegationTransactionClient {
  return {
    async query<Row = Record<string, unknown>>(
      text: string,
      values: readonly unknown[] = [],
    ) {
      const result = await client.query(text, [...values]);
      return {
        rows: result.rows as readonly Row[],
        rowCount: result.rowCount,
      };
    },
    release() {
      client.release();
    },
  };
}

const defaultFactories: PlatformAuthRuntimeFactories = {
  createClaimsClient(config) {
    const client = createClient(
      config.supabaseUrl,
      config.supabasePublishableKey,
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      },
    );
    return {
      getClaims(token) {
        return client.auth.getClaims(token);
      },
    };
  },
  createAuthorizationDatabase(config) {
    const pool = new Pool({
      connectionString: config.databaseUrl,
      application_name: 'wiser-platform-auth',
      max: 5,
    });
    return {
      async query(text, values) {
        const result = await pool.query<AuthorizationRow & QueryResultRow>(
          text,
          [...values],
        );
        return { rows: result.rows };
      },
      async delegatedCredentialQuery(text, values) {
        const result = await pool.query<
          DelegatedCredentialAuthorizationRow & QueryResultRow
        >(text, [...values]);
        return { rows: result.rows };
      },
      transactionPool: {
        async connect() {
          return delegationClient(await pool.connect());
        },
      },
      async close() {
        await pool.end();
      },
    };
  },
};

const KNOWN_PLATFORM_SCOPES = new Set<string>([
  'platform.project.manage',
  'platform.delegation.manage',
  'excon.scenario.manage',
  'excon.run.manage',
  'excon.run.read',
  'excon.run-agent.act',
  'excon.telemetry.write',
  ...DATA_CAPABILITY_IDS.flatMap(
    (id) => DATA_CAPABILITY_REGISTRY[id].requiredScopes,
  ),
]);

export function createPlatformAuthRuntimeFromEnvironment(
  environment: NodeJS.ProcessEnv,
  factories: PlatformAuthRuntimeFactories = defaultFactories,
): PlatformAuthRuntime {
  const config = loadPlatformAuthRuntimeConfig(environment);
  if (config.mode === 'off') return { module: null, resolver: null };

  const claimsClient = factories.createClaimsClient(config);
  const database = factories.createAuthorizationDatabase(config);
  const jwtResolver = new SupabaseJwtPrincipalResolver({
    verifyClaims: createSupabaseJwtClaimsVerifier(claimsClient),
    loadAuthorization: createPostgresAuthorizationContextLoader(database.query),
  });
  const delegatedResolver = new DelegatedCredentialPrincipalResolver({
    keyRing: config.delegatedCredentialHmacKeyRing,
    knownScopes: KNOWN_PLATFORM_SCOPES,
    loadRecord: createPostgresDelegatedCredentialRecordLoader(
      database.delegatedCredentialQuery,
    ),
  });
  const resolver = new PlatformCredentialPrincipalResolver({
    jwt: jwtResolver,
    delegated: delegatedResolver,
  });
  const identityModule = createPlatformIdentityModule(resolver);
  const delegationModule = createPlatformDelegationModule({
    resolver,
    service: new PostgresPlatformDelegationService({
      pool: database.transactionPool,
      keyRing: config.delegatedCredentialHmacKeyRing,
      knownScopes: KNOWN_PLATFORM_SCOPES,
    }),
    knownScopes: KNOWN_PLATFORM_SCOPES,
  });
  const module: WiserApiModule = {
    id: 'platform.auth-runtime',
    async register(app) {
      await identityModule.register(app);
      await delegationModule.register(app);
      app.addHook('onClose', async () => {
        await database.close();
      });
    },
  };
  return { module, resolver };
}

export function createPlatformAuthModuleFromEnvironment(
  environment: NodeJS.ProcessEnv,
  factories: PlatformAuthRuntimeFactories = defaultFactories,
): WiserApiModule | null {
  return createPlatformAuthRuntimeFromEnvironment(environment, factories)
    .module;
}
