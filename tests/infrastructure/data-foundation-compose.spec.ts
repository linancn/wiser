import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const compose = readFileSync(resolve(root, 'compose.yaml'), 'utf8');
const environment = readFileSync(resolve(root, '.env.example'), 'utf8');
const workflow = readFileSync(
  resolve(root, '.github/workflows/ci.yml'),
  'utf8',
);
const rootPackage = JSON.parse(
  readFileSync(resolve(root, 'package.json'), 'utf8'),
) as { readonly scripts: Readonly<Record<string, string>> };

const requiredProfileServices = [
  'data-postgres',
  'data-migrate',
  'data-object-store-init',
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
  const next = /\n {2}[a-z0-9][a-z0-9-]*:\n|\nnetworks:\n/.exec(
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
      expect(block, service).toMatch(/- data-foundation|<<: \*data-service/);
    }
    expect(compose).toMatch(/\n {2}data-foundation:\n\s+driver: bridge/);
    for (const sharedHost of ['api', 'web']) {
      expect(serviceBlock(sharedHost)).toContain('- data-foundation');
    }
    expect(compose).not.toMatch(/\n {2}supabase-[a-z0-9-]+:/);
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
      expect(block, service).toMatch(/<<: \*(?:data-service|app)/);
      expect(block, service).toContain('healthcheck:');
      expect(block, service).toContain('resources:');
      expect(block, service).toContain('logging:');
      for (const port of block.matchAll(/^\s+-\s+([^\s]+:[^\s]+)$/gm)) {
        expect(port[1], `${service} port`).toMatch(/^127\.0\.0\.1:/);
      }
      expect(block, service).not.toContain('network_mode: host');
    }
  });

  it('keeps credentialed GIS backends private behind the governed API proxy', () => {
    for (const service of ['geoserver', 'stac-api', 'titiler', 'martin']) {
      const block = serviceBlock(service);
      expect(block, service).not.toContain('ports:');
      expect(block, service).toContain('expose:');
    }
    expect(serviceBlock('api')).toContain('DATA_GEOSERVER_URL:');
    expect(serviceBlock('api')).toContain('DATA_TITILER_URL:');
    expect(serviceBlock('api')).toContain('DATA_MARTIN_URL:');
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

  it('wires the production Worker, trusted OpenSearch CA, and authority bucket bootstrap', () => {
    const worker = serviceBlock('data-worker');
    for (const name of [
      'DATA_WORKER_ACTOR_ID',
      'DATA_S3_ENDPOINT',
      'DATA_S3_BUCKET',
      'DATA_CLAMAV_HOST',
      'DATA_TIKA_ENDPOINT',
      'DATA_WEAVIATE_URL',
      'DATA_OPENSEARCH_URL',
      'DATA_NEO4J_URL',
      'DATA_STAC_API_URL',
      'DATA_STAC_ASSET_BASE_URL',
      'DATA_PROJECTION_CONSUMER_NAME',
      'DATA_FAKE_EMBEDDING_VERSION',
    ]) {
      expect(worker, name).toContain(`${name}:`);
    }
    for (const service of ['api', 'data-worker']) {
      const block = serviceBlock(service);
      expect(block, service).toContain(
        'NODE_EXTRA_CA_CERTS: /etc/wiser/opensearch/root-ca.pem',
      );
      expect(block, service).toContain('source: opensearch-ca');
    }
    const init = serviceBlock('data-object-store-init');
    expect(init).toContain('condition: service_healthy');
    expect(init).toContain('init-object-store');
    expect(worker).toContain('condition: service_completed_successfully');
    expect(compose).toMatch(/\n {2}opensearch-ca:\n/);
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

  it('runs the full Data Foundation profile in a recoverable CI job', () => {
    expect(workflow).toMatch(/\n {2}data-foundation:\n/);
    const job = workflow.slice(workflow.indexOf('\n  data-foundation:\n'));
    expect(job).toContain('pnpm install --frozen-lockfile');
    expect(job).toContain('pnpm data:up');
    expect(job).toContain('pnpm data:migrate');
    expect(job).toContain('pnpm data:smoke');
    expect(job).toContain('if: failure()');
    expect(job).toContain(
      'docker compose --profile data-foundation logs --no-color --tail=300',
    );
    for (const service of [
      'data-postgres',
      'data-worker',
      'weaviate',
      'opensearch',
      'neo4j',
      'geoserver',
      'stac-api',
      'titiler',
      'martin',
      'tika',
      'clamav',
      'api',
      'mcp-http',
    ]) {
      expect(job, service).toContain(service);
    }
    expect(job).toContain('if: always()');
    expect(job).toContain(
      'docker compose --profile data-foundation down --volumes --remove-orphans',
    );
  });
});
