// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AssessmentSchema,
  IntakeDeclarationSchema,
  IntakeSourceFactsSchema,
} from '@wiser/data-contracts';
import { DataSpatialSource } from './data-spatial-source';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function report(stale = false) {
  const declaration = IntakeDeclarationSchema.parse({
    kind: 'GIS',
    target: 'DATASET',
    expectedSourceHash: (stale ? 'b' : 'a').repeat(64),
    entry: 'VALID',
    access: 'PUBLIC',
    acquisition: 'ORIGINAL_ACQUIRED',
    coverage: 'COMPLETE',
    evidence: 'Synthetic technical note',
    metadata: {
      source: 'Synthetic river source',
      spatial: {
        method: 'Terrain-derived network',
        resolution: '15 arc seconds',
        timeMeaning: null,
        limitations: 'Not a surveyed present-day watercourse',
        evidence: 'Technical note, section 2',
      },
    },
  });
  const facts = IntakeSourceFactsSchema.parse({
    sourceHash: 'a'.repeat(64),
    mediaType: 'application/geo+json',
    byteSize: 100,
    parserVersion: 'synthetic.v1',
    status: 'READY',
    columns: [],
    recordCount: 1,
    featureCount: 1,
    reason: null,
    sourceRegistered: true,
  });
  return AssessmentSchema.parse({
    assessmentId: id,
    dataItemId: id,
    versionId: id,
    assetId: id,
    analysisId: null,
    createdAt: '2026-09-11T00:00:00Z',
    declaration,
    facts,
    result: {
      ruleVersion: 'wiser.intake.v1',
      sourceHash: facts.sourceHash,
      archive: 'RECORDED',
      position: 'UNCHECKED',
      target: declaration.target,
      access: declaration.access,
      entry: declaration.entry,
      acquisition: declaration.acquisition,
      coverage: declaration.coverage,
      nextAction: 'COMPLETE_METADATA',
      uses: {
        map: 'NEEDS_INFORMATION',
        calculation: 'NEEDS_INFORMATION',
        join: 'NEEDS_INFORMATION',
        citation: 'NEEDS_INFORMATION',
      },
      findings: stale
        ? [
            {
              code: 'SOURCE_CHANGED',
              path: 'expectedSourceHash',
              severity: 'NEEDS_INFORMATION',
            },
          ]
        : [],
    },
  });
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('loads exact latest file metadata on demand and never turns mappability into a position verdict', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ items: [report()] }));
  vi.stubGlobal('fetch', request);
  render(
    <DataSpatialSource
      locale="en"
      dataItemId={id}
      versionId={id}
      assetId={id}
      geometryAvailable
    />,
  );
  expect(request).not.toHaveBeenCalled();
  expect(screen.getByText(/Zooming does not improve/)).toBeDefined();
  await userEvent.click(screen.getByText('View source descriptions'));
  await screen.findByText('15 arc seconds');
  expect(screen.getByText('Independent position check pending')).toBeDefined();
  expect(screen.getByText('Unknown')).toBeDefined();
  expect(JSON.parse(request.mock.calls[0]?.[1]?.body as string)).toMatchObject({
    assetId: id,
    latestPerAsset: true,
    versionId: id,
  });
  expect(
    screen
      .getByRole('link', { name: 'View this original' })
      .getAttribute('href'),
  ).toBe(`/api/data-foundation/assets/${id}/${id}`);
});
it('discards stale source claims and clears reports after a denied next page', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ items: [report(true)], nextCursor: id }),
    )
    .mockResolvedValueOnce(new Response('', { status: 403 }));
  vi.stubGlobal('fetch', request);
  render(<DataSpatialSource locale="zh-CN" dataItemId={id} versionId={id} />);
  await userEvent.click(screen.getByText('查看来源说明'));
  await screen.findByText(/这份说明与原件不符/);
  expect(screen.queryByText('15 arc seconds')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: '下一页原件' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('link', { name: '查看这份原件' })).toBeNull();
  expect(screen.getByRole('button', { name: '重试' })).toBeDefined();
});
it('rejects a response for another source version', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        items: [
          { ...report(), versionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
        ],
      }),
    ),
  );
  render(<DataSpatialSource locale="en" dataItemId={id} versionId={id} />);
  await userEvent.click(screen.getByText('View source descriptions'));
  await screen.findByRole('alert');
  expect(screen.queryByText('15 arc seconds')).toBeNull();
});
