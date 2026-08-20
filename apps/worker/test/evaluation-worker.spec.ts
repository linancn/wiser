import { describe, expect, it } from 'vitest';

import type { EvaluationResult } from '@agent-excon/core';

import {
  EvaluationWorker,
  type ClaimedEvaluationJob,
  type EvaluationRepository,
  type EvaluationWorkItem,
  type FailureDisposition,
  type StructuredLogger,
} from '../src/index.js';

const job: ClaimedEvaluationJob = {
  id: '42',
  episodeId: '50000000-0000-4000-8000-000000000001',
  submissionId: '90000000-0000-4000-8000-000000000001',
  attempts: 1,
  maxAttempts: 5,
  leaseExpiresAt: '2026-08-20T08:02:00.000Z',
  payload: {},
};

const workItem: EvaluationWorkItem = {
  ...job,
  recipientUserId: '10000000-0000-4000-8000-000000000001',
  episodeVirtualTime: '2023-03-22T07:10:00.000Z',
  isFinal: false,
  feedbackLevel: 2,
  rulesVersion: 'yongding-river-rules-v1',
  outcomeVersion: 'historical-replay-v1',
  input: {
    submission: {
      stage: 1,
      sourceReleases: [
        {
          sourceId: 'guanting',
          flowM3s: 20,
          evidenceRefs: [
            'official-flow-20230322-guanting',
            'simulated-rules-20230322-stage-1',
          ],
        },
        {
          sourceId: 'south-water',
          flowM3s: 1,
          evidenceRefs: [
            'simulated-source-limit-20230322-south-water',
            'simulated-rules-20230322-stage-1',
          ],
        },
        {
          sourceId: 'reclaimed-lower',
          flowM3s: 2.5,
          evidenceRefs: [
            'simulated-source-limit-20230322-reclaimed-lower',
            'simulated-rules-20230322-stage-1',
          ],
        },
      ],
      expectedSectionFlows: [
        { sectionId: 'sanjiadian', flowM3s: 18 },
        { sectionId: 'lugouqiao', flowM3s: 16.72 },
        { sectionId: 'cuizhihuiying', flowM3s: 15.7604 },
        { sectionId: 'qujiadian', flowM3s: 14.18436 },
      ],
      isFinal: false,
    },
    sources: [
      { sourceId: 'guanting', maximumFlowM3s: 24 },
      { sourceId: 'south-water', maximumFlowM3s: 10 },
      { sourceId: 'reclaimed-lower', maximumFlowM3s: 6 },
    ],
    sectionTargets: [
      { sectionId: 'sanjiadian', minimumFlowM3s: 10 },
      { sectionId: 'lugouqiao', minimumFlowM3s: 16 },
      { sectionId: 'cuizhihuiying', minimumFlowM3s: 15 },
      { sectionId: 'qujiadian', minimumFlowM3s: 12 },
    ],
    transferModel: {
      guantingToSanjiadian: 0.9,
      sanjiadianToLugouqiao: 0.88,
      lugouqiaoToCuizhihuiying: 0.82,
      cuizhihuiyingToQujiadian: 0.9,
    },
    totalReleaseLimitM3s: 30,
    evidenceTimestamps: [
      {
        informationId: 'official-flow-20230322-guanting',
        accessedVirtualTime: '2023-03-22T07:01:00.000Z',
      },
      {
        informationId: 'simulated-source-limit-20230322-south-water',
        accessedVirtualTime: '2023-03-22T07:02:00.000Z',
      },
      {
        informationId: 'simulated-source-limit-20230322-reclaimed-lower',
        accessedVirtualTime: '2023-03-22T07:03:00.000Z',
      },
    ],
    submittedVirtualTime: '2023-03-22T07:10:00.000Z',
  },
};

class FakeRepository implements EvaluationRepository {
  readonly events: string[] = [];
  readonly completions: EvaluationResult[] = [];
  readonly failures: string[] = [];
  jobs: ClaimedEvaluationJob[] = [job];
  item: EvaluationWorkItem = workItem;
  loadError?: Error;
  failureDisposition: FailureDisposition = 'retry_scheduled';

