import type {
  AllocationPlanSubmission,
  EvidenceTimestamp,
  WaterSectionTarget,
  WaterSourceConstraint,
  YongdingTransferModel,
} from '@agent-excon/core';

import type { EvaluationInput } from './types.js';
import { WorkerError } from './types.js';

interface AllocationItemRecord {
  readonly sourceCode: string;
  readonly maxFlowM3s: number;
}

export interface StoredEvaluationData {
  readonly submissionPayload: unknown;
  readonly revisionNo: number;
  readonly submittedVirtualAt: string;
  readonly isFinal: boolean;
  readonly allocationItems: readonly AllocationItemRecord[];
  readonly evidenceTimestamps: readonly EvidenceTimestamp[];
}

const DEFAULT_SOURCES: readonly WaterSourceConstraint[] = Object.freeze([
  Object.freeze({ sourceId: 'guanting', maximumFlowM3s: 24 }),
  Object.freeze({ sourceId: 'south-water', maximumFlowM3s: 10 }),
  Object.freeze({ sourceId: 'reclaimed-lower', maximumFlowM3s: 6 }),
]);

const DEFAULT_SECTION_TARGETS: readonly WaterSectionTarget[] = Object.freeze([
  Object.freeze({ sectionId: 'sanjiadian', minimumFlowM3s: 10 }),
  Object.freeze({ sectionId: 'lugouqiao', minimumFlowM3s: 16 }),
  Object.freeze({ sectionId: 'cuizhihuiying', minimumFlowM3s: 15 }),
  Object.freeze({ sectionId: 'qujiadian', minimumFlowM3s: 12 }),
]);

const DEFAULT_TRANSFER_MODEL: YongdingTransferModel = Object.freeze({
  guantingToSanjiadian: 0.9,
  sanjiadianToLugouqiao: 0.88,
  lugouqiaoToCuizhihuiying: 0.82,
  cuizhihuiyingToQujiadian: 0.9,
});

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkerError(
      'INVALID_EVALUATION_INPUT',
      `${field} must be an object.`,
    );
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new WorkerError(
      'INVALID_EVALUATION_INPUT',
      `${field} must be an array.`,
    );
  }
  return value;
}

function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new WorkerError(
      'INVALID_EVALUATION_INPUT',
      `${field} must be a non-empty string.`,
    );
  }
  return value;
}

function number(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new WorkerError(
      'INVALID_EVALUATION_INPUT',
      `${field} must be a finite number.`,
    );
  }
  return value;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new WorkerError(
      'INVALID_EVALUATION_INPUT',
      `${field} must be a boolean.`,
    );
  }
  return value;
}

function parseSubmission(value: unknown): AllocationPlanSubmission {
  const submission = record(value, 'evaluationInput.submission');
  return {
    stage: number(submission.stage, 'submission.stage'),
    sourceReleases: array(
      submission.sourceReleases,
      'submission.sourceReleases',
    ).map((raw, index) => {
      const release = record(raw, `submission.sourceReleases[${index}]`);
      return {
        sourceId: string(release.sourceId, 'sourceRelease.sourceId'),
        flowM3s: number(release.flowM3s, 'sourceRelease.flowM3s'),
        evidenceRefs: array(
          release.evidenceRefs,
          'sourceRelease.evidenceRefs',
        ).map((ref) => string(ref, 'sourceRelease.evidenceRef')),
      };
    }),
    expectedSectionFlows: array(
      submission.expectedSectionFlows,
      'submission.expectedSectionFlows',
    ).map((raw, index) => {
      const section = record(raw, `submission.expectedSectionFlows[${index}]`);
      return {
        sectionId: string(section.sectionId, 'sectionFlow.sectionId'),
        flowM3s: number(section.flowM3s, 'sectionFlow.flowM3s'),
      };
    }),
    isFinal: boolean(submission.isFinal, 'submission.isFinal'),
  };
}

export function parseEvaluationInput(value: unknown): EvaluationInput {
  const input = record(value, 'evaluationInput');
  const model = record(input.transferModel, 'evaluationInput.transferModel');
  return {
    submission: parseSubmission(input.submission),
    sources: array(input.sources, 'evaluationInput.sources').map(
      (raw, index) => {
        const source = record(raw, `evaluationInput.sources[${index}]`);
        return {
          sourceId: string(source.sourceId, 'source.sourceId'),
          maximumFlowM3s: number(
            source.maximumFlowM3s,
            'source.maximumFlowM3s',
          ),
        };
      },
    ),
    sectionTargets: array(
      input.sectionTargets,
      'evaluationInput.sectionTargets',
    ).map((raw, index) => {
      const target = record(raw, `evaluationInput.sectionTargets[${index}]`);
      return {
        sectionId: string(target.sectionId, 'sectionTarget.sectionId'),
        minimumFlowM3s: number(
          target.minimumFlowM3s,
          'sectionTarget.minimumFlowM3s',
        ),
      };
    }),
    transferModel: {
      guantingToSanjiadian: number(
        model.guantingToSanjiadian,
        'transferModel.guantingToSanjiadian',
      ),
      sanjiadianToLugouqiao: number(
        model.sanjiadianToLugouqiao,
        'transferModel.sanjiadianToLugouqiao',
      ),
      lugouqiaoToCuizhihuiying: number(
        model.lugouqiaoToCuizhihuiying,
        'transferModel.lugouqiaoToCuizhihuiying',
      ),
      cuizhihuiyingToQujiadian: number(
        model.cuizhihuiyingToQujiadian,
        'transferModel.cuizhihuiyingToQujiadian',
      ),
    },
    totalReleaseLimitM3s: number(
      input.totalReleaseLimitM3s,
      'evaluationInput.totalReleaseLimitM3s',
    ),
    evidenceTimestamps: array(
      input.evidenceTimestamps,
      'evaluationInput.evidenceTimestamps',
    ).map((raw, index) => {
      const timestamp = record(
        raw,
        `evaluationInput.evidenceTimestamps[${index}]`,
      );
      return {
        informationId: string(
          timestamp.informationId,
          'evidenceTimestamp.informationId',
        ),
        accessedVirtualTime: string(
          timestamp.accessedVirtualTime,
          'evidenceTimestamp.accessedVirtualTime',
        ),
      };
    }),
    submittedVirtualTime: string(
      input.submittedVirtualTime,
      'evaluationInput.submittedVirtualTime',
    ),
  };
}

