#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

import { runMigrations } from './runner.js';

const connectionString = process.env.DATA_POSTGRES_URL;
if (connectionString === undefined || connectionString.length === 0) {
  throw new Error('DATA_POSTGRES_URL is required.');
}

const directory =
  process.env.DATA_POSTGRES_MIGRATIONS_DIRECTORY ??
  fileURLToPath(
    new URL(
      '../../../../infrastructure/data-foundation/postgres/migrations/',
      import.meta.url,
    ),
  );

const pool = new Pool({
  application_name: 'wiser-data-migrator',
  connectionString,
  max: 1,
});

try {
  const result = await runMigrations({ directory, pool });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await pool.end();
}
