import { describe, expect, it, vi } from 'vitest';
import { CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

import { ensureAuthorityBucket } from '../../src/object-store/bucket-init.js';

describe('SeaweedFS authority bucket bootstrap', () => {
  it('creates a missing bucket once and treats an existing bucket as ready', async () => {
    const send = vi
      .fn<(command: unknown) => Promise<unknown>>()
      .mockRejectedValueOnce(
        Object.assign(new Error('missing'), { name: 'NotFound' }),
      )
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await expect(
      ensureAuthorityBucket({ bucket: 'wiser-authority', client: { send } }),
    ).resolves.toEqual({ created: true });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadBucketCommand);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(CreateBucketCommand);

    await expect(
      ensureAuthorityBucket({ bucket: 'wiser-authority', client: { send } }),
    ).resolves.toEqual({ created: false });
    expect(send.mock.calls[2]?.[0]).toBeInstanceOf(HeadBucketCommand);
  });

  it('redacts backend details for non-missing failures', async () => {
    const failure = await ensureAuthorityBucket({
      bucket: 'wiser-authority',
      client: {
        send: () =>
          Promise.reject(new Error('secret=local-s3-key host=seaweedfs')),
      },
    }).catch((error: unknown) => error);
    expect(String(failure)).toContain('bucket bootstrap failed');
    expect(String(failure)).not.toContain('local-s3-key');
    expect(String(failure)).not.toContain('seaweedfs');
  });
});
