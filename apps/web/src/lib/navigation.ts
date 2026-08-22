import { DATA_FOUNDATION_ROUTES } from './data-foundation';

export type WiserSystemId = 'data-foundation' | 'agent-excon';

export const PRIMARY_SYSTEMS = Object.freeze([
  {
    id: 'data-foundation' as const,
    path: '/data-foundation',
    labelKey: 'dataFoundation' as const,
  },
  {
    id: 'agent-excon' as const,
    path: '/scenarios',
    labelKey: 'agentExcon' as const,
  },
]);

const AGENT_EXCON_ROUTES = Object.freeze([
  { key: 'scenarios' as const, path: '/scenarios', group: 'exercise' as const },
  { key: 'runs' as const, path: '/runs', group: 'exercise' as const },
]);

const DATA_ROUTE_GROUPS = {
  overview: 'overview',
  catalog: 'manage',
  ingestions: 'manage',
  quality: 'manage',
  search: 'explore',
  knowledge: 'explore',
  graph: 'explore',
  geo: 'explore',
  map: 'explore',
  capabilities: 'services',
} as const;

const DATA_CONTEXT_ROUTES = Object.freeze(
  DATA_FOUNDATION_ROUTES.map((route) => ({
    ...route,
    group: DATA_ROUTE_GROUPS[route.key],
  })),
);

export type ContextRoute =
  (typeof AGENT_EXCON_ROUTES)[number] | (typeof DATA_CONTEXT_ROUTES)[number];

function localeFreePath(pathname: string): string {
  return pathname.replace(/^\/(?:zh-CN|en)(?=\/|$)/, '') || '/';
}

export function activeSystemForPath(pathname: string): WiserSystemId | null {
  const path = localeFreePath(pathname);
  if (path === '/data-foundation' || path.startsWith('/data-foundation/')) {
    return 'data-foundation';
  }
  if (
    path === '/scenarios' ||
    path.startsWith('/scenarios/') ||
    path === '/runs' ||
    path.startsWith('/runs/')
  ) {
    return 'agent-excon';
  }
  return null;
}

export function contextRoutesForPath(
  pathname: string,
): readonly ContextRoute[] {
  switch (activeSystemForPath(pathname)) {
    case 'data-foundation':
      return DATA_CONTEXT_ROUTES;
    case 'agent-excon':
      return AGENT_EXCON_ROUTES;
    default:
      return [];
  }
}

export function isPrimarySystemActive(
  pathname: string,
  systemId: WiserSystemId,
): boolean {
  return activeSystemForPath(pathname) === systemId;
}

export function isContextRouteActive(
  pathname: string,
  route: ContextRoute,
): boolean {
  const path = localeFreePath(pathname);
  if (route.key === 'overview') return path === '/data-foundation';
  if (route.key === 'catalog') {
    return (
      path.startsWith('/data-foundation/catalog') ||
      path.startsWith('/data-foundation/lineage')
    );
  }
  if (route.key === 'ingestions') {
    return (
      path.startsWith('/data-foundation/ingestions') ||
      path.startsWith('/data-foundation/operations')
    );
  }
  if ('group' in route && route.group !== 'exercise') {
    return path === `/data-foundation${route.path}`;
  }
  return path === route.path || path.startsWith(`${route.path}/`);
}
