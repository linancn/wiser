// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateAssessmentInputSchema } from '@wiser/data-contracts';
import { DataAssessment } from './data-assessment';
const id = '00000000-0000-4000-8000-000000000001';
const asset = { assetId: id, sourceHash: 'a'.repeat(64) };
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('submits explicit unknowns and preserves the same command on an ambiguous retry', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new Error('private upstream failure'));
  vi.stubGlobal('fetch', request);
  render(
    <DataAssessment
      locale="zh-CN"
      dataItemId={id}
      versionId={id}
      asset={asset}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByText('资料取得与使用检查'));
  await user.type(
    screen.getByLabelText('核查依据'),
    '原文件第 1 页，单位未注明',
  );
  await user.click(screen.getByRole('button', { name: '保存并检查' }));
  await screen.findByRole('alert');
  await user.click(screen.getByRole('button', { name: '保存并检查' }));
  const [first, second] = request.mock.calls;
  expect(new Headers(first?.[1]?.headers).get('Idempotency-Key')).toBe(
    new Headers(second?.[1]?.headers).get('Idempotency-Key'),
  );
  const body = CreateAssessmentInputSchema.parse(
    JSON.parse(first?.[1]?.body as string),
  );
  expect(body.declaration.access).toBe('UNKNOWN');
  expect(body.declaration.coverage).toBe('UNKNOWN');
  expect(body.declaration.metadata).not.toHaveProperty('measures');
  expect(screen.queryByText(/private upstream/)).toBeNull();
});
it('shows unknown state and explains that registration is separate from use', () => {
  render(
    <DataAssessment locale="en" dataItemId={id} versionId={id} asset={null} />,
  );
  expect(screen.getByText('Acquisition and use checks')).toBeDefined();
  expect(screen.getByText(/Not checked/)).toBeDefined();
  expect(
    screen
      .getByRole('button', { name: 'Save and check', hidden: true })
      .hasAttribute('disabled'),
  ).toBe(true);
});
