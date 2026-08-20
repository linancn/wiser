export type EpisodeState =
  | 'waiting_for_submission'
  | 'evaluation_queued'
  | 'evaluating'
  | 'feedback_available'
  | 'completed';

export interface Episode {
  readonly id: string;
  readonly scenarioVersionId: string;
  readonly participantVersionId: string;
  readonly state: EpisodeState;
  readonly stageIndex: number;
  readonly virtualTime: string;
  readonly version: number;
  readonly observedInformationIds: readonly string[];
}

export interface InformationItem {
  readonly id: string;
  readonly eventTime: string;
  readonly observedTime: string;
  readonly ingestedTime: string;
  readonly releasedTime: string;
}

export interface SourceReleaseDecision {
  readonly sourceId: string;
  readonly flowM3s: number;
  readonly evidenceRefs: readonly string[];
}

export interface ExpectedSectionFlow {
  readonly sectionId: string;
  readonly flowM3s: number;
}

export interface AllocationPlanSubmission {
  readonly stage: number;
  readonly sourceReleases: readonly SourceReleaseDecision[];
  readonly expectedSectionFlows: readonly ExpectedSectionFlow[];
  readonly isFinal: boolean;
}

export interface WaterSourceConstraint {
  readonly sourceId: string;
  readonly maximumFlowM3s: number;
}

export interface WaterSectionTarget {
  readonly sectionId: string;
  readonly minimumFlowM3s: number;
}

export interface YongdingTransferModel {
  readonly guantingToSanjiadian: number;
  readonly sanjiadianToLugouqiao: number;
  readonly lugouqiaoToCuizhihuiying: number;
  readonly cuizhihuiyingToQujiadian: number;
}

export interface EvidenceTimestamp {
  readonly informationId: string;
  readonly accessedVirtualTime: string;
}

export interface EvaluationResult {
  readonly verdict: 'pass' | 'partial' | 'fail';
  readonly metrics: {
    readonly constraintCompliance: number;
    readonly ecologicalCoverage: number;
    readonly modelAccuracy: number;
    readonly evidenceCoverage: number;
    readonly timeTravelViolations: number;
    readonly totalScore: number;
  };
}

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

function fail(code: string, message: string): never {
  throw new DomainError(code, message);
}

function assertVersion(episode: Episode, expectedVersion: number): void {
  if (episode.version !== expectedVersion) {
    fail(
      'EPISODE_VERSION_CONFLICT',
      `Expected episode version ${expectedVersion}, received ${episode.version}. Refresh the episode and retry.`,
    );
  }
}

function assertState(episode: Episode, expected: EpisodeState): void {
  if (episode.state !== expected) {
    fail(
      'EPISODE_STATE_CONFLICT',
      `The episode must be ${expected}; its current state is ${episode.state}.`,
    );
  }
}

function toEpoch(value: string, field: string): number {
  const epoch = Date.parse(value);
  if (Number.isNaN(epoch)) {
    fail('INVALID_TIMESTAMP', `${field} must be a valid ISO 8601 timestamp.`);
  }
  return epoch;
}

function nextEpisode(
  episode: Episode,
  change: Partial<
    Omit<Episode, 'id' | 'scenarioVersionId' | 'participantVersionId'>
  >,
): Episode {
  return Object.freeze({
    ...episode,
    ...change,
    observedInformationIds: Object.freeze([
      ...(change.observedInformationIds ?? episode.observedInformationIds),
    ]),
  });
}

