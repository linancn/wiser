import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

import { ObjectStoreAuthorityError } from './errors.js';
import type { S3AuthorityCommandClient } from './types.js';

export interface S3QuarantineObjectReference {
  readonly tenantId: string;
  readonly projectId: string;
  readonly uploadId: string;
  readonly signal?: AbortSignal;
}

export interface S3QuarantineObjectStat {
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly etag: string;
  readonly sha256?: string;
}

export interface S3AuthorityObjectReader {
  statQuarantineObject(
    input: S3QuarantineObjectReference,
  ): Promise<S3QuarantineObjectStat>;
  readQuarantineObject(
    input: S3QuarantineObjectReference & { readonly maximumBytes: number },
  ): Promise<AsyncIterable<Uint8Array>>;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export interface VersionObjectReadInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly versionId: string;
  readonly sha256: string;
  readonly maximumBytes: number;
  readonly signal?: AbortSignal;
}

export function createS3VersionObjectReader(options: {
  readonly bucket: string;
  readonly client: S3AuthorityCommandClient;
}): (input: VersionObjectReadInput) => Promise<Uint8Array> {
  if (
    !safeBucket(options.bucket) ||
    typeof options.client?.send !== 'function'
  ) {
    throw new ObjectStoreAuthorityError('INVALID_OBJECT_STORE_CONFIGURATION');
  }
  return async (input) => {
    if (
      ![input.tenantId, input.projectId, input.versionId].every((id) =>
        UUID.test(id),
      ) ||
      !SHA256.test(input.sha256) ||
      !Number.isSafeInteger(input.maximumBytes) ||
      input.maximumBytes < 1 ||
      input.maximumBytes > 64 * 1024 * 1024
    )
      throw invalid();
    let body: unknown;
    try {
      const response = record(
        await options.client.send(
          new GetObjectCommand({
            Bucket: options.bucket,
            Key: `tenants/${input.tenantId}/projects/${input.projectId}/versions/${input.versionId}/sha256/${input.sha256}`,
          }),
          input.signal === undefined
            ? undefined
            : { abortSignal: input.signal },
        ),
      );
      body = response['Body'];
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of bodyIterable(body)) {
        if (!(chunk instanceof Uint8Array))
          throw new ObjectStoreAuthorityError('OBJECT_STORE_UNAVAILABLE');
        size += chunk.length;
        if (size > input.maximumBytes)
          throw new ObjectStoreAuthorityError('OBJECT_INTEGRITY_MISMATCH');
        chunks.push(chunk);
      }
      const combined = Buffer.concat(chunks, size);
      return new Uint8Array(
        combined.buffer,
        combined.byteOffset,
        combined.byteLength,
      );
    } catch (error) {
      if (error instanceof ObjectStoreAuthorityError) throw error;
      throw new ObjectStoreAuthorityError('OBJECT_STORE_UNAVAILABLE');
    } finally {
      if (body !== null && typeof body === 'object') {
        const destroy: unknown = Reflect.get(body, 'destroy');
        if (typeof destroy === 'function') Reflect.apply(destroy, body, []);
      }
    }
  };
}

function invalid(): ObjectStoreAuthorityError {
  return new ObjectStoreAuthorityError('INVALID_OBJECT_REFERENCE');
}

function validateReference(input: S3QuarantineObjectReference): void {
  if (
    !UUID.test(input.tenantId) ||
    !UUID.test(input.projectId) ||
    !UUID.test(input.uploadId) ||
    (input.signal !== undefined && !(input.signal instanceof AbortSignal))
  ) {
    throw invalid();
  }
}

function safeBucket(value: string): boolean {
  return (
    value.length >= 3 &&
    value.length <= 63 &&
    /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(value) &&
    !value.includes('..')
  );
}

function quarantineKey(input: S3QuarantineObjectReference): string {
  return `tenants/${input.tenantId}/projects/${input.projectId}/quarantine/${input.uploadId}/object`;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ObjectStoreAuthorityError('OBJECT_STORE_UNAVAILABLE');
  }
  return value as Readonly<Record<string, unknown>>;
}

