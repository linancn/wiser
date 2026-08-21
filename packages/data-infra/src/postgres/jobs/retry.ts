export function calculateExponentialBackoffMs(
  attemptCount: number,
  baseDelayMs: number,
  maximumDelayMs: number,
): number {
  if (!Number.isInteger(attemptCount) || attemptCount < 1) {
    throw new RangeError('attemptCount must be a positive integer.');
  }
  if (
    !Number.isSafeInteger(baseDelayMs) ||
    baseDelayMs < 1 ||
    !Number.isSafeInteger(maximumDelayMs) ||
    maximumDelayMs < baseDelayMs
  ) {
    throw new RangeError(
      'baseDelayMs and maximumDelayMs must be positive safe integers with maximumDelayMs >= baseDelayMs.',
    );
  }
  const exponent = Math.min(attemptCount - 1, 52);
  return Math.min(maximumDelayMs, baseDelayMs * 2 ** exponent);
}
