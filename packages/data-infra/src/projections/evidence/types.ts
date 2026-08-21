export interface EvidenceProjectionInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly dataItemId: string;
  readonly versionId: string;
  readonly assetId: string;
  readonly chunkId: string;
  readonly evidenceId: string;
  readonly sourceHash: string;
  readonly securityLevel:
    'L0_PUBLIC' | 'L1_INTERNAL' | 'L2_RESTRICTED' | 'L3_CONFIDENTIAL';
  readonly qualityGrade: 'A' | 'B' | 'C';
  readonly acceptanceStatus:
    | 'PENDING'
    | 'PASSED'
    | 'CONDITIONALLY_PASSED'
    | 'CORRECTION_REQUIRED'
    | 'ARCHIVED_ONLY'
    | 'REJECTED';
  readonly documentId: string;
  readonly pageOrSection: string;
  readonly language: string;
  readonly chunkingStrategy: string;
  readonly embeddingModel: string;
  readonly embeddingVersion: string;
  readonly content: string;
  readonly vector: readonly number[];
}

export interface EvidenceProjectionResult {
  readonly projectionId: string;
}

export interface ProjectionHttpRequest {
  readonly method: 'GET' | 'POST' | 'PUT';
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: Readonly<Record<string, unknown>>;
}

export interface ProjectionHttpResponse {
  readonly status: number;
  readonly body?: unknown;
}

export interface ProjectionHttpClient {
  request(request: ProjectionHttpRequest): Promise<ProjectionHttpResponse>;
}
