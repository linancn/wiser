import { PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';

import {
  createS3AuthorityPresigner,
  createSeaweedFsS3Client,
} from '../../src/object-store/config.js';

function fixtureClient() {
  return createSeaweedFsS3Client({
    endpoint: 'http://127.0.0.1:8333',
    region: 'us-east-1',
    bucket: 'wiser-authority',
    forcePathStyle: true,
    credentials: {
      accessKeyId: 'wiser-data',
      secretAccessKey: 'not-a-real-secret',
    },
  });
}

describe('SeaweedFS S3 client compatibility', () => {
  it('only calculates and validates checksums when the operation requires them', async () => {
    const client = fixtureClient();

    await expect(client.config.requestChecksumCalculation()).resolves.toBe(
      'WHEN_REQUIRED',
    );
    await expect(client.config.responseChecksumValidation()).resolves.toBe(
      'WHEN_REQUIRED',
    );

    client.destroy();
  });

  it('keeps integrity metadata in signed headers instead of duplicating it in the query', async () => {
    const client = fixtureClient();
    const presign = createS3AuthorityPresigner(client);
    const url = new URL(
      await presign(
        new PutObjectCommand({
          Bucket: 'wiser-authority',
          Key: 'quarantine/upload/object',
          ContentLength: 3,
          ContentType: 'application/octet-stream',
          Metadata: { sha256: 'a'.repeat(64) },
        }),
        300,
      ),
    );

    expect(url.searchParams.has('x-amz-meta-sha256')).toBe(false);
    expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toContain(
      'x-amz-meta-sha256',
    );

    client.destroy();
  });
});
