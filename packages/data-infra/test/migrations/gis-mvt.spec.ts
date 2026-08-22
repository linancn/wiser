import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../../..');
const migrationPath = resolve(
  ROOT,
  'infrastructure/data-foundation/postgres/migrations/0008_governed_gis_tiles.sql',
);

describe('governed GIS tile migration', () => {
  it('defines one tenant/project/version-scoped Martin MVT function', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toMatch(
      /function\s+service\.wiser_spatial_extent_mvt\s*\(\s*z\s+integer,\s*x\s+integer,\s*y\s+integer,\s*query_params\s+json\s*\)/i,
    );
    expect(sql).toMatch(/returns\s+bytea/i);
    expect(sql).toMatch(/security\s+definer/i);
    expect(sql).toMatch(/set\s+search_path\s*=\s*pg_catalog\s*,\s*public/i);
    expect(sql).toMatch(/query_params\s*->>\s*'tenantId'/i);
    expect(sql).toMatch(/query_params\s*->>\s*'projectId'/i);
    expect(sql).toMatch(/query_params\s*->>\s*'versionId'/i);
    expect(sql).toMatch(/query_params\s*->>\s*'maxSecurityLevel'/i);
    expect(sql).toMatch(/query_params\s*->>\s*'policyVersion'/i);
    expect(sql).toMatch(/extent\.tenant_id\s*=\s*requested_tenant_id/i);
    expect(sql).toMatch(/extent\.project_id\s*=\s*requested_project_id/i);
    expect(sql).toMatch(/extent\.version_id\s*=\s*requested_version_id/i);
    expect(sql).toMatch(/version\.committed_at\s+is\s+not\s+null/i);
    expect(sql).toMatch(/st_asmvtgeom/i);
    expect(sql).toMatch(/st_asmvt/i);
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+function\s+service\.wiser_spatial_extent_mvt[\s\S]*?from\s+public/i,
    );
  });

  it('provisions Martin with an isolated non-bypass login and exact execute grant', async () => {
    const [provision, compose] = await Promise.all([
      readFile(
        resolve(
          ROOT,
          'infrastructure/data-foundation/postgres/provision-runtime.sql',
        ),
        'utf8',
      ),
      readFile(resolve(ROOT, 'compose.yaml'), 'utf8'),
    ]);

    expect(provision).toMatch(/wiser_data_gis\s+LOGIN/i);
    expect(provision).toMatch(
      /wiser_data_gis[\s\S]*?NOSUPERUSER[\s\S]*?NOBYPASSRLS/i,
    );
    expect(provision).toMatch(
      /grant\s+execute\s+on\s+function\s+service\.wiser_spatial_extent_mvt[\s\S]*?to\s+wiser_data_gis/i,
    );
    expect(provision).not.toMatch(
      /grant\s+wiser_data_runtime\s+to\s+wiser_data_gis/i,
    );
    expect(compose).toMatch(
      /martin:[\s\S]*?DATABASE_URL:\s*postgresql:\/\/wiser_data_gis:/,
    );
    expect(compose).not.toMatch(
      /martin:[\s\S]*?DATABASE_URL:\s*postgresql:\/\/wiser_data:/,
    );
  });
});
