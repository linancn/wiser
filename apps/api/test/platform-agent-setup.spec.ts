import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createAgentSetupModule } from '../src/platform/agent-setup.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('public Agent setup delivery', () => {
  it('serves the Skill and its runnable dependencies through a content-pinned manifest', async () => {
    const app = buildApp({
      logger: false,
      modules: [
        createAgentSetupModule({
          publicApiOrigin: 'https://api.wiser.example',
          mcpResource: 'https://agent.wiser.example/mcp',
        }),
      ],
    });
    apps.push(app);
    const response = await app.inject('/agent-setup/manifest.json');
    expect(response.statusCode).toBe(200);
    const manifest = response.json<{
      release: string;
      files: { path: string; url: string; sha256: string; sizeBytes: number }[];
    }>();
    expect(manifest.files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        'SKILL.md',
        'scripts/water_bundle.py',
        'scripts/water_import.py',
        'scripts/analyze_bundle.py',
        'references/water-bundle.md',
      ]),
    );
    for (const file of manifest.files) {
      const resource = await app.inject(new URL(file.url).pathname);
      expect(resource.statusCode).toBe(200);
      expect(resource.headers['cache-control']).toContain('immutable');
      expect(resource.rawPayload.byteLength).toBe(file.sizeBytes);
      expect(
        createHash('sha256').update(resource.rawPayload).digest('hex'),
      ).toBe(file.sha256);
    }
    const prompt = await app.inject('/agent-setup/prompt.md');
    expect(prompt.statusCode).toBe(200);
    expect(prompt.body).toContain(
      'https://api.wiser.example/agent-setup/manifest.json',
    );
    expect(prompt.body).toContain('https://agent.wiser.example/mcp');
    expect(prompt.body).toContain('SHA-256');
    expect(prompt.body).not.toContain('Bearer ');
    for (const path of [
      `/agent-setup/releases/${manifest.release}/.env`,
      `/agent-setup/releases/${'0'.repeat(64)}/SKILL.md`,
      `/agent-setup/releases/${manifest.release}/scripts/test_water_bundle.py`,
    ])
      expect((await app.inject(path)).statusCode).toBe(404);
  });

  it('rejects unsafe public configuration instead of publishing internal hosts or credentials', () => {
    for (const publicApiOrigin of [
      'http://api:3001',
      'https://user:secret@example.com',
      'https://example.com/?token=secret',
    ]) {
      expect(() => createAgentSetupModule({ publicApiOrigin })).toThrow();
    }
  });
});
