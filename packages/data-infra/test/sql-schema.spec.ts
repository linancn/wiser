import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

const MIGRATION_DIRECTORY = resolve(
  import.meta.dirname,
  '../../../infrastructure/data-foundation/postgres/migrations',
);

const AUTHORITATIVE_TABLES = [
  'catalog.data_item',
  'catalog.data_item_version',
  'catalog.asset',
  'catalog.schema_version',
  'catalog.field_definition',
  'catalog.source_provenance',
  'catalog.spatial_extent',
  'catalog.temporal_extent',
  'ingestion.session',
  'ingestion.input_asset',
  'ingestion.agent_run',
  'ingestion.agent_action',
  'ingestion.transform_plan',
  'ingestion.review',
  'ingestion.job',
  'ingestion.job_attempt',
  'quality.rule_definition',
  'quality.check_run',
  'quality.issue',
  'quality.scorecard',
  'lineage.process_run',
  'lineage.edge',
  'knowledge.evidence_fragment',
  'knowledge.assertion',
  'knowledge.review_record',
  'service.capability',
  'service.capability_version',
  'service.operation',
  'service.operation_event',
  'service.projection_status',
  'security.policy',
  'security.policy_binding',
  'security.audit_event',
  'event.outbox_event',
  'event.consumer_checkpoint',
] as const;

let sql = '';

beforeAll(async () => {
  const filenames = (await readdir(MIGRATION_DIRECTORY))
    .filter((filename) => filename.endsWith('.sql'))
    .sort();
  sql = (
    await Promise.all(
      filenames.map((filename) =>
        readFile(resolve(MIGRATION_DIRECTORY, filename), 'utf8'),
      ),
    )
  ).join('\n');
});

function tableBody(table: string): string {
  const escaped = table.replace('.', '\\.');
  const match = sql.match(
    new RegExp(
      `create table if not exists ${escaped}\\s*\\(([\\s\\S]*?)\\n\\);`,
      'i',
    ),
  );
  expect(match, `missing CREATE TABLE for ${table}`).not.toBeNull();
  return match?.[1] ?? '';
}

