import { EvidenceProjectionError } from './errors.js';
import type {
  EvidenceProjectionInput,
  ProjectionHttpClient,
  ProjectionHttpRequest,
  ProjectionHttpResponse,
} from './types.js';

export function evidenceProperties(
  input: EvidenceProjectionInput,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    tenantId: input.tenantId,
    projectId: input.projectId,
    dataItemId: input.dataItemId,
    versionId: input.versionId,
    assetId: input.assetId,
    chunkId: input.chunkId,
    evidenceId: input.evidenceId,
    sourceHash: input.sourceHash,
    securityLevel: input.securityLevel,
    qualityGrade: input.qualityGrade,
    acceptanceStatus: input.acceptanceStatus,
    documentId: input.documentId,
    pageOrSection: input.pageOrSection,
    language: input.language,
    chunkingStrategy: input.chunkingStrategy,
    embeddingModel: input.embeddingModel,
    embeddingVersion: input.embeddingVersion,
    content: input.content,
  });
}

export function assertBackendAccepted(
  response: ProjectionHttpResponse,
  accepted: readonly number[],
): void {
  if (!accepted.includes(response.status)) {
    throw new EvidenceProjectionError(
      'EVIDENCE_PROJECTION_BACKEND_REJECTED',
      'The evidence projection backend rejected the operation.',
      response.status,
    );
  }
}

export async function requestProjectionBackend(
  http: ProjectionHttpClient,
  request: ProjectionHttpRequest,
): Promise<ProjectionHttpResponse> {
  try {
    return await http.request(request);
  } catch {
    throw new EvidenceProjectionError(
      'EVIDENCE_PROJECTION_BACKEND_REJECTED',
      'The evidence projection backend is unavailable.',
    );
  }
}
