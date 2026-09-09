// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReconciliationBatchSchema } from '@wiser/data-contracts';
import { DataReconciliation } from './data-reconciliation';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const assets = [4, 5].map((n, index) => ({
  assetId: id(n),
  sourceHash: (index ? 'b' : 'a').repeat(64),
  status: 'READY' as const,
  recordCount: 2,
  featureCount: 0,
  reason: null,
  paths: [`observations.${index ? 'xlsx' : 'csv'}`],
  columns: [
    { key: 'c1', label: 'Station' },
    { key: 'c2', label: 'Value' },
  ],
}));
function batch() {
  const sources = assets.map((a) => ({
    dataItemId: id(1),
    versionId: id(2),
    analysisId: id(3),
    assetId: a.assetId,
    sourceHash: a.sourceHash,
    paths: a.paths,
    recordCount: 2,
  }));
  return ReconciliationBatchSchema.parse({
    batchId: id(6),
    version: 1,
    status: 'CANDIDATE',
    title: 'Station observations',
    createdAt: '2026-09-09T10:00:00Z',
    reviewedAt: null,
    reviewNote: null,
    independentObservationCount: null,
    input: {
      title: 'Station observations',
      left: {
        dataItemId: id(1),
        versionId: id(2),
        analysisId: id(3),
        assetId: id(4),
      },
      right: {
        dataItemId: id(1),
        versionId: id(2),
        analysisId: id(3),
        assetId: id(5),
      },
      plan: {
        keys: [
          {
            name: 'station',
            leftField: 'c1',
            rightField: 'c1',
            type: 'text',
            trim: false,
          },
        ],
        left: {
          valueField: 'c2',
          measure: { literal: 'level' },
          unit: { literal: 'm' },
        },
        right: {
          valueField: 'c2',
          measure: { literal: 'level' },
          unit: { literal: 'm' },
        },
        unitConversions: [],
        conflictPolicy: 'preserve',
      },
    },
    sources,
    summary: {
      fileCount: 2,
      parsedRecordCount: 4,
      candidateObservationCount: 2,
      duplicateRecordCount: 2,
      unchangedCount: 2,
      leftOnlyCount: 0,
      addedCount: 0,
      revisedCount: 0,
      conflictCount: 0,
      incompleteRecordCount: 0,
      relation: 'FORMAT_COPY_CANDIDATE',
    },
  });
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const renderView = () =>
  render(
    <DataReconciliation
      locale="en"
      dataItemId={id(1)}
      versionId={id(2)}
      queryId={id(7)}
      initialAnalysisId={id(3)}
      assets={assets}
    />,
  );
it('keeps ambiguous create retries on one command key and reports verified observations only after review', async () => {
  let value = batch(),
    attempts = 0;
  const keys: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      await Promise.resolve();
      if (url.endsWith('/list')) return Response.json({ items: [] });
      if (url.endsWith('/create')) {
        keys.push(new Headers(init.headers).get('Idempotency-Key') ?? '');
        if (attempts++ === 0) throw Error('Ambiguous timeout');
        return Response.json({ batch: value });
      }
      if (url.endsWith('/review')) {
        value = {
          ...value,
          status: 'VERIFIED',
          version: 2,
          independentObservationCount: 2,
          reviewedAt: '2026-09-09T11:00:00Z',
          reviewNote: 'Checked all source rows',
        };
        return Response.json({ batch: value });
      }
      return Response.json({
        batch: value,
        groups: [],
        members: [],
        totalCount: 0,
      });
    }),
  );
  const user = userEvent.setup();
  renderView();
  await user.click(
    screen.getByText('Copy verification and observation deduplication'),
  );
  await user.type(
    screen.getByLabelText('Verification name'),
    'Station observations',
  );
  await user.selectOptions(
    screen.getByLabelText('Baseline file', { selector: 'select' }),
    id(4),
  );
  await user.selectOptions(
    screen.getByLabelText('Comparison file', { selector: 'select' }),
    id(5),
  );
  for (const select of screen.getAllByLabelText('Observation value field'))
    await user.selectOptions(select, 'c2');
  const literals = screen.getAllByLabelText('Constant', { selector: 'input' });
  for (const [index, input] of literals.entries())
    await user.type(input, index % 2 ? 'm' : 'level');
  await user.type(screen.getByLabelText('Business key name'), 'station');
  await user.selectOptions(screen.getByLabelText('Baseline field'), 'c1');
  await user.selectOptions(screen.getByLabelText('Comparison field'), 'c1');
  await user.click(screen.getByLabelText(/I confirm that these fields/));
  await user.click(
    screen.getByRole('button', { name: 'Calculate candidate results' }),
  );
  await screen.findByRole('alert');
  await user.click(
    screen.getByRole('button', { name: 'Calculate candidate results' }),
  );
  await screen.findByRole('heading', {
    name: 'Station observations · Pending verification',
  });
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  const region = screen.getByRole('region', { name: 'Station observations' });
  expect(
    within(region).getByText('Independent observations in this scope')
      .nextElementSibling?.textContent,
  ).toBe('Not counted / pending verification');
  expect(
    within(region)
      .getByRole('button', { name: 'Confirm verification' })
      .hasAttribute('disabled'),
  ).toBe(true);
  await user.type(
    screen.getByLabelText('Verification note'),
    'Checked all source rows',
  );
  await user.click(screen.getByLabelText(/I have checked the rules/));
  await user.click(
    screen.getByRole('button', { name: 'Confirm verification' }),
  );
  await screen.findByRole('heading', {
    name: 'Station observations · Verified',
  });
  expect(
    within(region).getByText('Independent observations in this scope')
      .nextElementSibling?.textContent,
  ).toBe('2');
  expect(within(region).getByText('Verified format copy')).toBeTruthy();
});
it('blocks confirmation for unresolved observations and clears retained results when access is lost', async () => {
  const value = batch();
  value.summary.candidateObservationCount = null;
  value.summary.conflictCount = 1;
  value.summary.relation = 'UNRESOLVED';
  let denied = false;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith('/list')
          ? Response.json({ items: [value] })
          : denied
            ? Response.json({}, { status: 403 })
            : Response.json({
                batch: value,
                groups: [],
                members: [],
                totalCount: 0,
              }),
      ),
    ),
  );
  const user = userEvent.setup();
  renderView();
  await user.click(
    screen.getByText('Copy verification and observation deduplication'),
  );
  await user.click(
    await screen.findByRole('button', {
      name: 'Station observations · Pending verification',
    }),
  );
  await screen.findByRole('heading', {
    name: 'Station observations · Pending verification',
  });
  await user.type(
    screen.getByLabelText('Verification note'),
    'Needs correction',
  );
  await user.click(screen.getByLabelText(/I have checked the rules/));
  expect(
    screen
      .getByRole('button', { name: 'Confirm verification' })
      .hasAttribute('disabled'),
  ).toBe(true);
  denied = true;
  await user.click(
    screen.getByRole('button', {
      name: 'Station observations · Pending verification',
    }),
  );
  await screen.findByRole('alert');
  expect(
    screen.queryByRole('region', { name: 'Station observations' }),
  ).toBeNull();
});
