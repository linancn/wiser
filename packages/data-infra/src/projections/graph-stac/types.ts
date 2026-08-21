export interface GraphStacHttpRequest {
  readonly method: 'POST' | 'PUT';
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface GraphStacHttpResponse {
  readonly status: number;
  readonly body?: unknown;
}

export interface GraphStacHttpClient {
  request(request: GraphStacHttpRequest): Promise<GraphStacHttpResponse>;
}

export interface GovernedProjectionInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly dataItemId: string;
  readonly versionId: string;
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
  readonly publicationStatus:
    'UNPUBLISHED' | 'PUBLISHING' | 'PUBLISHED' | 'WITHDRAWN';
  readonly businessDomains: readonly string[];
  readonly channels: readonly (
    'catalog' | 'fulltext' | 'semantic' | 'graph' | 'geo' | 'stac'
  )[];
  readonly limitations: readonly string[];
  readonly confidence: number;
  readonly reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  readonly validFrom: string;
  readonly validTo: string;
  readonly systemFrom: string;
  readonly systemTo: string | null;
  readonly policyVersion: number;
}

export interface KnowledgeGraphProjectionInput extends GovernedProjectionInput {
  readonly entityId: string;
  readonly entityType: string;
  readonly entityName: string;
}

export interface StacProjectionInput extends GovernedProjectionInput {
  readonly title: string;
  readonly description: string;
  readonly geometry: {
    readonly type:
      | 'Point'
      | 'MultiPoint'
      | 'LineString'
      | 'MultiLineString'
      | 'Polygon'
      | 'MultiPolygon';
    readonly coordinates: unknown;
  };
  readonly bbox: readonly number[];
  readonly assetMediaType: string;
  readonly assetSizeBytes: number;
}
