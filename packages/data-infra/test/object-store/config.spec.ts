import { describe, expect, it } from 'vitest';

import { createSeaweedFsS3Client } from '../../src/object-store/config.js';

describe('SeaweedFS S3 client compatibility', () => {
  it('only calculates and validates checksums when the operation requires them', async () => {
    const client = createSeaweedFsS3Client({
      endpoint: 'http://127.0.0.1:8333',
      region: 'us-east-1',
      bucket: 'wiser-authority',
      forcePathStyle: true,
      credentials: {
        accessKeyId: 'wiser-data',
        secretAccessKey: 'not-a-real-secret',
      },
    });

    await expect(client.config.requestChecksumCalculation()).resolves.toBe(
      'WHEN_REQUIRED',
    );
    await expect(client.config.responseChecksumValidation()).resolves.toBe(
      'WHEN_REQUIRED',
    );

    client.destroy();
  });
});
