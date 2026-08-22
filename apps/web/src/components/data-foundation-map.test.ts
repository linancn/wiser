import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('MapLibre client boundary', () => {
  it('keeps MapLibre in a client leaf with CSS and deterministic cleanup', async () => {
    const source = await readFile(
      new URL('./data-foundation-map.tsx', import.meta.url),
      'utf8',
    );

    expect(source.trimStart()).toMatch(/^['"]use client['"]/);
    expect(source).toContain("import 'maplibre-gl/dist/maplibre-gl.css';");
    expect(source).toMatch(/return\s*\(\)\s*=>\s*map\.remove\(\)/);
    expect(source).not.toMatch(/access[_-]?token|secret|password/i);
  });
});
