import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { ObjectStoreAuthorityError } from './errors.js';
import type { S3AuthorityPresigner } from './types.js';

export interface SeaweedFsS3AuthorityConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly forcePathStyle: true;
  readonly credentials: {
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
}

function configurationError(): ObjectStoreAuthorityError {
  return new ObjectStoreAuthorityError('INVALID_OBJECT_STORE_CONFIGURATION');
}

function safeEndpoint(value: string | undefined): string | null {
  if (value === undefined || value.length > 2_048) return null;
  try {
    const endpoint = new URL(value);
    if (
      (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') ||
      endpoint.username.length > 0 ||
      endpoint.password.length > 0 ||
      endpoint.search.length > 0 ||
      endpoint.hash.length > 0 ||
      (endpoint.pathname !== '' && endpoint.pathname !== '/')
    ) {
      return null;
    }
    return endpoint.origin;
  } catch {
    return null;
  }
}

function safeBucket(value: string | undefined): value is string {
  return (
    value !== undefined &&
    value.length >= 3 &&
    value.length <= 63 &&
    /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(value) &&
    !value.includes('..') &&
    !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)
  );
}

function safeRegion(value: string | undefined): value is string {
  return (
    value !== undefined &&
    value.length >= 3 &&
    value.length <= 64 &&
    /^[a-z0-9][a-z0-9-]*$/.test(value)
  );
}

function safeCredential(
  value: string | undefined,
  minimum: number,
): value is string {
  const hasControlCharacter =
    value?.split('').some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    }) ?? false;
  return (
    value !== undefined &&
    value.length >= minimum &&
    value.length <= 256 &&
    !hasControlCharacter
  );
}

export function loadSeaweedFsS3AuthorityConfig(
  environment: Readonly<Record<string, string | undefined>>,
): SeaweedFsS3AuthorityConfig {
  const endpoint = safeEndpoint(environment['WISER_DATA_S3_ENDPOINT']);
  const region = environment['WISER_DATA_S3_REGION'];
  const bucket = environment['WISER_DATA_S3_BUCKET'];
  const accessKeyId = environment['WISER_DATA_S3_ACCESS_KEY_ID'];
  const secretAccessKey = environment['WISER_DATA_S3_SECRET_ACCESS_KEY'];
  if (
    endpoint === null ||
    !safeRegion(region) ||
    !safeBucket(bucket) ||
    !safeCredential(accessKeyId, 3) ||
    !safeCredential(secretAccessKey, 8)
  ) {
    throw configurationError();
  }
  return {
    endpoint,
    region,
    bucket,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  };
}

export function createSeaweedFsS3Client(
  config: SeaweedFsS3AuthorityConfig,
): S3Client {
  const clientConfig: S3ClientConfig = {
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: config.credentials,
  };
  return new S3Client(clientConfig);
}

export function createS3AuthorityPresigner(
  client: S3Client,
): S3AuthorityPresigner {
  return (command, expiresIn) => {
    if (command instanceof PutObjectCommand) {
      return getSignedUrl(client, command, { expiresIn });
    }
    if (command instanceof UploadPartCommand) {
      return getSignedUrl(client, command, { expiresIn });
    }
    if (command instanceof GetObjectCommand) {
      return getSignedUrl(client, command, { expiresIn });
    }
    throw new ObjectStoreAuthorityError('INVALID_OBJECT_REFERENCE');
  };
}
