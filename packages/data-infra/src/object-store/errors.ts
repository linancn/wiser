export type ObjectStoreAuthorityErrorCode =
  | 'IMMUTABLE_OBJECT_CONFLICT'
  | 'INVALID_MULTIPART_PLAN'
  | 'INVALID_OBJECT_REFERENCE'
  | 'INVALID_OBJECT_STORE_CONFIGURATION'
  | 'INVALID_SIGNED_URL_TTL'
  | 'OBJECT_INTEGRITY_MISMATCH'
  | 'OBJECT_NOT_FOUND'
  | 'OBJECT_STORE_UNAVAILABLE';

const messages: Readonly<Record<ObjectStoreAuthorityErrorCode, string>> = {
  IMMUTABLE_OBJECT_CONFLICT: 'Committed authority object is immutable.',
  INVALID_MULTIPART_PLAN: 'Multipart upload plan is invalid.',
  INVALID_OBJECT_REFERENCE: 'Authority object reference is invalid.',
  INVALID_OBJECT_STORE_CONFIGURATION:
    'S3-compatible authority configuration is invalid.',
  INVALID_SIGNED_URL_TTL: 'Signed URL lifetime is outside the allowed range.',
  OBJECT_INTEGRITY_MISMATCH: 'Authority object integrity verification failed.',
  OBJECT_NOT_FOUND: 'Authority object was not found.',
  OBJECT_STORE_UNAVAILABLE: 'S3-compatible authority storage is unavailable.',
};

export class ObjectStoreAuthorityError extends Error {
  readonly code: ObjectStoreAuthorityErrorCode;

  constructor(code: ObjectStoreAuthorityErrorCode) {
    super(messages[code]);
    this.name = 'ObjectStoreAuthorityError';
    this.code = code;
  }
}
