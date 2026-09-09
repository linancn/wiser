import { createHash } from 'node:crypto';
import {
  embeddingCollectionName,
  ProjectionOutboxConsumer,
  type EmbeddingModelIdentity,
  type ProjectionOutboxRepository,
  type ProjectionTarget,
} from '@wiser/data-infra';
import {
  PublishingProjectionRepository,
  type ProjectionPublicationGate,
} from '../runtime.js';

export function createProfiledProjectionConsumer(options: {
  readonly repository: ProjectionOutboxRepository;
  readonly publication: ProjectionPublicationGate;
  readonly targets: readonly ProjectionTarget[];
  readonly consumerName: string;
  readonly embeddingModel: EmbeddingModelIdentity;
}): ProjectionOutboxConsumer {
  // Preserve the legacy fake checkpoint so rollback can catch events published
  // while a real profile was active. Real profiles must never advance it.
  const consumerName =
    options.embeddingModel.provider === 'fake'
      ? options.consumerName
      : `projection-embedding-v1-${createHash('sha256')
          .update(
            JSON.stringify([
              options.consumerName,
              embeddingCollectionName(options.embeddingModel),
            ]),
          )
          .digest('hex')
          .slice(0, 32)}`;
  return new ProjectionOutboxConsumer({
    repository: new PublishingProjectionRepository(
      options.repository,
      options.publication,
      ['WEAVIATE'],
    ),
    targets: options.targets,
    consumerName,
  });
}
