export type GeoJsonPosition =
  readonly [number, number] | readonly [number, number, number];

export type SupportedGeoJsonGeometry =
  | { readonly type: 'Point'; readonly coordinates: GeoJsonPosition }
  | {
      readonly type: 'MultiPoint';
      readonly coordinates: readonly GeoJsonPosition[];
    }
  | {
      readonly type: 'LineString';
      readonly coordinates: readonly GeoJsonPosition[];
    }
  | {
      readonly type: 'MultiLineString';
      readonly coordinates: readonly (readonly GeoJsonPosition[])[];
    }
  | {
      readonly type: 'Polygon';
      readonly coordinates: readonly (readonly GeoJsonPosition[])[];
    }
  | {
      readonly type: 'MultiPolygon';
      readonly coordinates: readonly (readonly (readonly GeoJsonPosition[])[])[];
    };

export interface SpatialProjectionInput {
  readonly spatialExtentId?: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly dataItemId: string;
  readonly versionId: string;
  readonly sourceGeoJson: SupportedGeoJsonGeometry;
  readonly sourceCrs: string;
  readonly securityLevel:
    'L0_PUBLIC' | 'L1_INTERNAL' | 'L2_RESTRICTED' | 'L3_CONFIDENTIAL';
  readonly policyVersion: number;
}

export interface SpatialProjectionResult {
  readonly spatialExtentId: string;
  readonly replayed: boolean;
}

export interface SpatialProjectionQueryResult {
  readonly rows: readonly Record<string, unknown>[];
}

export interface SpatialProjectionClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<SpatialProjectionQueryResult>;
  release(): void;
}

export interface SpatialProjectionPool {
  connect(): Promise<SpatialProjectionClient>;
}
