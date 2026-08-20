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
const rulesFile = process.argv[3];
if (!file) {
  fail('Usage: validate-allocation-plan.mjs <plan.json> [current-rules.json]');
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
      plan.sourceReleases.length !== 3
    ) {
      throw new Error('sourceReleases must contain all three sources');
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
        release.flowM3s > 100 ||
        Math.abs(release.flowM3s * 10 - Math.round(release.flowM3s * 10)) > 1e-9
      ) {
        throw new Error(
          `${release.sourceId}.flowM3s must be a non-negative 0.1 increment`,
        );
      }
      if (
        !Array.isArray(release.evidenceRefs) ||
        release.evidenceRefs.length === 0 ||
        release.evidenceRefs.some(
          (reference) => typeof reference !== 'string' || reference.length < 3,
        )
      ) {
        throw new Error(
          `${release.sourceId}.evidenceRefs must contain observed information IDs`,
        );
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
        !Number.isFinite(section.flowM3s) ||
        section.flowM3s < 0 ||
        section.flowM3s > 200
      ) {
        throw new Error(
          `${section.sectionId}.flowM3s must be between 0 and 200`,
        );
      }
    }
    if (typeof plan.isFinal !== 'boolean') {
      throw new Error('isFinal must be boolean');
    }
    if (
      (plan.stage === 1 && plan.isFinal) ||
      (plan.stage === 2 && !plan.isFinal)
    ) {
      throw new Error('stage 1 must be revisable and stage 2 must be final');
    }

    const checks = { structure: true, currentRules: rulesFile !== undefined };
    if (rulesFile !== undefined) {
      const rules = JSON.parse(await readFile(rulesFile, 'utf8'));
      if (
        rules === null ||
        typeof rules !== 'object' ||
        !Array.isArray(rules.sources) ||
        rules.sources.length !== 3 ||
        !Array.isArray(rules.sectionTargets) ||
        rules.sectionTargets.length !== 4 ||
        rules.transferModel === null ||
        typeof rules.transferModel !== 'object' ||
        typeof rules.totalReleaseLimitM3s !== 'number' ||
        !Number.isFinite(rules.totalReleaseLimitM3s) ||
        rules.totalReleaseLimitM3s < 0
      ) {
        throw new Error(
          'current-rules.json does not match the exercise rule shape',
        );
      }
      const releaseBySource = new Map(
        plan.sourceReleases.map((release) => [
          release.sourceId,
          release.flowM3s,
        ]),
      );
      const ruleSourceIds = new Set();
      for (const source of rules.sources) {
        if (
          !sourceIds.has(source.sourceId) ||
          ruleSourceIds.has(source.sourceId) ||
          typeof source.maximumFlowM3s !== 'number' ||
          !Number.isFinite(source.maximumFlowM3s) ||
          source.maximumFlowM3s < 0
        ) {
          throw new Error(
            `current rules contain an invalid or duplicate source: ${String(source.sourceId)}`,
          );
        }
        ruleSourceIds.add(source.sourceId);
        const release = releaseBySource.get(source.sourceId);
        if (typeof release !== 'number' || release > source.maximumFlowM3s) {
          throw new Error(
            `source limit exceeded or missing: ${String(source.sourceId)}`,
          );
        }
      }
      const totalRelease = [...releaseBySource.values()].reduce(
        (sum, value) => sum + value,
        0,
      );
      if (totalRelease > rules.totalReleaseLimitM3s) {
        throw new Error('totalReleaseLimitM3s exceeded');
      }
      const ruleSectionIds = new Set();
      for (const target of rules.sectionTargets) {
        if (
          !sectionIds.has(target.sectionId) ||
          ruleSectionIds.has(target.sectionId) ||
          typeof target.minimumFlowM3s !== 'number' ||
          !Number.isFinite(target.minimumFlowM3s) ||
          target.minimumFlowM3s < 0
        ) {
          throw new Error(
            `current rules contain an invalid or duplicate section target: ${String(target.sectionId)}`,
          );
        }
        ruleSectionIds.add(target.sectionId);
      }
      const coefficients = [
        'guantingToSanjiadian',
        'sanjiadianToLugouqiao',
        'lugouqiaoToCuizhihuiying',
        'cuizhihuiyingToQujiadian',
      ];
      for (const coefficient of coefficients) {
        const value = rules.transferModel[coefficient];
        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value <= 0 ||
          value > 1
        ) {
          throw new Error(`invalid transfer coefficient: ${coefficient}`);
        }
      }
      const guanting = releaseBySource.get('guanting') ?? 0;
      const southWater = releaseBySource.get('south-water') ?? 0;
      const reclaimedLower = releaseBySource.get('reclaimed-lower') ?? 0;
      const computed = {
        sanjiadian: rules.transferModel.guantingToSanjiadian * guanting,
      };
      computed.lugouqiao =
        rules.transferModel.sanjiadianToLugouqiao *
        (computed.sanjiadian + southWater);
      computed.cuizhihuiying =
        rules.transferModel.lugouqiaoToCuizhihuiying *
        (computed.lugouqiao + reclaimedLower);
      computed.qujiadian =
        rules.transferModel.cuizhihuiyingToQujiadian * computed.cuizhihuiying;
      if (Object.values(computed).some((value) => !Number.isFinite(value))) {
        throw new Error('computed section flows are not finite');
      }
      for (const section of plan.expectedSectionFlows) {
        const expected = computed[section.sectionId];
        if (
          typeof expected !== 'number' ||
          Math.abs(expected - section.flowM3s) > 0.01
        ) {
          throw new Error(`expected flow mismatch: ${section.sectionId}`);
        }
      }
      for (const target of rules.sectionTargets) {
        if (computed[target.sectionId] < target.minimumFlowM3s) {
          throw new Error(`ecological target not met: ${target.sectionId}`);
        }
      }
    }
    process.stdout.write(
      `${JSON.stringify({
        valid: true,
        checks,
        warnings:
          rulesFile === undefined
            ? [
                'current source limits, transfer model, and targets were not checked',
              ]
            : [],
      })}\n`,
    );
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