  recoverExpiredLeases(): Promise<number> {
    this.events.push('recover');
    return Promise.resolve(0);
  }

  claim(): Promise<readonly ClaimedEvaluationJob[]> {
    this.events.push('claim');
    const claimed = this.jobs;
    this.jobs = [];
    return Promise.resolve(claimed);
  }

  load(): Promise<EvaluationWorkItem> {
    this.events.push('load');
    if (this.loadError) return Promise.reject(this.loadError);
    return Promise.resolve(this.item);
  }

  complete(
    _workerId: string,
    _item: EvaluationWorkItem,
    result: EvaluationResult,
  ): Promise<void> {
    this.events.push('complete');
    this.completions.push(result);
    return Promise.resolve();
  }

  fail(
    _workerId: string,
    _job: ClaimedEvaluationJob,
    errorCode: string,
  ): Promise<FailureDisposition> {
    this.events.push('fail');
    this.failures.push(errorCode);
    return Promise.resolve(this.failureDisposition);
  }

  close(): Promise<void> {
    this.events.push('close');
    return Promise.resolve();
  }
}

class MemoryLogger implements StructuredLogger {
  readonly records: Array<{ level: string; event: string }> = [];

  info(event: string): void {
    this.records.push({ level: 'info', event });
  }

  warn(event: string): void {
    this.records.push({ level: 'warn', event });
  }

  error(event: string): void {
    this.records.push({ level: 'error', event });
  }
}

describe('evaluation worker', () => {
  it('recovers leases, claims work, evaluates outside completion, and persists atomically', async () => {
    const repository = new FakeRepository();
    const logger = new MemoryLogger();
    const worker = new EvaluationWorker({
      repository,
      logger,
      workerId: 'worker-a',
      claimLimit: 1,
      leaseMs: 120_000,
      pollIntervalMs: 10,
    });

    await expect(worker.processOnce()).resolves.toBe(1);

    expect(repository.events).toEqual(['recover', 'claim', 'load', 'complete']);
    expect(repository.completions).toEqual([
      {
        verdict: 'pass',
        metrics: {
          constraintCompliance: 1,
          ecologicalCoverage: 1,
          modelAccuracy: 1,
          evidenceCoverage: 1,
          timeTravelViolations: 0,
          totalScore: 100,
        },
      },
    ]);
    expect(worker.health().completedJobs).toBe(1);
    expect(worker.health().ready).toBe(true);
  });

  it('returns a failed job to the repository retry policy without completing it', async () => {
    const repository = new FakeRepository();
    repository.loadError = new Error('invalid evaluation input');
    const worker = new EvaluationWorker({
      repository,
      logger: new MemoryLogger(),
      workerId: 'worker-b',
      claimLimit: 1,
      leaseMs: 120_000,
      pollIntervalMs: 10,
    });

    await expect(worker.processOnce()).resolves.toBe(1);

    expect(repository.events).toEqual(['recover', 'claim', 'load', 'fail']);
    expect(repository.completions).toHaveLength(0);
    expect(repository.failures).toEqual(['INVALID_EVALUATION_INPUT']);
    expect(worker.health()).toMatchObject({
      failedJobs: 1,
      lastErrorCode: 'INVALID_EVALUATION_INPUT',
      inFlightJobs: 0,
    });
  });

  it('waits for an in-flight evaluation before closing during graceful shutdown', async () => {
    const repository = new FakeRepository();
    let releaseLoad: (() => void) | undefined;
    const pendingLoad = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    repository.load = async () => {
      repository.events.push('load');
      await pendingLoad;
      return workItem;
    };
    const worker = new EvaluationWorker({
      repository,
      logger: new MemoryLogger(),
      workerId: 'worker-c',
      claimLimit: 1,
      leaseMs: 120_000,
      pollIntervalMs: 10,
    });

    const processing = worker.processOnce();
    await Promise.resolve();
    await Promise.resolve();
    const stopping = worker.stop();
    expect(repository.events).not.toContain('close');

    releaseLoad?.();
    await processing;
    await stopping;

    expect(repository.events.at(-1)).toBe('close');
    expect(worker.health()).toMatchObject({
      phase: 'stopped',
      live: false,
      ready: false,
    });
  });
});
