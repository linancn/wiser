// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ExplorationWorkspace } from './exploration-workspace';
afterEach(cleanup);
it('expands the same mounted workspace and restores focus, scroll and body overflow on Escape', () => {
  document.body.style.overflow = 'auto';
  render(
    <ExplorationWorkspace locale="zh-CN">
      <input aria-label="reading position" defaultValue="saved selection" />
    </ExplorationWorkspace>,
  );
  const input = screen.getByRole('textbox');
  const button = screen.getByRole('button', { name: '全屏工作区' });
  fireEvent.change(input, { target: { value: 'kept position' } });
  button.focus();
  fireEvent.click(button);
  const panel = screen.getByRole('dialog');
  panel.scrollTop = 80;
  expect(screen.getByRole('textbox')).toBe(input);
  expect(document.body.style.overflow).toBe('hidden');
  fireEvent.keyDown(panel, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('textbox')).toBe(input);
  expect((input as HTMLInputElement).value).toBe('kept position');
  expect(document.activeElement).toBe(button);
  expect(document.body.style.overflow).toBe('auto');
});
it('keeps keyboard focus inside the expanded workspace and releases body scrolling on unmount', () => {
  document.body.style.overflow = '';
  const view = render(
    <ExplorationWorkspace locale="en">
      <button>Last action</button>
    </ExplorationWorkspace>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Expand workspace' }));
  const last = screen.getByRole('button', { name: 'Last action' });
  last.focus();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Exit expanded workspace' }),
  );
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(last);
  view.unmount();
  expect(document.body.style.overflow).toBe('');
});

it('uses Escape to exit full screen before a child graph clears its selection', () => {
  const clearSelection = vi.fn();
  render(
    <ExplorationWorkspace locale="en">
      <button onKeyDown={clearSelection}>Selected graph</button>
    </ExplorationWorkspace>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Expand workspace' }));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Selected graph' }), {
    key: 'Escape',
  });
  expect(clearSelection).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});
