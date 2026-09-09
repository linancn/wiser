import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

describe('observability CI image lifecycle', () => {
  it('builds the local shared application image before starting the isolated profile', () => {
    const workflow = readFileSync(
      resolve(repositoryRoot, '.github/workflows/ci.yml'),
      'utf8',
    );
    const observabilityJob = workflow.slice(
      workflow.indexOf('\n  observability:'),
    );
    const buildImage = observabilityJob.indexOf('docker compose build api');
    const startProfile = observabilityJob.indexOf(
      'docker compose --profile observability up',
    );

    expect(buildImage).toBeGreaterThan(-1);
    expect(startProfile).toBeGreaterThan(buildImage);
  });
});
