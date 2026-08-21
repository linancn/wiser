export type SpatialProjectionErrorCode =
  | 'INVALID_SPATIAL_PROJECTION_CONFIG'
  | 'INVALID_SPATIAL_PROJECTION_INPUT'
  | 'SPATIAL_PROJECTION_IMMUTABLE_CONFLICT'
  | 'SPATIAL_PROJECTION_DATABASE_ERROR';

export class SpatialProjectionError extends Error {
  constructor(
    readonly code: SpatialProjectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SpatialProjectionError';
  }
}

export class SpatialProjectionImmutableConflictError extends SpatialProjectionError {
  constructor() {
    super(
      'SPATIAL_PROJECTION_IMMUTABLE_CONFLICT',
      'The spatial projection identity already contains different immutable content.',
    );
    this.name = 'SpatialProjectionImmutableConflictError';
  }
}
