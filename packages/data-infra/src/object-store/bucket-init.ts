import { CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

interface BucketCommandClient {
  send(command: HeadBucketCommand | CreateBucketCommand): Promise<unknown>;
}

function validBucket(value: string): boolean {
  return (
    value.length >= 3 &&
    value.length <= 63 &&
    /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(value) &&
    !value.includes('..')
  );
}

function missingBucket(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const candidate = error as Readonly<Record<PropertyKey, unknown>>;
  const name = candidate['name'];
  const metadata = candidate['$metadata'];
  const status =
    metadata !== null && typeof metadata === 'object'
      ? (metadata as Readonly<Record<PropertyKey, unknown>>)['httpStatusCode']
      : undefined;
  return name === 'NotFound' || name === 'NoSuchBucket' || status === 404;
}

export async function ensureAuthorityBucket(options: {
  readonly bucket: string;
  readonly client: BucketCommandClient;
}): Promise<{ readonly created: boolean }> {
  if (
    !validBucket(options.bucket) ||
    typeof options.client?.send !== 'function'
  ) {
    throw new Error('Authority bucket bootstrap configuration is invalid.');
  }
  let unavailable = false;
  try {
    await options.client.send(
      new HeadBucketCommand({ Bucket: options.bucket }),
    );
    return Object.freeze({ created: false });
  } catch (error) {
    if (!missingBucket(error)) {
      unavailable = true;
    }
  }
  if (unavailable) throw new Error('Authority bucket bootstrap failed safely.');
  try {
    await options.client.send(
      new CreateBucketCommand({ Bucket: options.bucket }),
    );
    return Object.freeze({ created: true });
  } catch {
    throw new Error('Authority bucket bootstrap failed safely.');
  }
}