function metadataHash(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const hash: unknown = Reflect.get(value, 'sha256');
  if (hash === undefined) return undefined;
  if (typeof hash !== 'string' || !SHA256.test(hash)) {
    throw new ObjectStoreAuthorityError('OBJECT_INTEGRITY_MISMATCH');
  }
  return hash;
}

function bodyIterable(value: unknown): AsyncIterable<unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof Reflect.get(value, Symbol.asyncIterator) !== 'function'
  ) {
    throw new ObjectStoreAuthorityError('OBJECT_STORE_UNAVAILABLE');
  }
  return value as AsyncIterable<unknown>;
}

export function createS3AuthorityObjectReader(options: {
  readonly bucket: string;
  readonly client: S3AuthorityCommandClient;
}): S3AuthorityObjectReader {
  if (
    !safeBucket(options.bucket) ||
    typeof options.client?.send !== 'function'
  ) {
    throw new ObjectStoreAuthorityError('INVALID_OBJECT_STORE_CONFIGURATION');
  }

  return Object.freeze({
    async statQuarantineObject(input: S3QuarantineObjectReference) {
      validateReference(input);
      try {
        const response = record(
          await options.client.send(
            new HeadObjectCommand({
              Bucket: options.bucket,
              Key: quarantineKey(input),
            }),
            input.signal === undefined
              ? undefined
              : { abortSignal: input.signal },
          ),
        );
        const sizeBytes = response['ContentLength'];
        const contentType = response['ContentType'];
        const etag = response['ETag'];
        if (
          typeof sizeBytes !== 'number' ||
          !Number.isSafeInteger(sizeBytes) ||
          sizeBytes < 0 ||
          typeof contentType !== 'string' ||
          contentType.length < 3 ||
          contentType.length > 255 ||
          typeof etag !== 'string' ||
          etag.length < 1 ||
          etag.length > 1_024
        ) {
          throw new ObjectStoreAuthorityError('OBJECT_INTEGRITY_MISMATCH');
        }
        const sha256 = metadataHash(response['Metadata']);
        return Object.freeze({
          sizeBytes,
          contentType,
          etag,
          ...(sha256 === undefined ? {} : { sha256 }),
        });
      } catch (error) {
        if (error instanceof ObjectStoreAuthorityError) throw error;
        throw new ObjectStoreAuthorityError('OBJECT_STORE_UNAVAILABLE');
      }
    },

    async readQuarantineObject(
      input: S3QuarantineObjectReference & { readonly maximumBytes: number },
    ) {
      validateReference(input);
      if (
        !Number.isSafeInteger(input.maximumBytes) ||
        input.maximumBytes < 1 ||
        input.maximumBytes > 5 * 1024 * 1024 * 1024 * 1024
      ) {
        throw invalid();
      }
      let body: unknown;
      try {
        const response = record(
          await options.client.send(
            new GetObjectCommand({
              Bucket: options.bucket,
              Key: quarantineKey(input),
            }),
            input.signal === undefined
              ? undefined
              : { abortSignal: input.signal },
          ),
        );
        body = response['Body'];
      } catch {
        throw new ObjectStoreAuthorityError('OBJECT_STORE_UNAVAILABLE');
      }
      const iterable = bodyIterable(body);
      return (async function* (): AsyncIterable<Uint8Array> {
        let total = 0;
        try {
          for await (const chunk of iterable) {
            if (!(chunk instanceof Uint8Array)) {
              throw new ObjectStoreAuthorityError('OBJECT_STORE_UNAVAILABLE');
            }
            total += chunk.length;
            if (total > input.maximumBytes) {
              const destroy: unknown = Reflect.get(body as object, 'destroy');
              if (typeof destroy === 'function') {
                Reflect.apply(destroy, body, []);
              }
              throw new ObjectStoreAuthorityError('OBJECT_INTEGRITY_MISMATCH');
            }
            yield chunk;
          }
        } catch (error) {
          if (error instanceof ObjectStoreAuthorityError) throw error;
          throw new ObjectStoreAuthorityError('OBJECT_STORE_UNAVAILABLE');
        }
      })();
    },
  });
}
