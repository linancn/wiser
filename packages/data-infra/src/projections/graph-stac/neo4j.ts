import { Buffer } from 'node:buffer';

import { GraphStacProjectionError } from './errors.js';
import type {
  GraphStacHttpClient,
  KnowledgeGraphProjectionInput,
} from './types.js';
import {
  deterministicId,
  rootHttpUrl,
  validateGraphInput,
} from './validation.js';

const MERGE_GRAPH_STATEMENT = `
MERGE (entity:WiserEntity {projectionId: $projectionId})
SET entity.entityId = $entityId,
    entity.entityType = $entityType,
    entity.name = $entityName,
    entity.dataItemId = $dataItemId,
    entity.versionId = $versionId,
    entity.evidenceId = $evidenceId,
    entity += $governance
MERGE (dataItem:WiserDataItem {projectionId: $dataItemProjectionId})
SET dataItem.dataItemId = $dataItemId,
    dataItem += $governance
MERGE (version:WiserDataVersion {projectionId: $versionProjectionId})
SET version.dataItemId = $dataItemId,
    version.versionId = $versionId,
    version += $governance
MERGE (evidence:WiserEvidence {projectionId: $evidenceProjectionId})
SET evidence.dataItemId = $dataItemId,
    evidence.versionId = $versionId,
    evidence.evidenceId = $evidenceId,
    evidence += $governance
MERGE (dataItem)-[hasVersion:HAS_VERSION {projectionId: $dataItemVersionRelationId}]->(version)
SET hasVersion.dataItemId = $dataItemId,
    hasVersion.versionId = $versionId,
    hasVersion += $governance
MERGE (version)-[hasEvidence:HAS_EVIDENCE {projectionId: $versionEvidenceRelationId}]->(evidence)
SET hasEvidence.dataItemId = $dataItemId,
    hasEvidence.versionId = $versionId,
    hasEvidence.evidenceId = $evidenceId,
    hasEvidence += $governance
MERGE (entity)-[relation:EVIDENCED_BY {projectionId: $projectionId}]->(evidence)
SET relation.entityId = $entityId,
    relation.dataItemId = $dataItemId,
    relation.versionId = $versionId,
    relation.evidenceId = $evidenceId,
    relation += $governance
RETURN $projectionId AS projectionId
`.trim();

interface Neo4jProjectionOptions {
  readonly baseUrl: string;
  readonly database: string;
  readonly username: string;
  readonly password: string;
  readonly http: GraphStacHttpClient;
}

export function deterministicGraphProjectionId(
  input: KnowledgeGraphProjectionInput,
): string {
  return deterministicId('wiser:neo4j:knowledge:v1', [
    input.tenantId,
    input.projectId,
    input.dataItemId,
    input.versionId,
    input.evidenceId,
    input.entityId,
    input.sourceHash,
  ]);
}

function hasErrors(body: unknown): boolean {
  if (body === null || typeof body !== 'object') return false;
  const errors: unknown = (body as { readonly errors?: unknown }).errors;
  return Array.isArray(errors) && errors.length > 0;
}

export class Neo4jKnowledgeGraphProjection {
  readonly #url: string;
  readonly #authorization: string;
  readonly #http: GraphStacHttpClient;

  constructor(options: Neo4jProjectionOptions) {
    const baseUrl = rootHttpUrl(options.baseUrl, 'INVALID_GRAPH_CONFIGURATION');
    if (
      !/^[A-Za-z][A-Za-z0-9._-]{0,62}$/.test(options.database) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(options.username) ||
      options.password.length === 0 ||
      options.password.length > 1_024 ||
      [...options.password].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127;
      }) ||
      options.http === null ||
      typeof options.http?.request !== 'function'
    ) {
      throw new GraphStacProjectionError('INVALID_GRAPH_CONFIGURATION');
    }
    this.#url = `${baseUrl}/db/${encodeURIComponent(options.database)}/query/v2`;
    this.#authorization = `Basic ${Buffer.from(
      `${options.username}:${options.password}`,
    ).toString('base64')}`;
    this.#http = options.http;
  }

  async put(
    input: KnowledgeGraphProjectionInput,
  ): Promise<{ projectionId: string }> {
    const valid = validateGraphInput(input);
    const projectionId = deterministicGraphProjectionId(valid);
    const governance = {
      tenantId: valid.tenantId,
      projectId: valid.projectId,
      sourceHash: valid.sourceHash,
      securityLevel: valid.securityLevel,
      qualityGrade: valid.qualityGrade,
      confidence: valid.confidence,
      reviewStatus: valid.reviewStatus,
      validFrom: valid.validFrom,
      validTo: valid.validTo,
      systemFrom: valid.systemFrom,
      systemTo: valid.systemTo,
      policyVersion: valid.policyVersion,
    };
    let response;
    try {
      response = await this.#http.request({
        method: 'POST',
        url: this.#url,
        headers: {
          Authorization: this.#authorization,
          'Content-Type': 'application/json',
        },
        body: {
          statement: MERGE_GRAPH_STATEMENT,
          parameters: {
            projectionId,
            entityId: valid.entityId,
            entityType: valid.entityType,
            entityName: valid.entityName,
            dataItemId: valid.dataItemId,
            versionId: valid.versionId,
            evidenceId: valid.evidenceId,
            dataItemProjectionId: deterministicId('wiser:neo4j:data-item:v1', [
              valid.tenantId,
              valid.projectId,
              valid.dataItemId,
            ]),
            versionProjectionId: deterministicId('wiser:neo4j:version:v1', [
              valid.tenantId,
              valid.projectId,
              valid.versionId,
              valid.sourceHash,
            ]),
            evidenceProjectionId: deterministicId('wiser:neo4j:evidence:v1', [
              valid.tenantId,
              valid.projectId,
              valid.evidenceId,
              valid.sourceHash,
            ]),
            dataItemVersionRelationId: deterministicId(
              'wiser:neo4j:has-version:v1',
              [
                valid.tenantId,
                valid.projectId,
                valid.dataItemId,
                valid.versionId,
              ],
            ),
            versionEvidenceRelationId: deterministicId(
              'wiser:neo4j:has-evidence:v1',
              [
                valid.tenantId,
                valid.projectId,
                valid.versionId,
                valid.evidenceId,
                valid.sourceHash,
              ],
            ),
            ...governance,
            governance,
          },
        },
      });
    } catch {
      throw new GraphStacProjectionError('PROJECTION_UNAVAILABLE');
    }
    if (
      response.status < 200 ||
      response.status >= 300 ||
      hasErrors(response.body)
    ) {
      throw new GraphStacProjectionError('PROJECTION_UNAVAILABLE');
    }
    return { projectionId };
  }
}
