// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataExplorerInspector } from './data-explorer-inspector';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('opens mobile details without clearing the selection and returns keyboard focus when collapsed', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const user = userEvent.setup();
  const props = { locale: 'en' as const, selectionKey: 'record-1' };
  const view = render(
    <DataExplorerInspector {...props}>
      <h2>Source evidence</h2>
      <a href="#source">Read source</a>
    </DataExplorerInspector>,
  );
  const toggle = screen.getByRole('button', { name: 'Inspect selection' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  await user.click(toggle);
  const inspector = screen.getByTestId('explorer-inspector');
  await waitFor(() => expect(document.activeElement).toBe(inspector));
  expect(inspector.getAttribute('data-expanded')).toBe('true');
  fireEvent.keyDown(inspector, { key: 'Escape' });
  await waitFor(() => expect(document.activeElement).toBe(toggle));
  expect(inspector.getAttribute('data-expanded')).toBe('false');
  expect(screen.getByRole('heading', { name: 'Source evidence' })).toBeTruthy();
  view.rerender(
    <DataExplorerInspector locale="en" selectionKey={null}>
      <p>Select a source</p>
    </DataExplorerInspector>,
  );
  expect(
    screen.queryByRole('button', { name: 'Inspect selection' }),
  ).toBeNull();
});
