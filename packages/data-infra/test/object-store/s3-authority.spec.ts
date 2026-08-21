import { describe, expect, it, vi } from 'vitest';

import {
  ObjectStoreAuthorityError,
  createS3AuthorityObjectStore,
  loadSeaweedFsS3AuthorityConfig,
  type S3AuthorityCommandClient,
  type S3AuthorityPresigner,
} from '../../src/object-store/index.js';

const TENANT_ID = '71000000-0000-4000-8000-000000000001';
const PROJECT_ID = '71000000-0000-4000-8000-000000000002';
const UPLOAD_ID = '71000000-0000-4000-8000-000000000003';
const VERSION_ID = '71000000-0000-4000-8000-000000000004';
const HASH = 'a'.repeat(64);
const SIZE = 12_345;

interface StoredObject {
  readonly size: number;
  readonly sha256: string;
  readonly etag: string;
}

interface CommandLike {
  readonly constructor: { readonly name: string };
  readonly input: Readonly<Record<string, unknown>>;
}

function commandLike(value: unknown): CommandLike {
  return value as CommandLike;
}

function notFound() {
  return Object.assign(new Error('storage endpoint secret detail'), {
    name: 'NotFound',
    $metadata: { httpStatusCode: 404 },
  });
}

class MemoryS3Client implements S3AuthorityCommandClient {
  readonly objects = new Map<string, StoredObject>();
  readonly commands: CommandLike[] = [];
  multipartUploadId = 'multipart-001';

  send(command: unknown): Promise<unknown> {
    const current = commandLike(command);
    this.commands.push(current);
    const keyValue = current.input['Key'];
    const key = typeof keyValue === 'string' ? keyValue : '';

    if (current.constructor.name === 'HeadObjectCommand') {
      const object = this.objects.get(key);
      if (object === undefined) return Promise.reject(notFound());
      return Promise.resolve({
        ContentLength: object.size,
        ETag: object.etag,
        Metadata: { sha256: object.sha256 },
      });
    }
    if (current.constructor.name === 'CopyObjectCommand') {
      const source = decodeURIComponent(String(current.input['CopySource']));
      const sourceKey = source.slice(source.indexOf('/') + 1);
      const object = this.objects.get(sourceKey);
      if (object === undefined) return Promise.reject(notFound());
      this.objects.set(key, object);
      return Promise.resolve({ CopyObjectResult: { ETag: object.etag } });
    }
    if (current.constructor.name === 'CreateMultipartUploadCommand') {
      return Promise.resolve({ UploadId: this.multipartUploadId });
    }
    if (current.constructor.name === 'DeleteObjectCommand') {
      this.objects.delete(key);
      return Promise.resolve({});
    }
    if (current.constructor.name === 'AbortMultipartUploadCommand') {
      return Promise.resolve({});
    }
    return Promise.resolve({});
  }
}

function fixture() {
  const client = new MemoryS3Client();
  const presign: S3AuthorityPresigner = vi.fn((command, expiresIn) =>
    Promise.resolve(
      `http://seaweedfs:8333/signed/${commandLike(command).constructor.name}?ttl=${expiresIn}`,
    ),
  );
  const store = createS3AuthorityObjectStore({
    bucket: 'wiser-authority',
    client,
    presign,
    clock: () => new Date('2026-08-22T00:00:00.000Z'),
  });
  return { client, presign, store };
}

const objectInput = {
  tenantId: TENANT_ID,
  projectId: PROJECT_ID,
  uploadId: UPLOAD_ID,
  sha256: HASH,
  sizeBytes: SIZE,
  contentType: 'application/json',
} as const;

