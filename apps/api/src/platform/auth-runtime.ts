import { createClient } from '@supabase/supabase-js';
import { Pool, type QueryResultRow } from 'pg';
import { z } from 'zod';

import {
  SupabaseJwtPrincipalResolver,
  createPostgresAuthorizationContextLoader,
  createSupabaseJwtClaimsVerifier,
  type AuthorizationQuery,
  type AuthorizationRow,
  type SupabaseClaimsClient,
} from '@wiser/platform-auth';

import { createPlatformIdentityModule } from './identity-module.js';
import type { WiserApiModule } from './modules.js';

export type PlatformAuthRuntimeConfig =
  | { readonly mode: 'off' }
  | {
      readonly mode: 'supabase';
      readonly supabaseUrl: string;
      readonly supabasePublishableKey: string;
      readonly databaseUrl: string;
    };

export interface AuthorizationDatabase {
  readonly query: AuthorizationQuery;
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
});

function environmentField(path: PropertyKey | undefined): string {
  switch (path) {
    case 'supabaseUrl':
      return 'SUPABASE_URL';
    case 'supabasePublishableKey':
      return 'SUPABASE_PUBLISHABLE_KEY';
    case 'databaseUrl':
      return 'DATABASE_URL';
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
  });
  if (!parsed.success) {
    const fields = parsed.error.issues
      .map((issue) => environmentField(issue.path[0]))
      .join(', ');
    throw new Error(`Invalid platform Auth configuration: ${fields}.`);
  }
  return { mode, ...parsed.data };
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
      async close() {
        await pool.end();
      },
    };
  },
};

export function createPlatformAuthModuleFromEnvironment(
  environment: NodeJS.ProcessEnv,
  factories: PlatformAuthRuntimeFactories = defaultFactories,
): WiserApiModule | null {
  const config = loadPlatformAuthRuntimeConfig(environment);
  if (config.mode === 'off') return null;

  const claimsClient = factories.createClaimsClient(config);
  const database = factories.createAuthorizationDatabase(config);
  const resolver = new SupabaseJwtPrincipalResolver({
    verifyClaims: createSupabaseJwtClaimsVerifier(claimsClient),
    loadAuthorization: createPostgresAuthorizationContextLoader(database.query),
  });
  const identityModule = createPlatformIdentityModule(resolver);
  return {
    ...identityModule,
    async register(app) {
      await identityModule.register(app);
      app.addHook('onClose', async () => {
        await database.close();
      });
    },
  };
}
