import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';

const run = promisify(execFile);
const root = new URL('../../', import.meta.url);
const enabled = process.env.WISER_TEST_SEAWEEDFS_RESTART === '1';

// Opt-in live regression: isolated container, synthetic credentials, no host ports
// or business volumes. Uses the exact image and startup command from Compose.
test(
  'SeaweedFS retains objects through two restarts of the same container',
  {
    skip: !enabled,
    timeout: 180_000,
  },
  async () => {
    const docker = async (...args) =>
      (
        await run('docker', args, {
          cwd: root,
          timeout: 40_000,
          maxBuffer: 1024 * 1024,
        })
      ).stdout.trim();
    const config = JSON.parse(
      await docker(
        'compose',
        '-f',
        'compose.yaml',
        '-f',
        'compose.override.yaml',
        '--profile',
        'data-foundation',
        'config',
        '--format',
        'json',
      ),
    );
    const service = config.services.seaweedfs;
    const name = `wiser-storage-restart-test-${process.pid}`;
    let id;
    try {
      id = await docker(
        'create',
        '--name',
        name,
        '--network',
        'none',
        '--cap-drop',
        'ALL',
        ...service.cap_add.flatMap((cap) => ['--cap-add', cap]),
        '--security-opt',
        'no-new-privileges:true',
        '-e',
        'SEAWEEDFS_ACCESS_KEY=synthetic-access',
        '-e',
        'SEAWEEDFS_SECRET_KEY=synthetic-secret',
        '--entrypoint',
        service.entrypoint[0],
        service.image,
        ...service.entrypoint.slice(1),
        // Compose config preserves dollar escaping for serialization; direct
        // docker execution needs the shell command after Compose unescaping.
        ...service.command.map((part) => part.replaceAll('$$', '$')),
      );
      const ready = async () => {
        for (let attempt = 0; attempt < 40; attempt += 1) {
          const state = JSON.parse(
            await docker('inspect', '--format', '{{json .State}}', name),
          );
          assert.equal(
            state.Running,
            true,
            `container stopped with exit ${state.ExitCode}`,
          );
          try {
            await docker(
              'exec',
              name,
              'curl',
              '-fsS',
              'http://127.0.0.1:9333/cluster/status',
            );
            await docker(
              'exec',
              name,
              'curl',
              '-sS',
              '-o',
              '/dev/null',
              'http://127.0.0.1:8333/',
            );
            return;
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }
        assert.fail('isolated SeaweedFS did not become ready');
      };
      await docker('start', name);
      await ready();
      const configPath = service.command
        .join(' ')
        .match(/-s3\.config=(\S+)/)?.[1];
      assert.ok(configPath, 'startup identifies its configuration file');
      const directory = configPath.slice(0, configPath.lastIndexOf('/'));
      assert.equal(
        await docker('exec', name, 'stat', '-c', '%a:%U:%G', directory),
        '750:root:seaweed',
        'configuration parent must be private, root-owned and non-sticky',
      );
      assert.equal(
        await docker('exec', name, 'stat', '-c', '%a:%U:%G', configPath),
        '640:seaweed:seaweed',
      );
      const s3 = (...args) =>
        docker(
          'exec',
          name,
          'curl',
          '-fsS',
          '--aws-sigv4',
          'aws:amz:us-east-1:s3',
          '-H',
          `x-amz-content-sha256:${createHash('sha256')
            .update(
              args.includes('--data-binary')
                ? args[args.indexOf('--data-binary') + 1]
                : '',
            )
            .digest('hex')}`,
          '--user',
          'synthetic-access:synthetic-secret',
          ...args,
        );
      await s3('-X', 'PUT', 'http://127.0.0.1:8333/restart-test');
      await s3(
        '-X',
        'PUT',
        '--data-binary',
        'retained-object',
        'http://127.0.0.1:8333/restart-test/sentinel',
      );
      for (let cycle = 0; cycle < 2; cycle += 1) {
        await docker('restart', '--time', '5', name);
        await ready();
        assert.equal(await docker('inspect', '--format', '{{.Id}}', name), id);
        assert.equal(
          await s3(
            '--retry',
            '20',
            '--retry-delay',
            '1',
            '--retry-max-time',
            '25',
            'http://127.0.0.1:8333/restart-test/sentinel',
          ),
          'retained-object',
        );
      }
    } finally {
      if (id) await docker('rm', '-f', name);
    }
  },
);
