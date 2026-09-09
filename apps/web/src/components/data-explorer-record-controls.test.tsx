// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataExplorerRecordControls } from './data-explorer-record-controls';

afterEach(cleanup);
const assetId = '40000000-0000-4000-8000-000000000001';
const columns = [
  { key: 'c1', label: 'Station' },
  { key: 'c2', label: 'Level' },
  { key: 'c3', label: 'Comment' },
];
it('applies literal identifiers, numeric conditions, sorting and selected columns together', async () => {
  const onApply = vi.fn();
  const user = userEvent.setup();
  render(
    <DataExplorerRecordControls
      locale="en"
      assetId={assetId}
      columns={columns}
      onApply={onApply}
      busy={false}
    />,
  );
  await user.click(screen.getByText('Record conditions'));
  await user.click(screen.getByRole('button', { name: 'Add condition' }));
  const first = screen.getByRole('group', { name: 'Condition 1' });
  await user.type(within(first).getByLabelText('Value'), '0001');
  await user.click(screen.getByRole('button', { name: 'Add condition' }));
  const second = screen.getByRole('group', { name: 'Condition 2' });
  await user.selectOptions(within(second).getByLabelText('Field'), 'c2');
  await user.selectOptions(
    within(second).getByLabelText('Interpret as'),
    'number',
  );
  await user.selectOptions(within(second).getByLabelText('Comparison'), 'gte');
  await user.type(within(second).getByLabelText('Value'), '20.5');
  await user.selectOptions(screen.getByLabelText('Sort by'), 'c2');
  await user.selectOptions(screen.getByLabelText('Sort as'), 'number');
  await user.selectOptions(screen.getByLabelText('Order'), 'desc');
  await user.click(screen.getByRole('checkbox', { name: 'Comment' }));
  await user.click(screen.getByRole('button', { name: 'Apply to all views' }));
  expect(onApply).toHaveBeenCalledWith({
    assetId,
    filters: [
      { field: 'c1', type: 'text', operator: 'eq', value: '0001' },
      { field: 'c2', type: 'number', operator: 'gte', value: 20.5 },
    ],
    sort: { field: 'c2', type: 'number', direction: 'desc' },
    columns: ['c1', 'c2'],
  });
});
it('does not turn an empty numeric condition into zero or submit non-finite values', async () => {
  const onApply = vi.fn();
  const user = userEvent.setup();
  render(
    <DataExplorerRecordControls
      locale="en"
      assetId={assetId}
      columns={columns}
      onApply={onApply}
      busy={false}
    />,
  );
  await user.click(screen.getByText('Record conditions'));
  await user.click(screen.getByRole('button', { name: 'Add condition' }));
  await user.selectOptions(screen.getByLabelText('Interpret as'), 'number');
  await user.click(screen.getByRole('button', { name: 'Apply to all views' }));
  expect(onApply).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('finite number');
  await user.type(screen.getByLabelText('Value'), 'Infinity');
  await user.click(screen.getByRole('button', { name: 'Apply to all views' }));
  expect(onApply).not.toHaveBeenCalled();
  await user.clear(screen.getByLabelText('Value'));
  await user.type(screen.getByLabelText('Value'), '0');
  await user.click(screen.getByRole('button', { name: 'Apply to all views' }));
  expect(onApply).toHaveBeenCalledWith(
    expect.objectContaining({
      filters: [{ field: 'c1', type: 'number', operator: 'eq', value: 0 }],
    }),
  );
});
it('restores conditions and handles null checks, removing conditions and clearing configuration', async () => {
  const onApply = vi.fn();
  const user = userEvent.setup();
  render(
    <DataExplorerRecordControls
      locale="en"
      assetId={assetId}
      columns={columns}
      value={{
        assetId,
        filters: [{ field: 'c3', type: 'presence', operator: 'isNull' }],
        columns: ['c1'],
      }}
      onApply={onApply}
      busy={false}
    />,
  );
  expect(screen.getByLabelText<HTMLSelectElement>('Comparison').value).toBe(
    'isNull',
  );
  expect(screen.queryByLabelText('Value')).toBeNull();
  await user.selectOptions(screen.getByLabelText('Comparison'), 'isNotNull');
  await user.click(screen.getByRole('button', { name: 'Apply to all views' }));
  expect(onApply).toHaveBeenLastCalledWith({
    assetId,
    filters: [{ field: 'c3', type: 'presence', operator: 'isNotNull' }],
    columns: ['c1'],
  });
  await user.click(screen.getByRole('button', { name: 'Remove condition 1' }));
  expect(screen.queryByRole('group', { name: 'Condition 1' })).toBeNull();
  await user.click(
    screen.getByRole('button', { name: 'Clear record conditions' }),
  );
  expect(onApply).toHaveBeenLastCalledWith(undefined);
});
it('requires at least one displayed column and keeps the filter count bounded', async () => {
  const onApply = vi.fn();
  const user = userEvent.setup();
  render(
    <DataExplorerRecordControls
      locale="en"
      assetId={assetId}
      columns={columns}
      onApply={onApply}
      busy={false}
    />,
  );
  await user.click(screen.getByText('Record conditions'));
  for (const name of ['Station', 'Level', 'Comment'])
    await user.click(screen.getByRole('checkbox', { name }));
  await user.click(screen.getByRole('button', { name: 'Apply to all views' }));
  expect(onApply).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('column');
  for (let index = 0; index < 8; index++)
    await user.click(screen.getByRole('button', { name: 'Add condition' }));
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Add condition' })
      .disabled,
  ).toBe(true);
});

it('requires an explicit offset and preserves source-time semantics when applying and restoring filters', async () => {
  const onApply = vi.fn();
  const user = userEvent.setup();
  render(
    <DataExplorerRecordControls
      locale="en"
      assetId={assetId}
      columns={columns}
      onApply={onApply}
      busy={false}
    />,
  );
  await user.click(screen.getByText('Record conditions'));
  await user.click(screen.getByRole('button', { name: 'Add condition' }));
  await user.selectOptions(screen.getByLabelText('Interpret as'), 'time');
  await user.selectOptions(
    screen.getByLabelText('Source time format'),
    'dmy-local',
  );
  await user.type(screen.getByLabelText('Value'), '2024-02-29T16:00:00Z');
  await user.click(screen.getByRole('button', { name: 'Apply to all views' }));
  expect(onApply).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText('Fixed UTC offset'), '+08:00');
  await user.click(screen.getByRole('button', { name: 'Apply to all views' }));
  expect(onApply).toHaveBeenCalledWith({
    assetId,
    filters: [
      {
        field: 'c1',
        type: 'time',
        format: 'dmy-local',
        utcOffsetMinutes: 480,
        operator: 'eq',
        value: '2024-02-29T16:00:00Z',
      },
    ],
  });
});
