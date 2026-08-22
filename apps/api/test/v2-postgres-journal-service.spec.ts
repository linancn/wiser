import { readFileSync } from 'node:fs';

import type {
  RunArtifactDto,
  RunSubmissionDto,
  RunTaskDto,
} from '@agent-excon/contracts';
import { describe, expect, it } from 'vitest';

import {
  V2_JOURNALED_MUTATIONS,
  V2JournalError,
  createPostgresV2JournalService,
  type V2JournalClient,
  type V2JournalPool,
} from '../src/v2-postgres-journal-service.js';
import { DEFAULT_V2_SCENARIO_VERSION_ID } from '../src/v2-in-memory-service.js';
import type { ParticipantPrincipal } from '../src/types.js';
import type { V2ExerciseService } from '../src/v2-types.js';

interface IntentRow {
  readonly intentSeq: number;
  readonly intentId: string;
  readonly commandName: string;
  readonly journalVersion: number;
  readonly requestHash: string;
  readonly principal: unknown;
  readonly arguments: unknown;
  readonly leaseKeyId: string;
}

interface OutcomeRow {
  readonly outcomeSeq: number;
  readonly intentId: string;
  resultHash: string;
  readonly status: 'succeeded' | 'rejected';
  readonly errorCode: string | null;
  readonly generatedIds: unknown;
  readonly generatedTimestamps: unknown;
  readonly leaseCounterCount: number;
}

class MemoryJournalDatabase {
  readonly intents: IntentRow[] = [];
  readonly outcomes: OutcomeRow[] = [];
  lockOwner: number | undefined;
  failIntent = false;
  failOutcome = false;
  failRelease = false;
  releaseAttempts = 0;

  rows(): readonly Record<string, unknown>[] {
    return this.intents.map((intent) => {
      const outcome = this.outcomes.find(
        ({ intentId }) => intentId === intent.intentId,
      );
      return {
        intent_seq: intent.intentSeq,
        intent_id: intent.intentId,
        command_name: intent.commandName,
        journal_version: intent.journalVersion,
        request_hash: intent.requestHash,
        principal: intent.principal,
        arguments: intent.arguments,
        lease_key_id: intent.leaseKeyId,
        outcome_seq: outcome?.outcomeSeq ?? null,
        outcome_status: outcome?.status ?? null,
        result_hash: outcome?.resultHash ?? null,
        error_code: outcome?.errorCode ?? null,
        generated_ids: outcome?.generatedIds ?? null,
        generated_timestamps: outcome?.generatedTimestamps ?? null,
        lease_counter_count: outcome?.leaseCounterCount ?? null,
      };
    });
  }
}

let nextConnectionId = 0;

class MemoryJournalPool implements V2JournalPool {
  readonly connectionId = ++nextConnectionId;
  ended = false;

  constructor(readonly database: MemoryJournalDatabase) {}

