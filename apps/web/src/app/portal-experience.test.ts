import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('public WISER portal route', () => {
  it('routes the unlocalized entry to the Chinese portal', async () => {
    const source = await readFile(
      new URL('(redirect)/page.tsx', new URL('./', import.meta.url)),
      'utf8',
    );
    expect(source).toContain("redirect('/zh-CN')");
    expect(source).not.toContain('/zh-CN/scenarios');
  });

  it('renders a real locale portal instead of forwarding into one system', async () => {
    const source = await readFile(
      new URL('[locale]/page.tsx', new URL('./', import.meta.url)),
      'utf8',
    );
    expect(source).toContain('PortalLanding');
    expect(source).not.toContain('redirect(');
  });
});
