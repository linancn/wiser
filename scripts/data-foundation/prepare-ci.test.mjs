import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareCiData } from './prepare-ci.mjs';

const environment = {
  GITHUB_ACTIONS: 'true',
  RUNNER_ENVIRONMENT: 'github-hosted',
};
const configuration = JSON.stringify({
  services: {
    api: { image: 'app:local', build: { context: '.' } },
    web: { image: 'app:local' },
    parser: { image: 'parser:local', build: { context: './parser' } },
    postgres: { image: 'postgres:pinned' },
  },
});
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('rejects local and self-hosted environments before touching a database', async () => {
  for (const env of [
    {},
    { CI: 'true' },
    { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'self-hosted' },
  ]) {
    await assert.rejects(
      prepareCiData({
        environment: env,
        command: () => assert.fail('must not run'),
      }),
      /disposable GitHub-hosted/,
    );
  }
});

test('validates merged Compose before starting independent Auth and image preparation', async () => {
  const calls = [];
  const auth = Promise.withResolvers();
  const browser = Promise.withResolvers();
  const build = Promise.withResolvers();
  let completed = false;
  const running = prepareCiData({
    environment,
    command: async (name, args, options) => {
      assert.equal(options.environment, environment);
      calls.push([name, ...args].join(' '));
      if (args.includes('config')) {
        assert.equal(options.capture, true);
        return configuration;
      }
      if (args.includes('build')) await build.promise;
      if (args.includes('supabase:start')) await auth.promise;
      if (args.includes('playwright')) await browser.promise;
    },
  }).then(() => {
    completed = true;
  });
  await tick();
  assert.deepEqual(calls, [
    'docker compose --profile data-foundation config --format json',
    'pnpm supabase:start',
    'pnpm --filter @wiser/web exec playwright install --with-deps chromium',
  ]);
  assert.equal(completed, false);
  auth.resolve();
  await tick();
  assert.equal(calls.at(-1), 'pnpm supabase:reset');
  assert.equal(completed, false);
  browser.resolve();
  await tick();
  assert.equal(
    calls.at(-1),
    'docker compose --profile data-foundation build api parser',
  );
  assert.equal(completed, false);
  build.resolve();
  await running;
  assert.equal(completed, true);
});

test('configuration failure prevents both preparation lanes', async () => {
  const calls = [];
  await assert.rejects(
    prepareCiData({
      environment,
      command: async (_, args) => {
        calls.push(args);
        throw new Error('invalid Compose');
      },
    }),
    /invalid Compose/,
  );
  assert.equal(calls.length, 1);
});

test('rejects incomplete service selections instead of expanding empty commands to every service', async () => {
  for (const services of [
    {},
    { postgres: { image: 'postgres:pinned' } },
    { api: { image: 'app:local', build: { context: '.' } } },
  ]) {
    const calls = [];
    await assert.rejects(
      prepareCiData({
        environment,
        command: async (_, args) => {
          calls.push(args);
          return JSON.stringify({ services });
        },
      }),
      /buildable and remote services/,
    );
    assert.equal(calls.length, 1);
  }
});

for (const failure of [
  'supabase:start',
  'supabase:reset',
  'playwright',
  'build',
]) {
  test(`propagates ${failure} failure only after every started lane has settled`, async () => {
    const calls = [];
    const other = Promise.withResolvers();
    let settled = false;
    const running = prepareCiData({
      environment,
      command: async (_, args) => {
        calls.push(args);
        if (args.includes('config')) return configuration;
        if (args.includes(failure)) throw new Error(failure);
        if (
          args.includes(
            ['build', 'playwright'].includes(failure)
              ? 'supabase:start'
              : 'playwright',
          )
        )
          await other.promise;
      },
    });
    const rejection = assert.rejects(running, (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors[0].message, failure);
      settled = true;
      return true;
    });
    await tick();
    assert.equal(settled, false);
    other.resolve();
    await rejection;
    if (failure === 'playwright')
      assert.ok(!calls.some((args) => args.includes('build')));
    if (failure === 'supabase:start')
      assert.ok(!calls.some((args) => args.includes('supabase:reset')));
  });
}
