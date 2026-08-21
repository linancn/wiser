import type {
  SearchBackendHit,
  SearchBackendPort,
  SearchBackendRequest,
} from '../index.js';
import { deterministicStacCollectionId } from '../../projections/graph-stac/stac.js';
import {
  adapterError,
  fetchJson,
  isRecord,
  parseSearchBackendHit,
  requiredFetch,
  requiredSecret,
  safeEndpoint,
  type SearchBackendFetch,
  validateBackendRequest,
} from './common.js';

const PROJECTION_FIELDS = Object.freeze([
  'tenantId',
  'projectId',
  'dataItemId',
  'versionId',
  'evidenceId',
  'qualityGrade',
  'acceptanceStatus',
  'publicationStatus',
  'securityLevel',
  'policyVersion',
  'limitations',
]);

export interface PgSTACSearchBackendOptions {
  readonly endpoint: string;
  readonly bearerToken: string;
  readonly fetch?: SearchBackendFetch;
  readonly timeoutMs?: number;
}

function property(name: string) {
  return { property: name };
}

function cqlFilter(request: SearchBackendRequest) {
  const args: unknown[] = [
    { op: '=', args: [property('tenantId'), request.tenantId] },
    { op: '=', args: [property('projectId'), request.projectId] },
    { op: 'in', args: [property('securityLevel'), request.securityLevels] },
    {
      op: '<=',
      args: [property('policyVersion'), request.maximumPolicyVersion],
    },
    {
      op: 'in',
      args: [property('acceptanceStatus'), request.acceptanceStatuses],
    },
    {
      op: 'in',
      args: [property('publicationStatus'), request.publicationStatuses],
    },
    {
      op: 'or',
      args: request.channels.map((channel) => ({
        op: 'like',
        args: [property('channelsText'), `%|${channel}|%`],
      })),
    },
    {
      op: 'or',
      args: [
        {
          op: 'like',
          args: [property('title'), `%${request.query}%`],
        },
        {
          op: 'like',
          args: [property('description'), `%${request.query}%`],
        },
      ],
    },
  ];
  if (request.versionIds.length > 0) {
    args.push({ op: 'in', args: [property('versionId'), request.versionIds] });
  }
  if (request.businessDomains.length > 0) {
    args.push({
      op: 'or',
      args: request.businessDomains.map((domain) => ({
        op: 'like',
        args: [property('businessDomainsText'), `%|${domain}|%`],
      })),
    });
  }
  return { op: 'and', args };
}

export class PgSTACSearchBackend implements SearchBackendPort {
  readonly source = 'pgstac' as const;
  readonly #url: URL;
  readonly #token: string;
  readonly #fetch: SearchBackendFetch;
  readonly #timeoutMs: number;

  constructor(options: PgSTACSearchBackendOptions) {
    const endpoint = safeEndpoint(options.endpoint);
    this.#url = new URL('search', endpoint);
    this.#token = requiredSecret(options.bearerToken);
    this.#fetch = requiredFetch(options.fetch ?? globalThis.fetch);
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    if (
      !Number.isSafeInteger(this.#timeoutMs) ||
      this.#timeoutMs < 100 ||
      this.#timeoutMs > 120_000
    ) {
      throw adapterError('INVALID_CONFIGURATION');
    }
  }

  readonly search = async (
    rawRequest: SearchBackendRequest,
  ): Promise<readonly SearchBackendHit[]> => {
    const request = validateBackendRequest(rawRequest, new Set(['stac']));
    const response = await fetchJson(
      this.#fetch,
      this.#url,
      {
        method: 'POST',
        headers: {
          accept: 'application/geo+json, application/json',
          authorization: `Bearer ${this.#token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          collections: [deterministicStacCollectionId(request)],
          limit: request.limit,
          'filter-lang': 'cql2-json',
          filter: cqlFilter(request),
          sortby: [
            { field: 'properties.dataItemId', direction: 'asc' },
            { field: 'properties.versionId', direction: 'asc' },
            { field: 'id', direction: 'asc' },
          ],
        }),
      },
      this.#timeoutMs,
    );
    if (
      !isRecord(response) ||
      response['type'] !== 'FeatureCollection' ||
      !Array.isArray(response['features']) ||
      response['features'].length > request.limit
    ) {
      throw adapterError('INVALID_RESPONSE');
    }
    return (response['features'] as readonly unknown[]).map((feature) => {
      if (
        !isRecord(feature) ||
        feature['type'] !== 'Feature' ||
        !isRecord(feature['properties'])
      ) {
        throw adapterError('INVALID_RESPONSE');
      }
      const properties = feature['properties'];
      const projection = Object.fromEntries(
        PROJECTION_FIELDS.map((field) => [field, properties[field]]),
      );
      const excerptFragments = [
        ['title', properties['title']],
        ['description', properties['description']],
      ]
        .filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === 'string' && entry[1].length > 0,
        )
        .map(([field, text]) => ({ field, text }));
      return parseSearchBackendHit(
        { ...projection, excerptFragments },
        request,
      );
    });
  };
}
