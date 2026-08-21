import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSupabaseComposeEnvironment,
  parseSupabaseStatusEnvironment,
  signInLocalOperator,
} from './supabase-runtime.mjs';

const publishableKey = 'sb_publishable_1234567890abcdefghijklmnop';

test('parses only browser-safe Supabase runtime fields', () => {
  const status = parseSupabaseStatusEnvironment(`
ANON_KEY="legacy-anon"
API_URL="http://127.0.0.1:56321"
DB_URL="postgresql://postgres:postgres@127.0.0.1:56322/postgres"
PUBLISHABLE_KEY="${publishableKey}"
SECRET_KEY="must-not-escape"
SERVICE_ROLE_KEY="must-not-escape"
`);

  assert.deepEqual(status, {
    apiUrl: 'http://127.0.0.1:56321',
    databaseUrl:
      'postgresql://postgres:postgres@127.0.0.1:56322/postgres',
    publishableKey,
  });
  assert.doesNotMatch(JSON.stringify(status), /secret|service.role/i);
});

test('builds container and browser Auth contexts without privileged keys', () => {
  const environment = buildSupabaseComposeEnvironment(
    {
      apiUrl: 'http://127.0.0.1:56321',
      databaseUrl:
        'postgresql://postgres:postgres@127.0.0.1:56322/postgres',
      publishableKey,
    },
    {
      accessToken: 'operator-access-token-with-a-safe-minimum-length',
      delegatedCredentialHmacKeyRing:
        '{"activeKeyId":"local","keys":{"local":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}}',
    },
  );

  assert.equal(environment.WISER_AUTH_MODE, 'supabase');
  assert.equal(
    environment.SUPABASE_URL,
    'http://host.docker.internal:56321',
  );
  assert.equal(
    environment.DATABASE_URL,
    'postgresql://postgres:postgres@host.docker.internal:56322/postgres',
  );
  assert.equal(environment.NEXT_PUBLIC_SUPABASE_URL, statusApiUrl());
  assert.equal(environment.SUPABASE_PUBLISHABLE_KEY, publishableKey);
  assert.equal(environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, publishableKey);
  assert.equal(
    environment.DATA_API_BEARER_TOKEN,
    'operator-access-token-with-a-safe-minimum-length',
  );
  assert.equal(environment.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(environment.SUPABASE_SECRET_KEY, undefined);
});

test('signs in through the publishable Auth endpoint and bounds the response', async () => {
  const requests = [];
  const token = await signInLocalOperator(
    {
      apiUrl: statusApiUrl(),
      databaseUrl:
        'postgresql://postgres:postgres@127.0.0.1:56322/postgres',
      publishableKey,
    },
    {
      email: 'operator@agent-excon.test',
      password: 'local-test-password-only',
      fetch: async (url, init) => {
        requests.push({ url, init });
        return new Response(
          JSON.stringify({
            access_token: 'operator-access-token-with-a-safe-minimum-length',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    },
  );

  assert.equal(token, 'operator-access-token-with-a-safe-minimum-length');
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    `${statusApiUrl()}/auth/v1/token?grant_type=password`,
  );
  assert.equal(requests[0].init.headers.apikey, publishableKey);
  assert.equal(requests[0].init.headers.Authorization, `Bearer ${publishableKey}`);
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    email: 'operator@agent-excon.test',
    password: 'local-test-password-only',
  });
});

function statusApiUrl() {
  return 'http://127.0.0.1:56321';
}
