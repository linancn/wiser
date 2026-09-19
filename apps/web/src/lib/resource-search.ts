/** Mirrors the current resource query's name OR registered-source-organization scope.
 * A displayed provider alias is not necessarily the registered organization. */
export function resourceSearchMatch(
  name: string,
  query: string | undefined,
): 'name' | 'registration' | 'pattern' | null {
  if (!query?.trim()) return null;
  if (/[%_\\]/.test(query)) return 'pattern';
  return name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    ? 'name'
    : 'registration';
}
export function resourceSearchExamples(
  rows: readonly { name: string }[],
): string[] {
  return [
    ...new Set(
      rows
        .map((row) => row.name)
        .filter(
          (name) =>
            name.trim().length > 0 &&
            name.length <= 512 &&
            !/[%_\\]/.test(name),
        ),
    ),
  ].slice(0, 3);
}
