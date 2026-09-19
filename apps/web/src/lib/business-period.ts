/** Calendar navigation changes only query bounds, never the source time precision. */
export type BusinessPeriodUnit = 'month' | 'year';
export function businessPeriod(
  anchor: string | null,
  unit: BusinessPeriodUnit,
  offset: -1 | 0 | 1,
): { from: string; to: string } | null {
  if (!anchor || !/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return null;
  const [year, month, day] = anchor.split('-').map(Number);
  const lastDay = (y: number, m: number) =>
    m === 2
      ? y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
        ? 29
        : 28
      : [4, 6, 9, 11].includes(m)
        ? 30
        : 31;
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > lastDay(year, month)
  )
    return null;
  const index =
    year * 12 + month - 1 + (unit === 'year' ? offset * 12 : offset);
  const targetYear = Math.floor(index / 12),
    targetMonth = (index % 12) + 1;
  if (targetYear < 1 || targetYear > 9999) return null;
  const y = String(targetYear).padStart(4, '0');
  const m = String(targetMonth).padStart(2, '0');
  return unit === 'year'
    ? { from: `${y}-01-01`, to: `${y}-12-31` }
    : {
        from: `${y}-${m}-01`,
        to: `${y}-${m}-${lastDay(targetYear, targetMonth)}`,
      };
}

/** Presentation preference only; this never changes the source or query time precision. */
export function readBusinessPeriodUnit(
  search: Pick<URLSearchParams, 'getAll'>,
): BusinessPeriodUnit {
  const values = search.getAll('businessPeriodUnit');
  return values.length === 1 && values[0] === 'year' ? 'year' : 'month';
}
export function writeBusinessPeriodUnit(
  params: URLSearchParams,
  unit: BusinessPeriodUnit,
) {
  params.delete('businessPeriodUnit');
  if (unit === 'year') params.set('businessPeriodUnit', unit);
}
