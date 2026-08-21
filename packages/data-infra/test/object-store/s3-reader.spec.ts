import { describe, expect, it } from 'vitest';

import {
  createS3AuthorityObjectReader,
  type S3AuthorityCommandClient,
} from '../../src/object-store/index.js';

const tenantId = '61000000-0000-4000-8000-000000000001';
const projectId = '61000000-0000-4000-8000-000000000002';
const uploadId = '61000000-0000-4000-8000-000000000003';

class FakeClient implements S3AuthorityCommandClient {
  readonly commands: Array<{
    readonly name: string;
    readonly input: Readonly<Record<string, unknown>>;
  }> = [];
  oversized = false;

  send(command: unknown): Promise<unknown> {
    const value = command as {
      readonly constructor: { readonly name: string };
      readonly input: Readonly<Record<string, unknown>>;
    };
    this.commands.push({ name: value.constructor.name, input: value.input });
    if (value.constructor.name === 'HeadObjectCommand') {
      return Promise.resolve({
        ContentLength: 6,
        ContentType: 'application/geo+json',
        ETag: 'etag-fixture',
        Metadata: {},
      });
    }
    return Promise.resolve({
      Body: (async function* (oversized: boolean) {
        await Promise.resolve();
        yield new Uint8Array([1, 2, 3]);
        yield new Uint8Array(oversized ? [4, 5, 6, 7] : [4, 5, 6]);
      })(this.oversized),
    });
  }
}

describe('bounded S3 authority reader', () => {
  it('derives the quarantine key and returns a bounded stream without arbitrary paths', async () => {
    const client = new FakeClient();
    const reader = createS3AuthorityObjectReader({
      bucket: 'wiser-authority',
      client,
    });
    await expect(
      reader.statQuarantineObject({ tenantId, projectId, uploadId }),
    ).resolves.toEqual({
      sizeBytes: 6,
      contentType: 'application/geo+json',
      etag: 'etag-fixture',
    });
    const stream = await reader.readQuarantineObject({
      tenantId,
      projectId,
      uploadId,
      maximumBytes: 6,
    });
    const bytes: number[] = [];
    for await (const chunk of stream) bytes.push(...chunk);
    expect(bytes).toEqual([1, 2, 3, 4, 5, 6]);
    expect(
      client.commands.every(({ input }) =>
        String(input['Key']).endsWith(`/quarantine/${uploadId}/object`),
      ),
    ).toBe(true);
  });

  it('fails closed on traversal and streaming size overflow', async () => {
    const client = new FakeClient();
    const reader = createS3AuthorityObjectReader({
      bucket: 'wiser-authority',
      client,
    });
    await expect(
      reader.statQuarantineObject({
        tenantId: '../tenant',
        projectId,
        uploadId,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_OBJECT_REFERENCE' });
    expect(client.commands).toHaveLength(0);

    client.oversized = true;
    const stream = await reader.readQuarantineObject({
      tenantId,
      projectId,
      uploadId,
      maximumBytes: 6,
    });
    await expect(async () => {
      for await (const _chunk of stream) {
        // Drain the bounded authority stream.
      }
    }).rejects.toMatchObject({ code: 'OBJECT_INTEGRITY_MISMATCH' });
  });
});
