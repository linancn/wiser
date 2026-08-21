import { readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import {
  collectOperatorEvents,
  runWorkBuddyCookbook,
} from '../../cookbooks/workbuddy-yongding-tdd/scripts/run-cookbook.mjs';
import { hasCoordinatorFinalEvidence } from '../../cookbooks/workbuddy-yongding-tdd/scripts/scripted-participant.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('WorkBuddy Yongding cookbook runner', () => {
  it('combines early review responses with later authoritative acceptance', () => {
    const reviewResponseBatch = {
      receipts: ['water', 'hydraulic', 'ecological'].map((senderId) => ({
        resourceType: 'message',
        contentSnapshot: {
          kind: 'response',
          replyToMessageId: 'review-request-1',
          senderId,
        },
      })),
    };
    const acceptanceBatch = {
      receipts: [
        {
          resourceType: 'task',
          contentSnapshot: { state: 'ACCEPTED' },
        },
        {
          resourceType: 'feedback',
          contentSnapshot: { targetScope: 'team' },
        },
      ],
    };

    expect(
      hasCoordinatorFinalEvidence(
        [reviewResponseBatch, acceptanceBatch],
        'review-request-1',
      ),
    ).toBe(true);
    expect(
      hasCoordinatorFinalEvidence(
        [
          {
            receipts: Array.from({ length: 3 }, () => ({
              resourceType: 'message',
              contentSnapshot: {
                kind: 'response',
                replyToMessageId: 'review-request-1',
                senderId: 'water',
              },
            })),
          },
          acceptanceBatch,
        ],
        'review-request-1',
      ),
    ).toBe(false);
  });

  it('paginates the complete authoritative Event stream past 200 entries', async () => {
    const calls: number[] = [];
    const events = Array.from({ length: 229 }, (_, index) => ({
      runSeq: index + 1,
      eventType: index === 228 ? 'barrier.released' : 'receipt.acknowledged',
      payload: index === 228 ? { definitionKey: 'endorsement-ready' } : {},
    }));

    const result = await collectOperatorEvents((after, limit) => {
      calls.push(after);
      return Promise.resolve({
        items: events.filter(({ runSeq }) => runSeq > after).slice(0, limit),
      });
    });

    expect(calls).toEqual([0, 200]);
    expect(result.items).toHaveLength(229);
    expect(result.items.at(-1)).toMatchObject({ runSeq: 229 });
  });

  it('runs the scripted profile, verifies authoritative gates, and destroys credentials', async () => {
    const outputDirectory = join(
      tmpdir(),
      `wiser-cookbook-runner-${randomUUID()}`,
    );
    temporaryDirectories.push(outputDirectory);
    const result = await runWorkBuddyCookbook({
      environment: { ...process.env, NODE_ENV: 'test' },
      mode: 'scripted',
      outputDirectory,
      repositoryRoot: import.meta.dirname.replace(/\/tests\/cookbook$/, ''),
    });

    expect(
      result.exitCode,
      JSON.stringify(
        {
          diagnostic: result.report.diagnostic,
          participantResults: result.report.participantResults,
        },
        null,
        2,
      ),
    ).toBe(0);
    expect(result.report.status).toBe('passed');
    expect(result.report.authoritative.evaluations).toHaveLength(4);
    expect(
      result.report.authoritative.evaluations.every(
        ({ verdict }) => verdict === 'ACCEPTED',
      ),
    ).toBe(true);
    expect(result.report.authoritative.releasedBarriers).toEqual(
      expect.arrayContaining(['analysis-ready', 'endorsement-ready']),
    );
    expect(result.report.authoritative.interactions).toMatchObject({
      interactionCount: 11,
      handoffCount: 3,
      requestCount: 1,
      responseCount: 3,
      openRequestCount: 0,
    });
    expect(
      result.report.authoritative.interactions.acknowledgedDeliveryCount,
    ).toBeGreaterThanOrEqual(7);
    expect(result.report.observability).toEqual({
      bestEffort: true,
      gap: true,
      boundaryCoverage: 1,
      participantTelemetryMode: 'none',
      platformObservedSpanCount: 0,
      participantReportedSpanCount: 0,
      droppedSpanCount: 0,
      lateSpanCount: 0,
      traceCount: 0,
    });
    expect((await stat(result.reportPath)).mode & 0o777).toBe(0o600);
    const serialized = await readFile(result.reportPath, 'utf8');
    expect(serialized).not.toMatch(/wbl_[A-Za-z0-9_-]+/);
    expect(serialized).not.toContain('AGENT_EXCON_API_KEY');
    expect(serialized).not.toContain('leaseToken');
    await expect(
      stat(join(outputDirectory, 'lab', 'credentials')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      stat(join(outputDirectory, 'workbuddy', 'mcp')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  }, 40_000);

  it('turns an injected specialist schema failure into a scoped immutable rework successor', async () => {
    const outputDirectory = join(
      tmpdir(),
      `wiser-cookbook-rework-${randomUUID()}`,
    );
    temporaryDirectories.push(outputDirectory);
    const result = await runWorkBuddyCookbook({
      environment: { ...process.env, NODE_ENV: 'test' },
      faultInjection: 'water-evidence-schema-once',
      mode: 'scripted',
      outputDirectory,
      repositoryRoot: import.meta.dirname.replace(/\/tests\/cookbook$/, ''),
    });

    expect(
      result.exitCode,
      JSON.stringify(
        {
          diagnostic: result.report.diagnostic,
          participantResults: result.report.participantResults,
        },
        null,
        2,
      ),
    ).toBe(0);
    expect(result.report.tddCycle).toEqual({
      injectedFault: 'water-evidence-schema-once',
      reworkObserved: true,
      greenAccepted: true,
    });
    expect(
      result.report.authoritative.evaluations
        .filter(({ roleSlotId }) => roleSlotId === 'water-evidence')
        .map(({ verdict }) => verdict),
    ).toEqual(['REWORK_REQUIRED', 'ACCEPTED']);
    expect(result.report.authoritative.evaluations).toHaveLength(5);
  }, 40_000);
});
