import {
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
  return new ProjectionOutboxConsumer({
    repository: new PublishingProjectionRepository(
      options.repository,
      options.publication,
    ),
    targets: options.targets,
    consumerName: options.consumerName,
  });
}