  connect(): Promise<V2JournalClient> {
    const connectionId = this.connectionId;
    const database = this.database;
    let released = false;
    return Promise.resolve({
      query(text, values = []) {
        if (released) return Promise.reject(new Error('released client'));
        if (text.includes('v2.journal.writer-lock.acquire')) {
          const acquired =
            database.lockOwner === undefined ||
            database.lockOwner === connectionId;
          if (acquired) database.lockOwner = connectionId;
          return Promise.resolve({ rows: [{ acquired }], rowCount: 1 });
        }
        if (text.includes('v2.journal.writer-lock.release')) {
          const releasedLock = database.lockOwner === connectionId;
          if (releasedLock) database.lockOwner = undefined;
          return Promise.resolve({
            rows: [{ released: releasedLock }],
            rowCount: 1,
          });
        }
        if (text.includes('v2.journal.load')) {
          return Promise.resolve({
            rows: database.rows(),
            rowCount: database.intents.length,
          });
        }
        if (text.includes('v2.journal.intent.insert')) {
          if (database.failIntent) {
            return Promise.reject(new Error('private intent database detail'));
          }
          database.intents.push({
            intentSeq: database.intents.length + 1,
            intentId: String(values[0]),
            commandName: String(values[1]),
            journalVersion: Number(values[2]),
            requestHash: String(values[3]),
            principal: JSON.parse(String(values[4])) as unknown,
            arguments: JSON.parse(String(values[5])) as unknown,
            leaseKeyId: String(values[6]),
          });
          return Promise.resolve({
            rows: [{ intent_seq: database.intents.length }],
            rowCount: 1,
          });
        }
        if (text.includes('v2.journal.outcome.insert')) {
          if (database.failOutcome) {
            return Promise.reject(new Error('private outcome database detail'));
          }
          database.outcomes.push({
            outcomeSeq: database.outcomes.length + 1,
            intentId: String(values[0]),
            status: String(values[1]) as OutcomeRow['status'],
            resultHash: String(values[2]),
            errorCode:
              values[3] === null || values[3] === undefined
                ? null
                : typeof values[3] === 'string'
                  ? values[3]
                  : 'invalid',
            generatedIds: JSON.parse(String(values[4])) as unknown,
            generatedTimestamps: JSON.parse(String(values[5])) as unknown,
            leaseCounterCount: Number(values[6]),
          });
          return Promise.resolve({
            rows: [{ outcome_seq: database.outcomes.length }],
            rowCount: 1,
          });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      },
      release() {
        database.releaseAttempts += 1;
        if (database.failRelease) throw new Error('release failed');
        released = true;
      },
    });
  }

  end(): Promise<void> {
    this.ended = true;
    return Promise.resolve();
  }
}

const operator: ParticipantPrincipal = {
  id: 'journal-test-operator',
  participantVersionIds: [],
  roles: ['operator'],
};

const roles = [
  'water-evidence',
  'hydraulic-constraints',
  'ecological-target',
  'dispatch-coordination',
] as const;

const localized = (value: string) => ({
  'zh-CN': `中文 ${value}`,
  en: `English ${value}`,
});

function deterministicValues(start = 0) {
  let sequence = start;
  return {
    idFactory: () => {
      sequence += 1;
      return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
    },
    intentIdFactory: () => {
      sequence += 1;
      return `90000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
    },
    now: () => new Date('2026-08-22T08:00:00.000Z'),
  };
}

function open(
  database: MemoryJournalDatabase,
  start = 0,
  overrides: Partial<ReturnType<typeof deterministicValues>> = {},
) {
  const values = { ...deterministicValues(start), ...overrides };
  const pool = new MemoryJournalPool(database);
  return {
    pool,
    service: createPostgresV2JournalService({
      pool,
      idFactory: values.idFactory,
      intentIdFactory: values.intentIdFactory,
      now: values.now,
      activeLeaseHmacKeyId: 'local-v1',
      leaseHmacKeys: {
        'local-v1': 'journal-test-hmac-key-with-at-least-32-bytes',
      },
    }),
  };
}

async function prepareCollaboration(service: V2ExerciseService) {
  const { scenario } = await service.createScenario(
    operator,
    'scenario-create',
    {
      slug: 'journal-roundtrip-scenario',
      title: localized('journal scenario'),
      description: localized('journal scenario description'),
      region: localized('journal scenario region'),
      simulationOnly: true,
    },
  );
  const { scenarioVersion: draftScenarioVersion } =
    await service.createScenarioVersion(
      operator,
      scenario.id,
      'scenario-version-create',
      {
        expectedScenarioVersion: scenario.version,
        label: 'journal-v1',
        summary: localized('journal scenario version'),
        replayStartAt: '2026-08-22T08:00:00.000Z',
        minDistinctRequiredAgents: roles.length,
        requiredRoles: roles.map((id) => ({
          id,
          name: localized(id),
          mission: localized(`${id}-mission`),
          expectedArtifact: localized(`${id}-artifact`),
        })),
      },
    );
  const { scenarioVersion: validatedScenarioVersion } =
    await service.validateScenarioVersion(
      operator,
      draftScenarioVersion.id,
      'scenario-version-validate',
      { expectedVersion: draftScenarioVersion.version },
    );
  await service.publishScenarioVersion(
    operator,
    validatedScenarioVersion.id,
    'scenario-version-publish',
    { expectedVersion: validatedScenarioVersion.version },
  );

  const agentVersionIds: string[] = [];
  for (const [index, roleSlotId] of roles.entries()) {
    const { agent } = await service.createAgent(
      operator,
      `agent-create-${index}`,
      {
        displayName: localized(roleSlotId),
        description: localized(`${roleSlotId}-description`),
      },
    );
    const { agentVersion } = await service.createAgentVersion(
      operator,
      agent.id,
      `agent-version-${index}`,
      {
        expectedAgentVersion: 1,
        providerKind: 'fake',
        model: 'journal-fixture',
        capabilities: [roleSlotId],
        protocolVersion: 'v2',
        telemetryMode: 'none',
        skillManifestHash: `sha256:${String(index + 1).repeat(64)}`,
        toolManifestHash: `sha256:${String(index + 5).repeat(64)}`,
      },
    );
    agentVersionIds.push(agentVersion.id);
  }
  const { run } = await service.createRun(operator, 'run-create', {
    scenarioVersionId: DEFAULT_V2_SCENARIO_VERSION_ID,
    label: localized('journal run'),
    mode: 'exercise',
  });
  const runAgentIds: string[] = [];
  for (const [index, roleSlotId] of roles.entries()) {
    const { runAgent } = await service.joinRun(
      operator,
      run.id,
      `run-join-${index}`,
      {
        agentVersionId: agentVersionIds[index]!,
        instanceKey: `journal-${roleSlotId}`,
        roleSlotId,
      },
    );
    runAgentIds.push(runAgent.id);
  }
  await service.startRun(operator, run.id, 'run-start', {
    expectedVersion: 1,
  });
  const waterPrincipal: ParticipantPrincipal = {
    id: 'journal-water-credential',
    participantVersionIds: [],
    roles: ['run_agent'],
    runAgentIds: [runAgentIds[0]!],
  };
  const firstSync = await service.sync(
    waterPrincipal,
    run.id,
    runAgentIds[0]!,
    'water-sync-1',
    { afterReceiptSeq: 0, maxItems: 100 },
  );
  const taskReceipt = firstSync.receipts.find(
    (receipt) => receipt.resourceType === 'task',
  )!;
  const task = taskReceipt.contentSnapshot as RunTaskDto;
  const claim = await service.claimTask(
    waterPrincipal,
    runAgentIds[0]!,
    task.id,
    'water-claim',
    { expectedVersion: task.lockVersion, leaseSeconds: 60 },
  );
  const begun = await service.beginTask(
    waterPrincipal,
    runAgentIds[0]!,
    task.id,
    'water-begin',
    {
      expectedVersion: claim.task.lockVersion,
      claimEpoch: claim.lease.claimEpoch,
      leaseToken: claim.lease.leaseToken,
    },
  );
  const heartbeat = await service.heartbeatTask(
    waterPrincipal,
    runAgentIds[0]!,
    task.id,
    'water-heartbeat',
    {
      expectedVersion: begun.task.lockVersion,
      claimEpoch: claim.lease.claimEpoch,
      leaseToken: claim.lease.leaseToken,
      extendBySeconds: 30,
    },
  );
  const released = await service.releaseTask(
    waterPrincipal,
    runAgentIds[0]!,
    task.id,
    'water-release',
    {
      expectedVersion: heartbeat.task.lockVersion,
      claimEpoch: claim.lease.claimEpoch,
      leaseToken: claim.lease.leaseToken,
    },
  );
  const reclaimed = await service.claimTask(
    waterPrincipal,
    runAgentIds[0]!,
    task.id,
    'water-reclaim',
    { expectedVersion: released.task.lockVersion, leaseSeconds: 60 },
  );
  const resumed = await service.beginTask(
    waterPrincipal,
    runAgentIds[0]!,
    task.id,
    'water-resume',
    {
      expectedVersion: reclaimed.task.lockVersion,
      claimEpoch: reclaimed.lease.claimEpoch,
      leaseToken: reclaimed.lease.leaseToken,
    },
  );
  await service.createMessage(
    waterPrincipal,
    runAgentIds[0]!,
    run.id,
    'water-message',
    {
      kind: 'inform',
      recipientRunAgentIds: [runAgentIds[1]!],
      subject: localized('journal message'),
      body: localized('journal message body'),
      artifactVersionRefs: [],
    },
  );
  const { artifact } = await service.createArtifact(
    waterPrincipal,
    runAgentIds[0]!,
    run.id,
    'water-artifact',
    {
      artifactKey: 'journal-evidence',
      artifactType: 'evidence-register',
      title: localized('journal evidence'),
      content: {
        recovered: true,
        authorization: 'Bearer is a legitimate word in this evidence.',
        credential: 'wlt_ is a legitimate token-shaped citation prefix.',
        metadata: {
          $secretRef: {
            kind: 'lease-token-hash',
            tokenHash: `sha256:${'f'.repeat(64)}`,
          },
        },
      },
      recipientRunAgentIds: [runAgentIds[0]!],
    },
  );
  const { artifact: artifactVersion } = await service.createArtifactVersion(
    waterPrincipal,
    runAgentIds[0]!,
    artifact.id,
    'water-artifact-version',
    {
      baseVersionId: artifact.versionId,
      content: { recovered: true, revision: 2 },
      recipientRunAgentIds: [runAgentIds[0]!],
    },
  );
  const artifactSync = await service.sync(
    waterPrincipal,
    run.id,
    runAgentIds[0]!,
    'water-sync-artifact',
    { afterReceiptSeq: firstSync.throughReceiptSeq, maxItems: 100 },
  );
  const { submission } = await service.submitTask(
    waterPrincipal,
    runAgentIds[0]!,
    task.id,
    'water-submission',
    {
      expectedVersion: resumed.task.lockVersion,
      claimEpoch: reclaimed.lease.claimEpoch,
      leaseToken: reclaimed.lease.leaseToken,
      submissionType: 'water-evidence-result',
      targetScope: 'individual',
      payload: { conclusion: 'journal recovery fixture' },
      receiptRefs: [
        {
          receiptId: taskReceipt.id,
          receiptHash: taskReceipt.receiptHash,
        },
      ],
      artifactVersionRefs: [
        {
          artifactId: artifact.id,
          artifactVersionId: artifactVersion.versionId,
          contentHash: artifactVersion.contentHash,
        },
      ],
      endorsementRecipientRunAgentIds: [],
    },
  );
  const finalSync = await service.sync(
    waterPrincipal,
    run.id,
    runAgentIds[0]!,
    'water-sync-2',
    { afterReceiptSeq: artifactSync.throughReceiptSeq, maxItems: 100 },
  );
  await expect(
    service.endorseSubmission(
      waterPrincipal,
      runAgentIds[0]!,
      submission.id,
      'water-endorsement-rejected',
      { feedbackActionGrantId: '88000000-0000-4000-8000-000000000001' },
    ),
  ).rejects.toBeDefined();
  return {
    run,
    waterPrincipal,
    runAgentId: runAgentIds[0]!,
    task,
    artifact,
    submission,
    finalSync,
    leaseToken: reclaimed.lease.leaseToken,
  };
}

describe('PostgreSQL Agent EXCON v2 command journal', () => {
  it('covers every V2ExerciseService mutation with a static journal registry', () => {
    const source = readFileSync(
      new URL('../src/v2-types.ts', import.meta.url),
      'utf8',
    );
    const interfaceBody =
      /export interface V2ExerciseService \{([\s\S]*?)\n\}/.exec(source)?.[1];
    const methods = [...(interfaceBody ?? '').matchAll(/^ {2}(\w+)\(/gm)].map(
      ([, method]) => method!,
    );
    const queryMethods = new Set([
      'isReady',
      'listPublicScenarios',
      'getPublicScenario',
      'listPublicScenarioVersions',
      'getPublicScenarioVersion',
      'listManageScenarios',
      'listAgents',
      'getAgentVersion',
      'listRuns',
      'getRun',
      'listRunAgents',
      'getRunAgentMe',
      'listIssuedResources',
      'listRunInteractions',
      'listRunEvaluations',
      'listRunEvents',
      'getReplay',
      'close',
    ]);
    expect(
      methods.filter((method) => !queryMethods.has(method)).sort(),
    ).toEqual([...V2_JOURNALED_MUTATIONS].sort());
    expect(
      readFileSync(
        new URL('../src/v2-postgres-journal-service.ts', import.meta.url),
        'utf8',
      ),
    ).not.toContain('.localeCompare(');
  });

  it('recovers Run, Receipt, Task, Artifact, and Submission after restart', async () => {
    const database = new MemoryJournalDatabase();
    const first = open(database);
    const firstService = await first.service;
    const fixture = await prepareCollaboration(firstService);
    expect(
      [
        ...new Set(database.intents.map(({ commandName }) => commandName)),
      ].sort(),
    ).toEqual([...V2_JOURNALED_MUTATIONS].sort());
    await firstService.close();

    const restarted = open(database, 50_000, {
      idFactory: () => {
        throw new Error('replay must not call the live id factory');
      },
      now: () => {
        throw new Error('replay must not call the live clock');
      },
    });
    const service = await restarted.service;
    expect(await service.getRun(operator, fixture.run.id)).toMatchObject({
      run: { id: fixture.run.id, state: 'RUNNING' },
    });
    const tasks = (await service.listIssuedResources(
      fixture.waterPrincipal,
      fixture.run.id,
      fixture.runAgentId,
      'task',
    )) as readonly RunTaskDto[];
    const artifacts = (await service.listIssuedResources(
      fixture.waterPrincipal,
      fixture.run.id,
      fixture.runAgentId,
      'artifact',
    )) as readonly RunArtifactDto[];
    const submissions = (await service.listIssuedResources(
      fixture.waterPrincipal,
      fixture.run.id,
      fixture.runAgentId,
      'submission',
    )) as readonly RunSubmissionDto[];
    const replay = await service.getReplay(
      fixture.waterPrincipal,
      fixture.run.id,
      {
        perspective: 'agent',
        subjectId: fixture.runAgentId,
        deliverySemantics: 'issued',
      },
    );
    expect(tasks.some(({ id }) => id === fixture.task.id)).toBe(true);
    expect(artifacts.some(({ id }) => id === fixture.artifact.id)).toBe(true);
    const artifactIntent = database.intents.find(
      ({ commandName }) => commandName === 'createArtifact',
    )!;
    expect(JSON.stringify(artifactIntent.arguments)).toContain('"$secretRef"');
    expect(submissions.some(({ id }) => id === fixture.submission.id)).toBe(
      true,
    );
    expect(replay.authoritativeProjection.receipts.length).toBe(
      fixture.finalSync.throughReceiptSeq,
    );
    await service.close();
  });

  it('recovers a pending intent after an outcome-write crash', async () => {
    const database = new MemoryJournalDatabase();
    const first = open(database);
    const service = await first.service;
    database.failOutcome = true;
    await expect(
      service.createScenario(operator, 'pending-scenario', {
        slug: 'pending-journal-scenario',
        title: localized('pending'),
        description: localized('pending description'),
        region: localized('pending region'),
        simulationOnly: true,
      }),
    ).rejects.toMatchObject({ code: 'JOURNAL_UNAVAILABLE' });
    expect(await service.isReady()).toBe(false);
    expect(database.intents).toHaveLength(1);
    expect(database.outcomes).toHaveLength(0);
    await service.close();

    database.failOutcome = false;
    const recovered = await open(database, 10_000).service;
    expect(await recovered.listManageScenarios(operator)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: 'pending-journal-scenario' }),
      ]),
    );
    expect(database.outcomes).toHaveLength(1);
    await recovered.close();
  });

  it('fails startup on replay hash drift', async () => {
    const database = new MemoryJournalDatabase();
    const first = await open(database).service;
    await first.createScenario(operator, 'drift-scenario', {
      slug: 'drift-journal-scenario',
      title: localized('drift'),
      description: localized('drift description'),
      region: localized('drift region'),
      simulationOnly: true,
    });
    await first.close();
    database.outcomes[0]!.resultHash = `sha256:${'f'.repeat(64)}`;

    await expect(open(database, 20_000).service).rejects.toMatchObject({
      code: 'JOURNAL_REPLAY_DRIFT',
    });
    expect(database.lockOwner).toBeUndefined();
  });

  it('binds intent hashes to the complete versioned envelope', async () => {
    const database = new MemoryJournalDatabase();
    const service = await open(database).service;
    const input = {
      slug: 'intent-envelope-scenario',
      title: localized('intent envelope'),
      description: localized('intent envelope description'),
      region: localized('intent envelope region'),
      simulationOnly: true as const,
    };
    await service.createScenario(operator, 'intent-envelope-key', input);
    await service.createScenario(operator, 'intent-envelope-key', input);
    expect(database.intents).toHaveLength(2);
    expect(database.intents[0]!.requestHash).not.toBe(
      database.intents[1]!.requestHash,
    );
    expect(database.outcomes[0]!.resultHash).not.toBe(
      database.outcomes[1]!.resultHash,
    );
    await service.close();

    const replacementIntentId = '99000000-0000-4000-8000-000000000001';
    const originalIntentId = database.intents[0]!.intentId;
    Object.assign(database.intents[0]!, { intentId: replacementIntentId });
    Object.assign(
      database.outcomes.find(({ intentId }) => intentId === originalIntentId)!,
      { intentId: replacementIntentId },
    );
    await expect(open(database, 25_000).service).rejects.toMatchObject({
      code: 'JOURNAL_CORRUPT',
    });
  });

  it('rejects a second live writer', async () => {
    const database = new MemoryJournalDatabase();
    const first = await open(database).service;
    await expect(open(database, 30_000).service).rejects.toMatchObject({
      code: 'JOURNAL_WRITER_LOCKED',
    });
    await first.close();
  });

  it('becomes unready when outcome persistence fails after memory mutation', async () => {
    const database = new MemoryJournalDatabase();
    const service = await open(database).service;
    database.failOutcome = true;
    await expect(
      service.createScenario(operator, 'fail-closed-scenario', {
        slug: 'fail-closed-journal-scenario',
        title: localized('fail closed'),
        description: localized('fail closed description'),
        region: localized('fail closed region'),
        simulationOnly: true,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(V2JournalError);
      expect((error as V2JournalError).code).toBe('JOURNAL_UNAVAILABLE');
      expect((error as Error).message).not.toContain('private outcome');
      return true;
    });
    expect(await service.isReady()).toBe(false);
    await expect(service.listRuns(operator)).rejects.toMatchObject({
      code: 'JOURNAL_UNREADY',
    });
    await service.close();
  });

  it('journals domain rejections without creating a permanent recovery poison pill', async () => {
    const database = new MemoryJournalDatabase();
    const service = await open(database).service;
    const fixture = await prepareCollaboration(service);

    await expect(
      service.createMessage(
        fixture.waterPrincipal,
        fixture.runAgentId,
        fixture.run.id,
        'self-recipient-message',
        {
          kind: 'inform',
          recipientRunAgentIds: [fixture.runAgentId],
          subject: localized('invalid self recipient'),
          body: localized('invalid self recipient body'),
          artifactVersionRefs: [],
        },
      ),
    ).rejects.toMatchObject({ code: 'MESSAGE_RECIPIENT_CONFLICT' });
    expect(await service.isReady()).toBe(true);
    expect(database.outcomes.at(-1)).toMatchObject({
      status: 'rejected',
      errorCode: 'MESSAGE_RECIPIENT_CONFLICT',
    });
    await service.close();

    const recovered = await open(database, 60_000).service;
    expect(await recovered.isReady()).toBe(true);
    await recovered.close();
  });

  it('never journals bearer or plaintext lease credentials', async () => {
    const database = new MemoryJournalDatabase();
    const service = await open(database).service;
    const fixture = await prepareCollaboration(service);
    const serialized = JSON.stringify({
      intents: database.intents,
      outcomes: database.outcomes,
    });
    expect(serialized).not.toContain(fixture.leaseToken);
    expect(serialized).not.toMatch(/"leaseToken"\s*:\s*"wlt_/);
    expect(serialized).toContain(
      'Bearer is a legitimate word in this evidence.',
    );
    expect(serialized).toContain('$secretRef');
    expect(serialized).toContain('tokenHash');
    const leaseCommands = new Set([
      'beginTask',
      'heartbeatTask',
      'releaseTask',
      'submitTask',
    ]);
    for (const intent of database.intents.filter(({ commandName }) =>
      leaseCommands.has(commandName),
    )) {
      const arguments_ = intent.arguments as readonly unknown[];
      expect(JSON.stringify(arguments_[3])).toMatch(
        /"leaseToken":\{"\$secretRef":\{"kind":"lease-token-hash","tokenHash":"sha256:[a-f0-9]{64}"\}\}/,
      );
    }
    await service.close();
  });

  it('always releases resources even when client release fails during close', async () => {
    const database = new MemoryJournalDatabase();
    const opened = open(database);
    const service = await opened.service;
    database.failRelease = true;

    await expect(service.close()).rejects.toMatchObject({
      code: 'JOURNAL_UNAVAILABLE',
    });
    expect(database.releaseAttempts).toBe(1);
    expect(database.lockOwner).toBeUndefined();
    expect(opened.pool.ended).toBe(true);
    expect(await service.isReady()).toBe(false);
  });
});