function mapSource(sourceCode: string): string {
  const normalized = sourceCode.toLowerCase();
  if (normalized.includes('guanting')) return 'guanting';
  if (normalized.includes('reclaimed')) return 'reclaimed-lower';
  if (normalized.includes('south') || normalized.includes('yellow')) {
    return 'south-water';
  }
  throw new WorkerError(
    'UNSUPPORTED_WATER_SOURCE',
    `Unsupported Jing-Jin-Ji water source code: ${sourceCode}`,
  );
}

function deriveSubmission(
  data: StoredEvaluationData,
): AllocationPlanSubmission {
  const evidenceRefs = data.evidenceTimestamps.map(
    ({ informationId }) => informationId,
  );
  const flowBySource = new Map<string, number>();
  for (const item of data.allocationItems) {
    const sourceId = mapSource(item.sourceCode);
    flowBySource.set(
      sourceId,
      (flowBySource.get(sourceId) ?? 0) + item.maxFlowM3s,
    );
  }
  if (flowBySource.size === 0) {
    throw new WorkerError(
      'INVALID_EVALUATION_INPUT',
      'The allocation plan has no water-source items to evaluate.',
    );
  }

  const guanting = flowBySource.get('guanting') ?? 0;
  const southWater = flowBySource.get('south-water') ?? 0;
  const reclaimedLower = flowBySource.get('reclaimed-lower') ?? 0;
  const sanjiadian = DEFAULT_TRANSFER_MODEL.guantingToSanjiadian * guanting;
  const lugouqiao =
    DEFAULT_TRANSFER_MODEL.sanjiadianToLugouqiao * (sanjiadian + southWater);
  const cuizhihuiying =
    DEFAULT_TRANSFER_MODEL.lugouqiaoToCuizhihuiying *
    (lugouqiao + reclaimedLower);
  const qujiadian =
    DEFAULT_TRANSFER_MODEL.cuizhihuiyingToQujiadian * cuizhihuiying;

  return {
    stage: Math.min(2, Math.max(1, data.revisionNo)),
    sourceReleases: [...flowBySource].map(([sourceId, flowM3s]) => ({
      sourceId,
      flowM3s,
      evidenceRefs,
    })),
    expectedSectionFlows: [
      { sectionId: 'sanjiadian', flowM3s: sanjiadian },
      { sectionId: 'lugouqiao', flowM3s: lugouqiao },
      { sectionId: 'cuizhihuiying', flowM3s: cuizhihuiying },
      { sectionId: 'qujiadian', flowM3s: qujiadian },
    ],
    isFinal: data.isFinal,
  };
}

export function resolveEvaluationInput(
  jobPayload: Readonly<Record<string, unknown>>,
  data: StoredEvaluationData,
): EvaluationInput {
  if (jobPayload.evaluationInput !== undefined) {
    return parseEvaluationInput(jobPayload.evaluationInput);
  }

  const storedPayload = record(data.submissionPayload, 'submission.payload');
  if (
    storedPayload.sourceReleases !== undefined &&
    storedPayload.expectedSectionFlows !== undefined
  ) {
    const rules = record(jobPayload.rules, 'job.payload.rules');
    return parseEvaluationInput({
      ...rules,
      submission: {
        ...storedPayload,
        stage: storedPayload.stage ?? data.revisionNo,
        isFinal: storedPayload.isFinal ?? data.isFinal,
      },
      evidenceTimestamps: data.evidenceTimestamps,
      submittedVirtualTime: data.submittedVirtualAt,
    });
  }

  return {
    submission: deriveSubmission(data),
    sources: DEFAULT_SOURCES,
    sectionTargets: DEFAULT_SECTION_TARGETS,
    transferModel: DEFAULT_TRANSFER_MODEL,
    totalReleaseLimitM3s: 30,
    evidenceTimestamps: data.evidenceTimestamps,
    submittedVirtualTime: data.submittedVirtualAt,
  };
}
