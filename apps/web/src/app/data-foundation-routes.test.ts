import { access, readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { dictionaries } from '../lib/i18n';

const routePages = [
  '[locale]/data-foundation/page.tsx',
  '[locale]/data-foundation/catalog/page.tsx',
  '[locale]/data-foundation/catalog/[dataItemId]/page.tsx',
  '[locale]/data-foundation/ingestions/page.tsx',
  '[locale]/data-foundation/ingestions/[ingestionId]/page.tsx',
  '[locale]/data-foundation/operations/[operationId]/page.tsx',
  '[locale]/data-foundation/search/page.tsx',
  '[locale]/data-foundation/knowledge/page.tsx',
  '[locale]/data-foundation/graph/page.tsx',
  '[locale]/data-foundation/map/page.tsx',
  '[locale]/data-foundation/quality/page.tsx',
  '[locale]/data-foundation/lineage/[dataItemId]/page.tsx',
  '[locale]/data-foundation/geo/page.tsx',
  '[locale]/data-foundation/capabilities/page.tsx',
] as const;

describe('Data Foundation management routes', () => {
  it('ships every required localized server-rendered route', async () => {
    await Promise.all(
      routePages.map((path) =>
        access(new URL(path, new URL('./', import.meta.url))),
      ),
    );
  });

  it('keeps Data Foundation navigation and failure states isomorphic', () => {
    expect(dictionaries['zh-CN'].dataFoundation.navigation).toEqual({
      label: '数据基座工作区',
      overview: '总览',
      catalog: '目录',
      ingestions: '入库',
      quality: '质量',
      search: '检索',
      knowledge: '知识',
      graph: '图谱',
      geo: '空间查询',
      map: '地图',
      capabilities: '能力',
    });
    expect(dictionaries.en.dataFoundation.navigation).toEqual({
      label: 'Data Foundation workspace',
      overview: 'Overview',
      catalog: 'Catalog',
      ingestions: 'Ingestions',
      quality: 'Quality',
      search: 'Search',
      knowledge: 'Knowledge',
      graph: 'Graph',
      geo: 'Geo query',
      map: 'Map',
      capabilities: 'Capabilities',
    });
    expect(Object.keys(dictionaries.en.dataFoundation.failures).sort()).toEqual(
      Object.keys(dictionaries['zh-CN'].dataFoundation.failures).sort(),
    );
  });

  it('keeps the map route wired to the real MapLibre leaf', async () => {
    const source = await readFile(
      new URL(
        '[locale]/data-foundation/map/page.tsx',
        new URL('./', import.meta.url),
      ),
      'utf8',
    );
    expect(source).toContain('DataFoundationMap');
    expect(source).toContain('getDataFoundationDal');
    expect(source).toContain('stacItems');
    expect(source).toContain('vectorTileUrl');
    expect(source).toContain('rasterTileUrl');
    expect(source).not.toContain('baseLayerGap');
    expect(source).not.toMatch(/fixture|mock|sample/i);
  });

  it('round-trips immutable DataItem version selection through the API', async () => {
    const source = await readFile(
      new URL(
        '[locale]/data-foundation/catalog/[dataItemId]/page.tsx',
        new URL('./', import.meta.url),
      ),
      'utf8',
    );
    expect(source).toContain('searchParams');
    expect(source).toContain('search.version');
    expect(source).toContain('dal.dataItem(dataItemId, versionId)');
    expect(source).toContain('detail.selectedVersion');
    expect(source).toContain('selectedVersionId');
    await access(
      new URL(
        'api/data-foundation/geo/[...path]/route.ts',
        new URL('./', import.meta.url),
      ),
    );
  });

  it('renders ingestion runtime summaries instead of API coverage placeholders', async () => {
    const source = await readFile(
      new URL(
        '[locale]/data-foundation/ingestions/[ingestionId]/page.tsx',
        new URL('./', import.meta.url),
      ),
      'utf8',
    );
    expect(source).toContain('IngestionRuntimeSummaries');
    expect(source).not.toContain('CoverageGap');
    expect(dictionaries['zh-CN'].dataFoundation.ingestionPage.emptyIssues).toBe(
      '本次入库没有返回质量问题。',
    );
    expect(dictionaries.en.dataFoundation.ingestionPage.emptyIssues).toBe(
      'No quality issues were returned for this ingestion.',
    );
  });
});
