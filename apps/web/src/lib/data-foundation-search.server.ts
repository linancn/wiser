import 'server-only';
import type { DataFoundationDal } from './data-foundation-dal.server';
import type { SearchPageDto } from './data-foundation';
import type { DisplaySearchResult } from './data-foundation-presentation';

// Names are read under the current session and exact version. Never reuse them
// across requests or infer them from a redacted search excerpt.
export async function nameSearchResults(
  page: SearchPageDto,
  dal: Pick<DataFoundationDal, 'dataItem'>,
): Promise<readonly DisplaySearchResult[]> {
  const unique = [
    ...new Map(
      page.items
        .slice(0, 50)
        .map((item) => [`${item.dataItemId}:${item.versionId}`, item]),
    ).values(),
  ];
  const names = new Map<string, string>();
  let next = 0;
  let stopped = false;
  await Promise.all(
    Array.from({ length: Math.min(6, unique.length) }, async () => {
      while (!stopped && next < unique.length) {
        const item = unique[next++];
        try {
          const detail = await dal.dataItem(item.dataItemId, item.versionId);
          if (
            detail.item.dataItemId === item.dataItemId &&
            detail.selectedVersion?.versionId === item.versionId
          ) {
            names.set(`${item.dataItemId}:${item.versionId}`, detail.item.name);
          }
        } catch {
          // Search remains useful without catalog permission or availability.
          // Stop optional enrichment so a failed upstream cannot multiply latency.
          stopped = true;
        }
      }
    }),
  );
  return page.items.map((item) => {
    const resourceName = names.get(`${item.dataItemId}:${item.versionId}`);
    return resourceName === undefined ? item : { ...item, resourceName };
  });
}
