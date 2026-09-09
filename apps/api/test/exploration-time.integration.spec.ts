import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { recordProjection } from '../src/data-foundation/exploration-record-sql.js';
import { RecordQuerySchema } from '@wiser/data-contracts';

it.skipIf(process.env['WISER_DATA_PG_INTEGRATION'] !== '1')(
  'parses explicit-offset source times without normalization or session-timezone guesses',
  async () => {
    const pool = new Pool({
      connectionString: process.env['DATA_TEST_DATABASE_URL'],
      max: 1,
    });
    const client = await pool.connect();
    try {
      await client.query('begin');
      const migration = await readFile(
        'infrastructure/data-foundation/postgres/migrations/0018_exploration_time.sql',
        'utf8',
      ).catch((error: unknown) => {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'ENOENT'
        )
          return '';
        throw error;
      });
      if (migration) await client.query(migration);
      await client.query("set local timezone='America/New_York'");
      for (const [value, format, offset, expected] of [
        ['3/4/2023 16:45:00', 'dmy-local', 480, '2023-04-03T08:45:00.000000Z'],
        [
          '2023-04-03 16:45:00',
          'ymd-local',
          480,
          '2023-04-03T08:45:00.000000Z',
        ],
        [
          '2023-11-05T01:30:00-04:00',
          'iso-offset',
          0,
          '2023-11-05T05:30:00.000000Z',
        ],
        [
          '2023-11-05T01:30:00-05:00',
          'iso-offset',
          0,
          '2023-11-05T06:30:00.000000Z',
        ],
        [
          '29/2/2024 00:00:00.123456',
          'dmy-local',
          345,
          '2024-02-28T18:15:00.123456Z',
        ],
        ['31/2/2023 00:00:00', 'dmy-local', 0, null],
        ['3/4/2023 24:00:00', 'dmy-local', 0, null],
        ['3/4/2023 23:59:60', 'dmy-local', 0, null],
        ['2023-04-03T16:45:00.123456789Z', 'iso-offset', 0, null],
        ['2023-04-03T16:45:00', 'iso-offset', 0, null],
        [null, 'dmy-local', 0, null],
        [123, 'dmy-local', 0, null],
      ] as const) {
        const output = await client.query<{ parsed: string | null }>(
          `select to_char(service.exploration_time($1::jsonb,$2,$3) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') parsed`,
          [JSON.stringify(value), format, offset],
        );
        expect(output.rows[0]?.['parsed']).toBe(expected);
      }
      const filters = [
        {
          field: 'time',
          type: 'time',
          format: 'dmy-local',
          utcOffsetMinutes: 480,
          operator: 'gte',
          value: '2023-03-31T16:00:00Z',
        },
        {
          field: 'time',
          type: 'time',
          format: 'dmy-local',
          utcOffsetMinutes: 480,
          operator: 'lt',
          value: '2023-04-30T16:00:00Z',
        },
      ];
      const matched = await client.query(
        `select service.exploration_record_matches($1::jsonb,$2::jsonb) accepted, service.exploration_record_matches($3::jsonb,$2::jsonb) excluded`,
        [
          JSON.stringify({ time: '3/4/2023 16:45:00' }),
          JSON.stringify(filters),
          JSON.stringify({ time: '1/5/2023 00:00:00' }),
        ],
      );
      expect(matched.rows[0]).toEqual({ accepted: true, excluded: false });
      const configured = RecordQuerySchema.parse({
        assetId: '10000000-0000-4000-8000-000000000001',
        filters,
      });
      const parameters: unknown[] = [];
      const projection = recordProjection(parameters);
      const compiled = projection.predicates(configured.filters);
      expect(projection.expressions).toHaveLength(1);
      const records = projection.bind(
        JSON.stringify([
          { time: '3/4/2023 16:45:00' },
          { time: '1/5/2023 00:00:00' },
          { time: '31/2/2023 00:00:00' },
        ]),
        'jsonb',
      );
      const selected = await client.query<{ count: number }>(
        `with valued as materialized (select ${projection.expressions.join(',')} from jsonb_array_elements(${records}) r(record_values)) select count(*)::integer count from valued where ${compiled.join(' and ')}`,
        parameters,
      );
      expect(selected.rows[0]?.['count']).toBe(1);
    } finally {
      await client.query('rollback');
      client.release();
      await pool.end();
    }
  },
);