function roundMetric(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

export function createEpisode(_input: {
  id: string;
  scenarioVersionId: string;
  participantVersionId: string;
  replayStartAt: string;
}): Episode {
  toEpoch(_input.replayStartAt, 'replayStartAt');
  return Object.freeze({
    id: _input.id,
    scenarioVersionId: _input.scenarioVersionId,
    participantVersionId: _input.participantVersionId,
    state: 'waiting_for_submission',
    stageIndex: 0,
    virtualTime: _input.replayStartAt,
    version: 1,
    observedInformationIds: Object.freeze([]),
  });
}

export function releaseInformation(
  episode: Episode,
  items: readonly InformationItem[],
): readonly InformationItem[] {
  const virtualTime = toEpoch(episode.virtualTime, 'episode.virtualTime');
  return items.filter((item) => {
    const eventTime = toEpoch(item.eventTime, 'information.eventTime');
    const observedTime = toEpoch(item.observedTime, 'information.observedTime');
    const ingestedTime = toEpoch(item.ingestedTime, 'information.ingestedTime');
    const releasedTime = toEpoch(item.releasedTime, 'information.releasedTime');

    if (
      eventTime > observedTime ||
      observedTime > ingestedTime ||
      ingestedTime > releasedTime
    ) {
      fail(
        'INVALID_INFORMATION_TIMELINE',
        `Information ${item.id} violates event <= observed <= ingested <= released.`,
      );
    }
    return releasedTime <= virtualTime;
  });
}

export function recordObservation(
  episode: Episode,
  informationIds: readonly string[],
): Episode {
  assertState(episode, 'waiting_for_submission');
  const observed = new Set(episode.observedInformationIds);
  for (const informationId of informationIds) {
    observed.add(informationId);
  }
  if (observed.size === episode.observedInformationIds.length) {
    return episode;
  }
  return nextEpisode(episode, {
    observedInformationIds: [...observed],
    version: episode.version + 1,
  });
}

export function queueSubmission(
  episode: Episode,
  submission: AllocationPlanSubmission,
  expectedVersion: number,
): Episode {
  assertVersion(episode, expectedVersion);
  assertState(episode, 'waiting_for_submission');

  if (submission.sourceReleases.length === 0) {
    fail('EMPTY_SUBMISSION', 'A water allocation plan needs source releases.');
  }

  const observed = new Set(episode.observedInformationIds);
  const sourceIds = new Set<string>();
  for (const release of submission.sourceReleases) {
    if (!Number.isFinite(release.flowM3s) || release.flowM3s < 0) {
      fail(
        'INVALID_ALLOCATION_VOLUME',
        `Release from ${release.sourceId} must be a non-negative finite flow.`,
      );
    }
    if (sourceIds.has(release.sourceId)) {
      fail(
        'DUPLICATE_ALLOCATION',
        `Only one release is allowed for source ${release.sourceId}.`,
      );
    }
    sourceIds.add(release.sourceId);
    for (const evidenceRef of release.evidenceRefs) {
      if (!observed.has(evidenceRef)) {
        fail(
          'EVIDENCE_NOT_OBSERVED',
          `Evidence ${evidenceRef} was not observed in this episode. Observe it before submitting.`,
        );
      }
    }
  }

  return nextEpisode(episode, {
    state: 'evaluation_queued',
    version: episode.version + 1,
  });
}

export function startEvaluation(
  episode: Episode,
  expectedVersion: number,
): Episode {
  assertVersion(episode, expectedVersion);
  assertState(episode, 'evaluation_queued');
  return nextEpisode(episode, {
    state: 'evaluating',
    version: episode.version + 1,
  });
}

export function publishFeedback(
  episode: Episode,
  expectedVersion: number,
): Episode {
  assertVersion(episode, expectedVersion);
  assertState(episode, 'evaluating');
  return nextEpisode(episode, {
    state: 'feedback_available',
    version: episode.version + 1,
  });
}

export function reopenEpisodeForRevision(
  episode: Episode,
  expectedVersion: number,
): Episode {
  assertVersion(episode, expectedVersion);
  assertState(episode, 'feedback_available');
  return nextEpisode(episode, {
    state: 'waiting_for_submission',
    version: episode.version + 1,
  });
}

export function advanceEpisode(
  episode: Episode,
  input: { expectedVersion: number; nextCheckpoint: string },
): Episode {
  assertVersion(episode, input.expectedVersion);
  assertState(episode, 'feedback_available');
  const currentTime = toEpoch(episode.virtualTime, 'episode.virtualTime');
  const nextCheckpoint = toEpoch(input.nextCheckpoint, 'nextCheckpoint');
  if (nextCheckpoint <= currentTime) {
    fail(
      'VIRTUAL_TIME_NOT_MONOTONIC',
      'The next checkpoint must be later than the current virtual time.',
    );
  }
  return nextEpisode(episode, {
    state: 'waiting_for_submission',
    stageIndex: episode.stageIndex + 1,
    virtualTime: input.nextCheckpoint,
    version: episode.version + 1,
  });
}

export function completeEpisode(
  episode: Episode,
  expectedVersion: number,
): Episode {
  assertVersion(episode, expectedVersion);
  assertState(episode, 'feedback_available');
  return nextEpisode(episode, {
    state: 'completed',
    version: episode.version + 1,
  });
}

export function evaluateWaterAllocationPlan(input: {
  submission: AllocationPlanSubmission;
  sources: readonly WaterSourceConstraint[];
  sectionTargets: readonly WaterSectionTarget[];
  transferModel: YongdingTransferModel;
  totalReleaseLimitM3s: number;
  evidenceTimestamps: readonly EvidenceTimestamp[];
  submittedVirtualTime: string;
}): EvaluationResult {
  const submittedVirtualTime = toEpoch(
    input.submittedVirtualTime,
    'submittedVirtualTime',
  );
  const releases = new Map(
    input.submission.sourceReleases.map((release) => [
      release.sourceId,
      release.flowM3s,
    ]),
  );
  const guanting = releases.get('guanting') ?? 0;
  const southWater = releases.get('south-water') ?? 0;
  const reclaimedLower = releases.get('reclaimed-lower') ?? 0;

  const computedFlows = new Map<string, number>();
  const sanjiadian = input.transferModel.guantingToSanjiadian * guanting;
  computedFlows.set('sanjiadian', sanjiadian);
  const lugouqiao =
    input.transferModel.sanjiadianToLugouqiao * (sanjiadian + southWater);
  computedFlows.set('lugouqiao', lugouqiao);
  const cuizhihuiying =
    input.transferModel.lugouqiaoToCuizhihuiying * (lugouqiao + reclaimedLower);
  computedFlows.set('cuizhihuiying', cuizhihuiying);
  const qujiadian =
    input.transferModel.cuizhihuiyingToQujiadian * cuizhihuiying;
  computedFlows.set('qujiadian', qujiadian);

  const releaseBySource = new Map(
    input.submission.sourceReleases.map((release) => [
      release.sourceId,
      release,
    ]),
  );
  const sourceLimitsSatisfied = input.sources.every((constraint) => {
    const release = releaseBySource.get(constraint.sourceId)?.flowM3s ?? 0;
    return release >= 0 && release <= constraint.maximumFlowM3s;
  });
  const totalRelease = input.submission.sourceReleases.reduce(
    (sum, release) => sum + release.flowM3s,
    0,
  );
  const totalLimitSatisfied = totalRelease <= input.totalReleaseLimitM3s;
  const stepSatisfied = input.submission.sourceReleases.every(
    ({ flowM3s }) => Math.abs(flowM3s * 10 - Math.round(flowM3s * 10)) < 1e-9,
  );
  const expectedFlows = new Map(
    input.submission.expectedSectionFlows.map((section) => [
      section.sectionId,
      section.flowM3s,
    ]),
  );
  const deviations = [...computedFlows].map(([sectionId, computed]) =>
    Math.abs((expectedFlows.get(sectionId) ?? Number.NaN) - computed),
  );
  const maximumDeviation = deviations.some(Number.isNaN)
    ? Number.POSITIVE_INFINITY
    : Math.max(...deviations, 0);
  const modelSatisfied = maximumDeviation <= 0.01;
  const constraintCompliance =
    [
      sourceLimitsSatisfied,
      totalLimitSatisfied,
      stepSatisfied,
      modelSatisfied,
    ].filter(Boolean).length / 4;

  const ecologicalCoverage =
    input.sectionTargets.length === 0
      ? 1
      : input.sectionTargets.reduce((sum, target) => {
          const flow = computedFlows.get(target.sectionId) ?? 0;
          return sum + Math.min(1, flow / target.minimumFlowM3s);
        }, 0) / input.sectionTargets.length;
  const modelAccuracy = Number.isFinite(maximumDeviation)
    ? Math.max(0, 1 - maximumDeviation / 0.1)
    : 0;
  const evidencedReleases = input.submission.sourceReleases.filter(
    ({ evidenceRefs }) => evidenceRefs.length > 0,
  ).length;
  const evidenceCoverage =
    input.submission.sourceReleases.length === 0
      ? 0
      : evidencedReleases / input.submission.sourceReleases.length;
  const referencedEvidence = new Set(
    input.submission.sourceReleases.flatMap(({ evidenceRefs }) => evidenceRefs),
  );
  const timeTravelViolations = input.evidenceTimestamps.filter(
    ({ informationId, accessedVirtualTime }) =>
      referencedEvidence.has(informationId) &&
      toEpoch(accessedVirtualTime, 'evidence.accessedVirtualTime') >
        submittedVirtualTime,
  ).length;
  const totalScore =
    constraintCompliance * 40 +
    ecologicalCoverage * 40 +
    evidenceCoverage * 10 +
    Number(timeTravelViolations === 0) * 10;

  const metrics = {
    constraintCompliance: roundMetric(constraintCompliance),
    ecologicalCoverage: roundMetric(ecologicalCoverage),
    modelAccuracy: roundMetric(modelAccuracy),
    evidenceCoverage: roundMetric(evidenceCoverage),
    timeTravelViolations,
    totalScore: roundMetric(totalScore),
  };
  const allFeasibilityConstraintsPass =
    timeTravelViolations === 0 &&
    constraintCompliance === 1 &&
    ecologicalCoverage === 1 &&
    evidenceCoverage === 1;
  const verdict = allFeasibilityConstraintsPass
    ? 'pass'
    : timeTravelViolations > 0 || constraintCompliance < 1
      ? 'fail'
      : 'partial';

  return Object.freeze({ verdict, metrics: Object.freeze(metrics) });
}
