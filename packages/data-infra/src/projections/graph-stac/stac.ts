import { GraphStacProjectionError } from './errors.js';
import type {
  GraphStacHttpClient,
  GraphStacHttpRequest,
  StacProjectionInput,
} from './types.js';
import {
  deterministicId,
  rootHttpUrl,
  validateStacInput,
} from './validation.js';

interface StacProjectionOptions {
  readonly baseUrl: string;
  readonly bearerToken: string;
  readonly assetBaseUrl: string;
  readonly http: GraphStacHttpClient;
}

export function deterministicStacItemId(input: StacProjectionInput): string {
  return `wiser-${deterministicId('wiser:stac:item:v1', [
    input.tenantId,
    input.projectId,
    input.dataItemId,
    input.versionId,
    input.sourceHash,
  ]).slice(0, 48)}`;
}

function collectionId(input: StacProjectionInput): string {
  return `wiser-${deterministicId('wiser:stac:collection:v1', [
    input.tenantId,
    input.projectId,
  ]).slice(0, 32)}`;
}

export class StacCatalogProjection {
  readonly #baseUrl: string;
  readonly #assetBaseUrl: string;
  readonly #authorization: string;
  readonly #http: GraphStacHttpClient;

  constructor(options: StacProjectionOptions) {
    this.#baseUrl = rootHttpUrl(options.baseUrl, 'INVALID_STAC_CONFIGURATION');
    this.#assetBaseUrl = rootHttpUrl(
      options.assetBaseUrl,
      'INVALID_STAC_CONFIGURATION',
    );
    const bearerHasControlCharacter = options.bearerToken
      .split('')
      .some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127;
      });
    if (
      options.bearerToken.length < 16 ||
      options.bearerToken.length > 2_048 ||
      bearerHasControlCharacter ||
      options.http === null ||
      typeof options.http?.request !== 'function'
    ) {
      throw new GraphStacProjectionError('INVALID_STAC_CONFIGURATION');
    }
    this.#authorization = `Bearer ${options.bearerToken}`;
    this.#http = options.http;
  }

  async #put(request: GraphStacHttpRequest): Promise<void> {
    let response;
    try {
      response = await this.#http.request(request);
    } catch {
      throw new GraphStacProjectionError('PROJECTION_UNAVAILABLE');
    }
    if (response.status < 200 || response.status >= 300) {
      throw new GraphStacProjectionError('PROJECTION_UNAVAILABLE');
    }
  }

  async put(
    input: StacProjectionInput,
  ): Promise<{ readonly collectionId: string; readonly itemId: string }> {
    const valid = validateStacInput(input);
    const scopedCollectionId = collectionId(valid);
    const itemId = deterministicStacItemId(valid);
    const headers = {
      Authorization: this.#authorization,
      'Content-Type': 'application/json',
    } as const;
    const collection = {
      stac_version: '1.1.0',
      stac_extensions: [],
      type: 'Collection',
      id: scopedCollectionId,
      title: 'WISER governed data assets',
      description: 'Immutable, governed Data Foundation versions.',
      license: 'proprietary',
      extent: {
        spatial: { bbox: [valid.bbox] },
        temporal: { interval: [[valid.validFrom, valid.validTo]] },
      },
      links: [],
      'wiser:tenant_id': valid.tenantId,
      'wiser:project_id': valid.projectId,
      'wiser:security_level': valid.securityLevel,
      'wiser:policy_version': valid.policyVersion,
      'wiser:source_hash': valid.sourceHash,
    };
    const assetHref = `${this.#assetBaseUrl}/api/data/v1/tenants/${valid.tenantId}/projects/${valid.projectId}/versions/${valid.versionId}/assets/source`;
    const item = {
      stac_version: '1.1.0',
      stac_extensions: [
        'https://stac-extensions.github.io/file/v2.1.0/schema.json',
      ],
      type: 'Feature',
      id: itemId,
      collection: scopedCollectionId,
      bbox: valid.bbox,
      geometry: valid.geometry,
      properties: {
        datetime: valid.validFrom,
        'wiser:tenant_id': valid.tenantId,
        'wiser:project_id': valid.projectId,
        'wiser:data_item_id': valid.dataItemId,
        'wiser:version_id': valid.versionId,
        'wiser:evidence_id': valid.evidenceId,
        'wiser:security_level': valid.securityLevel,
        'wiser:policy_version': valid.policyVersion,
        'wiser:source_hash': valid.sourceHash,
        'wiser:quality_grade': valid.qualityGrade,
        'wiser:confidence': valid.confidence,
        'wiser:review_status': valid.reviewStatus,
        'wiser:valid_from': valid.validFrom,
        'wiser:valid_to': valid.validTo,
        'wiser:system_from': valid.systemFrom,
        'wiser:system_to': valid.systemTo,
      },
      links: [],
      assets: {
        source: {
          href: assetHref,
          type: valid.assetMediaType,
          roles: ['data'],
          'file:checksum': `sha256:${valid.sourceHash}`,
          'file:size': valid.assetSizeBytes,
        },
      },
    };

    await this.#put({
      method: 'PUT',
      url: `${this.#baseUrl}/collections/${scopedCollectionId}`,
      headers,
      body: collection,
    });
    await this.#put({
      method: 'PUT',
      url: `${this.#baseUrl}/collections/${scopedCollectionId}/items/${itemId}`,
      headers,
      body: item,
    });
    return { collectionId: scopedCollectionId, itemId };
  }
}
