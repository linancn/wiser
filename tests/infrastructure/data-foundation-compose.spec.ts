import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const compose = readFileSync(resolve(root, 'compose.yaml'), 'utf8');
const environment = readFileSync(resolve(root, '.env.example'), 'utf8');
const rootPackage = JSON.parse(
  readFileSync(resolve(root, 'package.json'), 'utf8'),
) as { readonly scripts: Readonly<Record<string, string>> };

const requiredProfileServices = [
  'data-postgres',
  'data-migrate',
  'seaweedfs',
  'weaviate',
  'opensearch',
  'opensearch-dashboards',
  'neo4j',
  'geoserver',
  'stac-api',
  'titiler',
  'martin',
  'tika',
  'clamav',
  'data-worker',
  'mcp-http',
] as const;

const externalServices = [
  'data-postgres',
  'seaweedfs',
  'weaviate',
  'opensearch',
  'opensearch-dashboards',
  'neo4j',
  'geoserver',
  'stac-api',
  'titiler',
  'martin',
  'tika',
  'clamav',
] as const;

function serviceBlock(name: string): string {
  const start = compose.indexOf(`\n  ${name}:\n`);
  if (start < 0) return '';
  const remaining = compose.slice(start + 1);
  const next = /\n  [a-z0-9][a-z0-9-]*:\n|\nnetworks:\n/.exec(
    remaining.slice(`  ${name}:\n`.length),
  );
  return remaining.slice(
    0,
    next === null ? undefined : `  ${name}:\n`.length + next.index,
  );
}

describe('Data Foundation Compose profile', () => {
  it('contains every required service on the dedicated network', () => {
    for (const service of requiredProfileServices) {
      const block = serviceBlock(service);
      expect(block, service).not.toBe('');
      expect(block, service).toContain('profiles: [data-foundation]');
      expect(block, service).toContain('- data-foundation');
    }
    expect(compose).toMatch(/\n  data-foundation:\n\s+driver: bridge/);
    for (const sharedHost of ['api', 'web']) {
      expect(serviceBlock(sharedHost)).toContain('- data-foundation');
    }
    expect(compose).not.toMatch(/\n  supabase-[a-z0-9-]+:/);
  });

  it('pins every external image to a stable tag and digest', () => {
    expect(
      existsSync(resolve(root, 'infrastructure/data-foundation/versions.env')),
    ).toBe(true);
    for (const service of externalServices) {
      const image = /^\s+image:\s+([^\s]+)$/m.exec(serviceBlock(service))?.[1];
      expect(image, service).toMatch(
        /^[^:@\s]+(?:\/[^:@\s]+)*:[^@\s]+@sha256:[a-f0-9]{64}$/,
      );
      expect(image, service).not.toMatch(
        /:latest@|-(?:rc|beta|alpha|nightly)/i,
      );
    }
  });

  it('hardens long-running services with health, resources, logs, and local ports', () => {
    for (const service of [...externalServices, 'data-worker', 'mcp-http']) {
      const block = serviceBlock(service);
      expect(block, service).toContain('restart: unless-stopped');
      expect(block, service).toContain('no-new-privileges:true');
      expect(block, service).toContain('- ALL');
      expect(block, service).toContain('healthcheck:');
      expect(block, service).toContain('resources:');
      expect(block, service).toContain('logging:');
      for (const port of block.matchAll(/^\s+-\s+([^\s]+:[^\s]+)$/gm)) {
        expect(port[1], `${service} port`).toMatch(/^127\.0\.0\.1:/);
      }
      expect(block, service).not.toContain('network_mode: host');
    }
  });

  it('uses named persistence and one-shot migrations without default passwords', () => {
    for (const service of [
      'data-postgres',
      'seaweedfs',
      'weaviate',
      'opensearch',
      'opensearch-dashboards',
      'neo4j',
      'geoserver',
    ]) {
      expect(serviceBlock(service), service).toContain('volumes:');
    }
    expect(serviceBlock('data-migrate')).toContain(
      'condition: service_healthy',
    );
    expect(compose).not.toMatch(
      /(?:PASSWORD|SECRET):\s*(?:postgres|password|neo4j)?\s*$/m,
    );
  });
});

describe('Data Foundation operations contract', () => {
  it('documents every required server-side environment variable', () => {
    for (const name of [
      'DATA_DATABASE_URL',
      'DATA_DATABASE_MIGRATION_URL',
      'DATA_S3_ENDPOINT',
      'DATA_S3_REGION',
      'DATA_S3_ACCESS_KEY_ID',
      'DATA_S3_SECRET_ACCESS_KEY',
      'DATA_S3_BUCKET',
      'WEAVIATE_URL',
      'WEAVIATE_API_KEY',
      'OPENSEARCH_URL',
      'OPENSEARCH_USERNAME',
      'OPENSEARCH_PASSWORD',
      'NEO4J_URL',
      'NEO4J_USERNAME',
      'NEO4J_PASSWORD',
      'GEOSERVER_URL',
      'GEOSERVER_USERNAME',
      'GEOSERVER_PASSWORD',
      'STAC_API_URL',
      'TITILER_URL',
      'MARTIN_URL',
      'TIKA_URL',
      'CLAMAV_HOST',
      'CLAMAV_PORT',
      'DATA_WORKER_ID',
      'DATA_WORKER_HEALTH_HOST',
      'DATA_WORKER_HEALTH_PORT',
      'DATA_JOB_LEASE_SECONDS',
      'DATA_MCP_TRANSPORT',
      'DATA_MCP_HOST',
      'DATA_MCP_PORT',
    ]) {
      expect(environment, name).toMatch(new RegExp(`^${name}=`, 'm'));
    }
  });

  it('provides root lifecycle, migration, smoke, and verification commands', () => {
    for (const script of [
      'data:up',
      'data:down',
      'data:reset',
      'data:logs',
      'data:migrate',
      'data:seed',
      'data:smoke',
      'data:verify',
      'stack:full:up',
    ]) {
      expect(rootPackage.scripts[script], script).toBeTruthy();
    }
    expect(rootPackage.scripts['data:up']).toContain(
      '--profile data-foundation',
    );
    expect(rootPackage.scripts['data:reset']).toContain('--volumes');
  });
});
