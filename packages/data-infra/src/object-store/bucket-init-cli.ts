#!/usr/bin/env node

import {
  createSeaweedFsS3Client,
  loadSeaweedFsS3AuthorityConfig,
} from './config.js';
import { ensureAuthorityBucket } from './bucket-init.js';

async function main(): Promise<void> {
  const config = loadSeaweedFsS3AuthorityConfig(process.env);
  const client = createSeaweedFsS3Client(config);
  try {
    const result = await ensureAuthorityBucket({
      bucket: config.bucket,
      client,
    });
    process.stdout.write(
      `${JSON.stringify({ status: 'ready', created: result.created })}\n`,
    );
  } finally {
    client.destroy();
  }
}

void main().catch(() => {
  console.error('Data Foundation authority bucket bootstrap failed safely.');
  process.exitCode = 1;
});
