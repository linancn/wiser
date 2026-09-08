/** Browser Origin names the public Host, not a reverse proxy's internal listener. */
export function isSameOriginRequest(request: Request): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      parsed.origin === origin &&
      parsed.host === request.headers.get('host')
    );
  } catch {
    return false;
  }
}
