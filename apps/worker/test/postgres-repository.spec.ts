import { describe, expect, it, vi } from 'vitest';

import type { EvaluationResult } from '@agent-excon/core';
import { Pool, type PoolClient } from 'pg';

import {
  PostgresEvaluationRepository,
  type EvaluationWorkItem,
} from '../src/index.js';

const item: EvaluationWorkItem = {
  id: '42',
  episodeId: '50000000-0000-4000-8000-000000000001',
  submissionId: '90000000-0000-4000-8000-000000000001',
  attempts: 1,
  maxAttempts: 5,
  leaseExpiresAt: '2026-08-20T08:02:00.000Z',
  payload: {},
  recipientUserId: '10000000-0000-4000-8000-000000000001',
  episodeVirtualTime: '2023-03-22T07:10:00.000Z',
  isFinal: false,
  feedbackLevel: 2,
  rulesVersion: 'yongding-river-rules-v1',
  outcomeVersion: 'historical-replay-v1',
  input: {
    submission: {
      stage: 1,
      sourceReleases: [],
      expectedSectionFlows: [],
      isFinal: false,
    },
    sources: [],
    sectionTargets: [],
    transferModel: {
      guantingToSanjiadian: 0.9,
      sanjiadianToLugouqiao: 0.88,
      lugouqiaoToCuizhihuiying: 0.82,
      cuizhihuiyingToQujiadian: 0.9,
    },
    totalReleaseLimitM3s: 30,
    evidenceTimestamps: [],
    submittedVirtualTime: '2023-03-22T07:10:00.000Z',
  },
};

const metrics: EvaluationResult['metrics'] = {
  constraintCompliance: 0.8,
  ecologicalCoverage: 0.8,
  modelAccuracy: 0.8,
  evidenceCoverage: 0.8,
  timeTravelViolations: 0,
  totalScore: 80,
};

function setup() {
  const calls: Array<{
    readonly text: string;
    readonly values: readonly unknown[];
  }> = [];
  const client = {
    query: vi.fn((text: string, values: readonly unknown[] = []) => {
      calls.push({ text, values });
      if (/from excon_private\.evaluation_jobs[\s\S]+for update/.test(text)) {
        return Promise.resolve({ rowCount: 1, rows: [{ id: item.id }] });
      }
      if (/from public\.episodes[\s\S]+for update/.test(text)) {
        return Promise.resolve({
          rowCount: 1,
          rows: [
            {
              state: 'evaluating',
              virtual_time: new Date(item.episodeVirtualTime),
              last_event_seq: '7',
              last_event_hash: null,
            },
          ],
        });
      }
      if (/insert into excon_private\.evaluations/.test(text)) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{ id: 'e1000000-0000-4000-8000-000000000001' }],
        });
      }
      return Promise.resolve({ rowCount: 1, rows: [] });
    }),
    release: vi.fn(),
  };
  const pool = new Pool();
  Object.defineProperties(pool, {
    connect: {
      configurable: true,
      value: vi.fn(() => Promise.resolve(client as unknown as PoolClient)),
    },
    end: {
      configurable: true,
      value: vi.fn(() => Promise.resolve()),
    },
  });
  return {
    calls,
    client,
    repository: new PostgresEvaluationRepository(pool),
  };
}

describe('Postgres evaluation completion', () => {
  it.each([
    { isFinal: true, verdict: 'pass', expectedState: 'completed' },
    {
      isFinal: true,
      verdict: 'partial',
      expectedState: 'feedback_available',
    },
    {
      isFinal: true,
      verdict: 'fail',
      expectedState: 'feedback_available',
    },
    {
      isFinal: false,
      verdict: 'pass',
      expectedState: 'feedback_available',
    },
  ] as const)(
    'sets $expectedState for final=$isFinal verdict=$verdict',
    async ({ isFinal, verdict, expectedState }) => {
      const { calls, client, repository } = setup();

      await repository.complete(
        'worker-a',
        { ...item, isFinal },
        { verdict, metrics },
      );

      const episodeUpdate = calls.find(({ text }) =>
        /update public\.episodes/.test(text),
      );
      expect(episodeUpdate?.values[1]).toBe(expectedState);
      expect(calls.at(-1)?.text.trim()).toBe('commit');
      expect(client.release).toHaveBeenCalledOnce();
      await repository.close();
    },
  );
});
