import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';

import { ObjectStoreAuthorityError } from './errors.js';
import type {
  AuthorityObjectInput,
  AuthorityObjectLocation,
  CommittedObjectLocations,
  S3AuthorityCommandClient,
  S3AuthorityObjectStore,
  S3AuthorityPresigner,
} from './types.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CONTENT_TYPE_PATTERN =
  /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:\s*;\s*[a-z0-9!#$&^_.+-]+=[a-z0-9!#$&^_.+"'-]+)*$/i;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 900;
const MIN_MULTIPART_PART_SIZE = 5 * 1024 * 1024;
const MAX_MULTIPART_PARTS = 10_000;

interface S3AuthorityObjectStoreOptions {
  readonly bucket: string;
  readonly client: S3AuthorityCommandClient;
  readonly presign: S3AuthorityPresigner;
  readonly clock?: () => Date;
}

interface HeadProjection {
  readonly size: number;
  readonly sha256: string;
  readonly etag: string | null;
}

function authorityError(
  code: ConstructorParameters<typeof ObjectStoreAuthorityError>[0],
) {
  return new ObjectStoreAuthorityError(code);
}

function validReference(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function validateObject(input: AuthorityObjectInput): void {
  if (
    !validReference(input.tenantId) ||
    !validReference(input.projectId) ||
    !validReference(input.uploadId) ||
    !SHA256_PATTERN.test(input.sha256) ||
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes < 1 ||
    input.contentType.length < 3 ||
    input.contentType.length > 255 ||
    !CONTENT_TYPE_PATTERN.test(input.contentType)
  ) {
    throw authorityError('INVALID_OBJECT_REFERENCE');
  }
}

function validateVersionReference(input: {
  readonly tenantId: string;
  readonly projectId: string;
  readonly versionId: string;
  readonly sha256: string;
}): void {
  if (
    !validReference(input.tenantId) ||
    !validReference(input.projectId) ||
    !validReference(input.versionId) ||
    !SHA256_PATTERN.test(input.sha256)
  ) {
    throw authorityError('INVALID_OBJECT_REFERENCE');
  }
}

function validateTtl(ttlSeconds: number): void {
  if (
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds < MIN_TTL_SECONDS ||
    ttlSeconds > MAX_TTL_SECONDS
  ) {
    throw authorityError('INVALID_SIGNED_URL_TTL');
  }
}

function expiration(clock: () => Date, ttlSeconds: number): string {
  const now = clock();
  if (!Number.isFinite(now.valueOf())) {
    throw authorityError('INVALID_OBJECT_STORE_CONFIGURATION');
  }
  return new Date(now.valueOf() + ttlSeconds * 1_000).toISOString();
}

function prefix(input: {
  readonly tenantId: string;
  readonly projectId: string;
}) {
  return `tenants/${input.tenantId}/projects/${input.projectId}`;
}

function quarantineKey(input: AuthorityObjectInput): string {
  return `${prefix(input)}/quarantine/${input.uploadId}/sha256/${input.sha256}`;
}

function rawKey(input: AuthorityObjectInput): string {
  return `${prefix(input)}/raw/sha256/${input.sha256.slice(0, 2)}/${input.sha256}`;
}

function versionKey(input: {
  readonly tenantId: string;
  readonly projectId: string;
  readonly versionId: string;
  readonly sha256: string;
}): string {
  return `${prefix(input)}/versions/${input.versionId}/sha256/${input.sha256}`;
}

function isNotFound(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const name: unknown = Reflect.get(error, 'name');
  if (name === 'NotFound' || name === 'NoSuchKey') return true;
  const metadata: unknown = Reflect.get(error, '$metadata');
  return (
    metadata !== null &&
    typeof metadata === 'object' &&
    Reflect.get(metadata, 'httpStatusCode') === 404
  );
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function headerString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function createS3AuthorityObjectStore(
  options: S3AuthorityObjectStoreOptions,
): S3AuthorityObjectStore {
  if (options.bucket.length < 3 || options.bucket.length > 63) {
    throw authorityError('INVALID_OBJECT_STORE_CONFIGURATION');
  }
  const clock = options.clock ?? (() => new Date());

  async function head(key: string): Promise<HeadProjection | null> {
    let response: unknown;
    try {
      response = await options.client.send(
        new HeadObjectCommand({ Bucket: options.bucket, Key: key }),
      );
    } catch (error) {
      if (isNotFound(error)) return null;
      throw authorityError('OBJECT_STORE_UNAVAILABLE');
    }
    const value = record(response);
    const metadata = record(value?.['Metadata']);
    const size = value?.['ContentLength'];
    const sha256 = metadata?.['sha256'];
    if (
      typeof size !== 'number' ||
      !Number.isSafeInteger(size) ||
      typeof sha256 !== 'string'
    ) {
      throw authorityError('OBJECT_INTEGRITY_MISMATCH');
    }
    return {
      size,
      sha256,
      etag: headerString(value?.['ETag']),
    };
  }

  function matches(
    projection: HeadProjection,
    expected: { readonly sizeBytes: number; readonly sha256: string },
  ): boolean {
    return (
      projection.size === expected.sizeBytes &&
      projection.sha256 === expected.sha256
    );
  }

  async function ensureCopy(
    sourceKey: string,
    destination: AuthorityObjectLocation,
    expected: AuthorityObjectInput,
  ): Promise<boolean> {
    const existing = await head(destination.key);
    if (existing !== null) {
      if (!matches(existing, expected)) {
        throw authorityError('IMMUTABLE_OBJECT_CONFLICT');
      }
      return true;
    }
    try {
      await options.client.send(
        new CopyObjectCommand({
          Bucket: destination.bucket,
          Key: destination.key,
          CopySource: encodeURIComponent(`${options.bucket}/${sourceKey}`),
          MetadataDirective: 'COPY',
        }),
      );
    } catch {
      throw authorityError('OBJECT_STORE_UNAVAILABLE');
    }
    const copied = await head(destination.key);
    if (copied === null || !matches(copied, expected)) {
      throw authorityError('OBJECT_INTEGRITY_MISMATCH');
    }
    return false;
  }

  return {
    async planQuarantinePut(input) {
      validateObject(input);
      validateTtl(input.ttlSeconds);
      const key = quarantineKey(input);
      const command = new PutObjectCommand({
        Bucket: options.bucket,
        Key: key,
        ContentLength: input.sizeBytes,
        ContentType: input.contentType,
        Metadata: { sha256: input.sha256 },
      });
      let url: string;
      try {
        url = await options.presign(command, input.ttlSeconds);
      } catch {
        throw authorityError('OBJECT_STORE_UNAVAILABLE');
      }
      return {
        kind: 'single',
        bucket: options.bucket,
        key,
        url,
        expiresAt: expiration(clock, input.ttlSeconds),
        requiredHeaders: {
          'content-length': String(input.sizeBytes),
          'content-type': input.contentType,
          'x-amz-meta-sha256': input.sha256,
        },
      };
    },

    async planQuarantineMultipart(input) {
      validateObject(input);
      validateTtl(input.ttlSeconds);
      if (
        !Number.isSafeInteger(input.partSizeBytes) ||
        input.partSizeBytes < MIN_MULTIPART_PART_SIZE
      ) {
        throw authorityError('INVALID_MULTIPART_PLAN');
      }
      const partCount = Math.ceil(input.sizeBytes / input.partSizeBytes);
      if (partCount < 1 || partCount > MAX_MULTIPART_PARTS) {
        throw authorityError('INVALID_MULTIPART_PLAN');
      }
      const key = quarantineKey(input);
      let response: unknown;
      try {
        response = await options.client.send(
          new CreateMultipartUploadCommand({
            Bucket: options.bucket,
            Key: key,
            ContentType: input.contentType,
            Metadata: { sha256: input.sha256 },
          }),
        );
      } catch {
        throw authorityError('OBJECT_STORE_UNAVAILABLE');
      }
      const uploadId = headerString(record(response)?.['UploadId']);
      if (uploadId === null) {
        throw authorityError('OBJECT_STORE_UNAVAILABLE');
      }
      const expiresAt = expiration(clock, input.ttlSeconds);
      const parts = await Promise.all(
        Array.from({ length: partCount }, async (_, index) => {
          const partNumber = index + 1;
          const consumed = index * input.partSizeBytes;
          const sizeBytes = Math.min(
            input.partSizeBytes,
            input.sizeBytes - consumed,
          );
          let url: string;
          try {
            url = await options.presign(
              new UploadPartCommand({
                Bucket: options.bucket,
                Key: key,
                UploadId: uploadId,
                PartNumber: partNumber,
                ContentLength: sizeBytes,
              }),
              input.ttlSeconds,
            );
          } catch {
            throw authorityError('OBJECT_STORE_UNAVAILABLE');
          }
          return { partNumber, sizeBytes, url, expiresAt };
        }),
      );
      return {
        kind: 'multipart',
        bucket: options.bucket,
        key,
        uploadId,
        parts,
      };
    },

    async planVersionDownload(input) {
      validateVersionReference(input);
      validateTtl(input.ttlSeconds);
      const key = versionKey(input);
      let url: string;
      try {
        url = await options.presign(
          new GetObjectCommand({ Bucket: options.bucket, Key: key }),
          input.ttlSeconds,
        );
      } catch {
        throw authorityError('OBJECT_STORE_UNAVAILABLE');
      }
      return {
        bucket: options.bucket,
        key,
        url,
        expiresAt: expiration(clock, input.ttlSeconds),
      };
    },

    async completeQuarantineMultipart(input) {
      validateObject(input);
      if (
        input.multipartUploadId.length === 0 ||
        input.multipartUploadId.length > 1_024 ||
        input.parts.length === 0 ||
        input.parts.length > MAX_MULTIPART_PARTS ||
        input.parts.some(
          (part, index) =>
            part.partNumber !== index + 1 ||
            part.etag.length === 0 ||
            part.etag.length > 1_024 ||
            part.etag.split('').some((character) => {
              const code = character.charCodeAt(0);
              return code <= 31 || code === 127;
            }),
        )
      ) {
        throw authorityError('INVALID_MULTIPART_PLAN');
      }
      try {
        await options.client.send(
          new CompleteMultipartUploadCommand({
            Bucket: options.bucket,
            Key: quarantineKey(input),
            UploadId: input.multipartUploadId,
            MultipartUpload: {
              Parts: input.parts.map((part) => ({
                PartNumber: part.partNumber,
                ETag: part.etag,
              })),
            },
          }),
        );
      } catch {
        throw authorityError('OBJECT_STORE_UNAVAILABLE');
      }
    },

    async verifyQuarantineObject(input) {
      validateObject(input);
      const projection = await head(quarantineKey(input));
      if (projection === null) throw authorityError('OBJECT_NOT_FOUND');
      if (!matches(projection, input)) {
        throw authorityError('OBJECT_INTEGRITY_MISMATCH');
      }
    },

    async commitQuarantineObject(input) {
      validateObject(input);
      if (!validReference(input.versionId)) {
        throw authorityError('INVALID_OBJECT_REFERENCE');
      }
      const sourceKey = quarantineKey(input);
      const source = await head(sourceKey);
      if (source === null) throw authorityError('OBJECT_NOT_FOUND');
      if (!matches(source, input)) {
        throw authorityError('OBJECT_INTEGRITY_MISMATCH');
      }
      const raw = { bucket: options.bucket, key: rawKey(input) };
      const version = {
        bucket: options.bucket,
        key: versionKey(input),
      };
      const rawReused = await ensureCopy(sourceKey, raw, input);
      const versionReused = await ensureCopy(sourceKey, version, input);
      return {
        raw,
        version,
        reused: { raw: rawReused, version: versionReused },
      } satisfies CommittedObjectLocations;
    },

    async abortQuarantineObject(input) {
      validateObject(input);
      const key = quarantineKey(input);
      try {
        if (input.multipartUploadId !== undefined) {
          if (
            input.multipartUploadId.length === 0 ||
            input.multipartUploadId.length > 1_024
          ) {
            throw authorityError('INVALID_OBJECT_REFERENCE');
          }
          await options.client.send(
            new AbortMultipartUploadCommand({
              Bucket: options.bucket,
              Key: key,
              UploadId: input.multipartUploadId,
            }),
          );
        }
        await options.client.send(
          new DeleteObjectCommand({ Bucket: options.bucket, Key: key }),
        );
      } catch (error) {
        if (error instanceof ObjectStoreAuthorityError) throw error;
        throw authorityError('OBJECT_STORE_UNAVAILABLE');
      }
    },
  };
}
