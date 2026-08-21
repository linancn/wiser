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
  readonly qualityGrade: string;
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