describe('authoritative Data Foundation SQL', () => {
  it('creates schema_migrations and every required authority table', () => {
    expect(sql).toMatch(
      /create table if not exists public\.schema_migrations/i,
    );
    for (const table of AUTHORITATIVE_TABLES) {
      expect(sql).toMatch(
        new RegExp(
          `create table if not exists ${table.replace('.', '\\.')}\\s*\\(`,
          'i',
        ),
      );
    }
  });

  it('pushes tenant, project, security, policy, and optimistic version filters into every authority table', () => {
    for (const table of AUTHORITATIVE_TABLES) {
      const body = tableBody(table);
      expect(body, `${table} tenant boundary`).toMatch(
        /\btenant_id uuid not null\b/i,
      );
      expect(body, `${table} project boundary`).toMatch(
        /\bproject_id uuid not null\b/i,
      );
      expect(body, `${table} security boundary`).toMatch(
        /\bsecurity_level text not null\b/i,
      );
      expect(body, `${table} policy boundary`).toMatch(
        /\bpolicy_version bigint not null\b/i,
      );
      expect(body, `${table} optimistic version`).toMatch(
        /\brow_version bigint not null\b/i,
      );
    }
  });

  it('keeps quality, acceptance, publication, and security as independent constrained dimensions', () => {
    const body = tableBody('catalog.data_item');
    expect(body).toMatch(/\bquality_grade text not null\b/i);
    expect(body).toMatch(/\bacceptance_status text not null\b/i);
    expect(body).toMatch(/\bpublication_status text not null\b/i);
    expect(body).toMatch(/\bsecurity_level text not null\b/i);
    expect(sql).toContain(
      "'L0_PUBLIC', 'L1_INTERNAL', 'L2_RESTRICTED', 'L3_CONFIDENTIAL'",
    );
    expect(sql).toContain(
      "'PENDING', 'PASSED', 'CONDITIONALLY_PASSED', 'CORRECTION_REQUIRED', 'ARCHIVED_ONLY', 'REJECTED'",
    );
  });

  it('preserves source geometry, uses CGCS2000 as canonical authority, and limits Web Mercator to display', () => {
    const body = tableBody('catalog.spatial_extent');
    expect(body).toMatch(/source_geometry geometry not null/i);
    expect(body).toMatch(/source_crs text not null/i);
    expect(body).toMatch(/canonical_geometry geometry\(Geometry,\s*4490\)/i);
    expect(body).toMatch(/canonical_crs text not null default 'EPSG:4490'/i);
    expect(body).toMatch(/display_geometry geometry\(Geometry,\s*3857\)/i);
  });

  it('initializes supported extensions and explicitly delegates pgSTAC to its official migrator', () => {
    expect(sql).toMatch(/create extension if not exists pgcrypto/i);
    expect(sql).toMatch(/create extension if not exists postgis/i);
    expect(sql).toMatch(/create extension if not exists btree_gist/i);
    expect(sql).toMatch(/create extension if not exists unaccent/i);
    expect(sql).not.toMatch(/create extension if not exists pgstac/i);
    expect(sql).toMatch(/to_regnamespace\('pgstac'\)/i);
    expect(sql).toMatch(/pypgstac migrate/i);
  });

  it('models durable leased jobs and claims work without blocking peers', () => {
    const body = tableBody('ingestion.job');
    for (const field of [
      'idempotency_key',
      'priority',
      'depends_on_job_id',
      'lease_owner',
      'lease_expires_at',
      'heartbeat_at',
      'attempt_count',
      'max_attempts',
      'next_attempt_at',
      'error_category',
      'cancel_requested_at',
      'timeout_at',
    ]) {
      expect(body, `ingestion.job.${field}`).toMatch(
        new RegExp(`\\b${field}\\b`, 'i'),
      );
    }
    expect(sql).toMatch(/for update skip locked/i);
    expect(sql).toContain("'WAITING_INPUT', 'WAITING_REVIEW', 'DEAD_LETTER'");
  });

  it('uses the shared operation states and immutable append-only event streams', () => {
    expect(sql).toContain(
      "'PENDING', 'RUNNING', 'WAITING_INPUT', 'WAITING_REVIEW', 'SUCCEEDED', 'FAILED', 'CANCELLED'",
    );
    expect(sql).toMatch(/create trigger operation_event_append_only/i);
    expect(sql).toMatch(/create trigger outbox_event_append_only/i);
    expect(sql).toMatch(
      /raise exception 'append-only relation % cannot be mutated'/i,
    );
  });

  it('enables forced RLS and indexes foreign-key and scoped access paths', () => {
    for (const table of AUTHORITATIVE_TABLES) {
      const escaped = table.replace('.', '\\.');
      expect(sql, `${table} RLS`).toMatch(
        new RegExp(`alter table ${escaped} enable row level security`, 'i'),
      );
      expect(sql, `${table} forced RLS`).toMatch(
        new RegExp(`alter table ${escaped} force row level security`, 'i'),
      );
    }
    expect(sql).toMatch(
      /create index .* on catalog\.data_item \(tenant_id, project_id, security_level/i,
    );
    expect(sql).toMatch(
      /create index .* on catalog\.data_item_version \(data_item_id/i,
    );
    expect(sql).toMatch(
      /create index .* on ingestion\.job \(depends_on_job_id/i,
    );
  });

  it('does not write across the Supabase control-plane boundary or use forbidden brokers', () => {
    expect(sql).not.toMatch(
      /\b(?:insert into|update|delete from)\s+(?:auth|platform|platform_private)\./i,
    );
    expect(sql).not.toMatch(
      /\b(?:dblink|postgres_fdw|http_post|net\.http|kafka|nats|redis|valkey|bullmq)\b/i,
    );
  });
});