describe('S3-compatible authority object store', () => {
  it('creates a tenant/project-scoped content-addressed quarantine PUT', async () => {
    const { client, presign, store } = fixture();

    const plan = await store.planQuarantinePut({
      ...objectInput,
      ttlSeconds: 300,
    });

    expect(plan).toEqual({
      kind: 'single',
      bucket: 'wiser-authority',
      key: `tenants/${TENANT_ID}/projects/${PROJECT_ID}/quarantine/${UPLOAD_ID}/sha256/${HASH}`,
      url: 'http://seaweedfs:8333/signed/PutObjectCommand?ttl=300',
      expiresAt: '2026-08-22T00:05:00.000Z',
      requiredHeaders: {
        'content-length': String(SIZE),
        'content-type': 'application/json',
        'x-amz-meta-sha256': HASH,
      },
    });
    expect(client.commands).toEqual([]);
    expect(presign).toHaveBeenCalledOnce();
    expect(
      commandLike(vi.mocked(presign).mock.calls[0]?.[0]).input,
    ).toMatchObject({
      Bucket: 'wiser-authority',
      ContentLength: SIZE,
      ContentType: 'application/json',
      Metadata: { sha256: HASH },
    });
  });

  it.each([
    { tenantId: '../tenant' },
    { projectId: 'project/../../other' },
    { uploadId: `${UPLOAD_ID}/other` },
    { sha256: 'A'.repeat(64) },
    { sha256: 'abc' },
  ])(
    'rejects traversal and malformed hashes before I/O: %j',
    async (change) => {
      const { client, presign, store } = fixture();

      await expect(
        store.planQuarantinePut({
          ...objectInput,
          ...change,
          ttlSeconds: 300,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_OBJECT_REFERENCE' });
      expect(client.commands).toEqual([]);
      expect(presign).not.toHaveBeenCalled();
    },
  );

  it('enforces bounded signed URL TTLs for upload and committed download', async () => {
    const { presign, store } = fixture();

    for (const ttlSeconds of [0, 59, 901, 86_400]) {
      await expect(
        store.planQuarantinePut({ ...objectInput, ttlSeconds }),
      ).rejects.toMatchObject({ code: 'INVALID_SIGNED_URL_TTL' });
    }
    const download = await store.planVersionDownload({
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
      sha256: HASH,
      ttlSeconds: 60,
    });
    expect(download.expiresAt).toBe('2026-08-22T00:01:00.000Z');
    expect(download.url).toContain('GetObjectCommand?ttl=60');
    expect(presign).toHaveBeenCalledOnce();
  });

  it('builds a bounded multipart plan with exact part ranges', async () => {
    const { client, presign, store } = fixture();
    const partSizeBytes = 5 * 1024 * 1024;
    const sizeBytes = partSizeBytes * 2 + 17;

    const plan = await store.planQuarantineMultipart({
      ...objectInput,
      sizeBytes,
      partSizeBytes,
      ttlSeconds: 600,
    });

    expect(plan.kind).toBe('multipart');
    expect(plan.uploadId).toBe('multipart-001');
    expect(
      plan.parts.map(({ partNumber, sizeBytes: partSize }) => [
        partNumber,
        partSize,
      ]),
    ).toEqual([
      [1, partSizeBytes],
      [2, partSizeBytes],
      [3, 17],
    ]);
    expect(
      client.commands.filter(
        ({ constructor }) =>
          constructor.name === 'CreateMultipartUploadCommand',
      ),
    ).toHaveLength(1);
    expect(presign).toHaveBeenCalledTimes(3);
    expect(
      vi
        .mocked(presign)
        .mock.calls.map(
          ([command]) => commandLike(command).input['PartNumber'],
        ),
    ).toEqual([1, 2, 3]);
  });

  it('completes multipart uploads with an ordered, duplicate-free part manifest', async () => {
    const { client, store } = fixture();

    await store.completeQuarantineMultipart({
      ...objectInput,
      multipartUploadId: 'multipart-001',
      parts: [
        { partNumber: 1, etag: 'etag-part-1' },
        { partNumber: 2, etag: 'etag-part-2' },
      ],
    });

    const completion = client.commands.find(
      ({ constructor }) =>
        constructor.name === 'CompleteMultipartUploadCommand',
    );
    expect(completion?.input).toMatchObject({
      Bucket: 'wiser-authority',
      UploadId: 'multipart-001',
      MultipartUpload: {
        Parts: [
          { PartNumber: 1, ETag: 'etag-part-1' },
          { PartNumber: 2, ETag: 'etag-part-2' },
        ],
      },
    });

    await expect(
      store.completeQuarantineMultipart({
        ...objectInput,
        multipartUploadId: 'multipart-001',
        parts: [
          { partNumber: 1, etag: 'etag-part-1' },
          { partNumber: 1, etag: 'etag-duplicate' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_MULTIPART_PLAN' });
  });

  it('verifies HEAD size and SHA-256 metadata before authority commit', async () => {
    const { client, store } = fixture();
    const plan = await store.planQuarantinePut({
      ...objectInput,
      ttlSeconds: 300,
    });
    client.objects.set(plan.key, {
      size: SIZE + 1,
      sha256: HASH,
      etag: 'etag-quarantine',
    });

    await expect(
      store.verifyQuarantineObject(objectInput),
    ).rejects.toMatchObject({ code: 'OBJECT_INTEGRITY_MISMATCH' });
    client.objects.set(plan.key, {
      size: SIZE,
      sha256: 'b'.repeat(64),
      etag: 'etag-quarantine',
    });
    await expect(
      store.verifyQuarantineObject(objectInput),
    ).rejects.toMatchObject({ code: 'OBJECT_INTEGRITY_MISMATCH' });
  });

  it('copies quarantine into immutable raw/version namespaces idempotently', async () => {
    const { client, store } = fixture();
    const plan = await store.planQuarantinePut({
      ...objectInput,
      ttlSeconds: 300,
    });
    client.objects.set(plan.key, {
      size: SIZE,
      sha256: HASH,
      etag: 'etag-quarantine',
    });

    const first = await store.commitQuarantineObject({
      ...objectInput,
      versionId: VERSION_ID,
    });
    const second = await store.commitQuarantineObject({
      ...objectInput,
      versionId: VERSION_ID,
    });

    expect(first.raw.key).toBe(
      `tenants/${TENANT_ID}/projects/${PROJECT_ID}/raw/sha256/aa/${HASH}`,
    );
    expect(first.version.key).toBe(
      `tenants/${TENANT_ID}/projects/${PROJECT_ID}/versions/${VERSION_ID}/sha256/${HASH}`,
    );
    expect(first.reused).toEqual({ raw: false, version: false });
    expect(second.reused).toEqual({ raw: true, version: true });
    expect(
      client.commands.filter(
        ({ constructor }) => constructor.name === 'CopyObjectCommand',
      ),
    ).toHaveLength(2);
  });

  it('never overwrites a destination whose stored hash differs', async () => {
    const { client, store } = fixture();
    const plan = await store.planQuarantinePut({
      ...objectInput,
      ttlSeconds: 300,
    });
    client.objects.set(plan.key, {
      size: SIZE,
      sha256: HASH,
      etag: 'etag-quarantine',
    });
    const first = await store.commitQuarantineObject({
      ...objectInput,
      versionId: VERSION_ID,
    });
    client.objects.set(first.version.key, {
      size: SIZE,
      sha256: 'b'.repeat(64),
      etag: 'etag-conflict',
    });
    const copiesBefore = client.commands.filter(
      ({ constructor }) => constructor.name === 'CopyObjectCommand',
    ).length;

    await expect(
      store.commitQuarantineObject({
        ...objectInput,
        versionId: VERSION_ID,
      }),
    ).rejects.toMatchObject({ code: 'IMMUTABLE_OBJECT_CONFLICT' });
    expect(
      client.commands.filter(
        ({ constructor }) => constructor.name === 'CopyObjectCommand',
      ),
    ).toHaveLength(copiesBefore);
    expect(client.objects.get(first.version.key)?.sha256).toBe('b'.repeat(64));
  });

  it('aborts only the derived quarantine key and never committed content', async () => {
    const { client, store } = fixture();
    const plan = await store.planQuarantinePut({
      ...objectInput,
      ttlSeconds: 300,
    });
    client.objects.set(plan.key, {
      size: SIZE,
      sha256: HASH,
      etag: 'etag-quarantine',
    });
    const committed = await store.commitQuarantineObject({
      ...objectInput,
      versionId: VERSION_ID,
    });

    await store.abortQuarantineObject(objectInput);

    expect(client.objects.has(plan.key)).toBe(false);
    expect(client.objects.has(committed.raw.key)).toBe(true);
    expect(client.objects.has(committed.version.key)).toBe(true);
    const deletion = client.commands.find(
      ({ constructor }) => constructor.name === 'DeleteObjectCommand',
    );
    expect(deletion?.input['Key']).toContain('/quarantine/');
  });
});

describe('SeaweedFS S3 authority configuration', () => {
  it('prefers canonical DATA_S3_* names over compatibility aliases', () => {
    expect(
      loadSeaweedFsS3AuthorityConfig({
        DATA_S3_ENDPOINT: 'http://seaweedfs:8333',
        DATA_S3_REGION: 'us-east-1',
        DATA_S3_BUCKET: 'wiser-canonical',
        DATA_S3_ACCESS_KEY_ID: 'canonical-access',
        DATA_S3_SECRET_ACCESS_KEY: 'canonical-secret',
        WISER_DATA_S3_ENDPOINT: 'http://legacy-store:9000',
        WISER_DATA_S3_REGION: 'legacy-region',
        WISER_DATA_S3_BUCKET: 'wiser-legacy',
        WISER_DATA_S3_ACCESS_KEY_ID: 'legacy-access',
        WISER_DATA_S3_SECRET_ACCESS_KEY: 'legacy-secret',
      }),
    ).toMatchObject({
      endpoint: 'http://seaweedfs:8333',
      region: 'us-east-1',
      bucket: 'wiser-canonical',
      credentials: {
        accessKeyId: 'canonical-access',
        secretAccessKey: 'canonical-secret',
      },
    });
  });

  it('forces path-style access and exact server-only credentials', () => {
    expect(
      loadSeaweedFsS3AuthorityConfig({
        WISER_DATA_S3_ENDPOINT: 'http://seaweedfs:8333',
        WISER_DATA_S3_REGION: 'us-east-1',
        WISER_DATA_S3_BUCKET: 'wiser-authority',
        WISER_DATA_S3_ACCESS_KEY_ID: 'local-access-key',
        WISER_DATA_S3_SECRET_ACCESS_KEY: 'local-secret-key-value',
      }),
    ).toEqual({
      endpoint: 'http://seaweedfs:8333',
      region: 'us-east-1',
      bucket: 'wiser-authority',
      forcePathStyle: true,
      credentials: {
        accessKeyId: 'local-access-key',
        secretAccessKey: 'local-secret-key-value',
      },
    });
  });

  it('keeps the previous WISER_DATA_S3_* names as a compatibility alias', () => {
    expect(
      loadSeaweedFsS3AuthorityConfig({
        WISER_DATA_S3_ENDPOINT: 'http://seaweedfs:8333',
        WISER_DATA_S3_REGION: 'us-east-1',
        WISER_DATA_S3_BUCKET: 'wiser-authority',
        WISER_DATA_S3_ACCESS_KEY_ID: 'legacy-access-key',
        WISER_DATA_S3_SECRET_ACCESS_KEY: 'legacy-secret-key-value',
      }),
    ).toMatchObject({
      endpoint: 'http://seaweedfs:8333',
      bucket: 'wiser-authority',
    });
  });

  it('fails with one redacted error for unsafe or missing configuration', () => {
    const secret = 'do-not-echo-this-secret';
    let caught: unknown;
    try {
      loadSeaweedFsS3AuthorityConfig({
        WISER_DATA_S3_ENDPOINT: `file:///tmp/${secret}`,
        WISER_DATA_S3_REGION: 'us-east-1',
        WISER_DATA_S3_BUCKET: '../unsafe-bucket',
        WISER_DATA_S3_ACCESS_KEY_ID: secret,
        WISER_DATA_S3_SECRET_ACCESS_KEY: secret,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ObjectStoreAuthorityError);
    expect((caught as ObjectStoreAuthorityError).code).toBe(
      'INVALID_OBJECT_STORE_CONFIGURATION',
    );
    expect((caught as Error).message).not.toContain(secret);
  });
});
