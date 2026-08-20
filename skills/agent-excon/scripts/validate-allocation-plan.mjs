#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

const sourceIds = new Set(['guanting', 'south-water', 'reclaimed-lower']);
const sectionIds = new Set([
  'sanjiadian',
  'lugouqiao',
  'cuizhihuiying',
  'qujiadian',
]);

function fail(message) {
  process.stderr.write(`${JSON.stringify({ valid: false, error: message })}\n`);
  process.exitCode = 1;
}

const file = process.argv[2];
if (!file) {
  fail('Usage: validate-allocation-plan.mjs <plan.json>');
} else {
  try {
    const plan = JSON.parse(await readFile(file, 'utf8'));
    if (plan === null || typeof plan !== 'object' || Array.isArray(plan)) {
      throw new Error('plan must be a JSON object');
    }
    if (!Number.isInteger(plan.stage) || plan.stage < 1 || plan.stage > 2) {
      throw new Error('stage must be 1 or 2');
    }
    if (
      !Array.isArray(plan.sourceReleases) ||
      plan.sourceReleases.length === 0
    ) {
      throw new Error('sourceReleases must contain at least one release');
    }
    const seenSources = new Set();
    for (const release of plan.sourceReleases) {
      if (
        !sourceIds.has(release.sourceId) ||
        seenSources.has(release.sourceId)
      ) {
        throw new Error(
          `invalid or duplicate sourceId: ${String(release.sourceId)}`,
        );
      }
      seenSources.add(release.sourceId);
      if (
        typeof release.flowM3s !== 'number' ||
        !Number.isFinite(release.flowM3s) ||
        release.flowM3s < 0 ||
        Math.abs(release.flowM3s * 10 - Math.round(release.flowM3s * 10)) > 1e-9
      ) {
        throw new Error(
          `${release.sourceId}.flowM3s must be a non-negative 0.1 increment`,
        );
      }
      if (!Array.isArray(release.evidenceRefs)) {
        throw new Error(`${release.sourceId}.evidenceRefs must be an array`);
      }
    }
    if (
      !Array.isArray(plan.expectedSectionFlows) ||
      plan.expectedSectionFlows.length !== 4
    ) {
      throw new Error('expectedSectionFlows must contain all four sections');
    }
    const seenSections = new Set();
    for (const section of plan.expectedSectionFlows) {
      if (
        !sectionIds.has(section.sectionId) ||
        seenSections.has(section.sectionId)
      ) {
        throw new Error(
          `invalid or duplicate sectionId: ${String(section.sectionId)}`,
        );
      }
      seenSections.add(section.sectionId);
      if (
        typeof section.flowM3s !== 'number' ||
        !Number.isFinite(section.flowM3s)
      ) {
        throw new Error(`${section.sectionId}.flowM3s must be finite`);
      }
    }
    if (typeof plan.isFinal !== 'boolean') {
      throw new Error('isFinal must be boolean');
    }
    process.stdout.write(`${JSON.stringify({ valid: true })}\n`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
