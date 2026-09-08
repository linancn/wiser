/** Responses that invalidate the permission or immutable membership of a result set. */
export function invalidatesExploration(status: number): boolean {
  return [401, 403, 404, 409, 410, 422].includes(status);
}
export type InvalidateExploration = (queryId: string, status?: number) => void;
