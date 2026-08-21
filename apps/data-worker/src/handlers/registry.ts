import type { ClaimedDataJob, DataJobSettlement } from '@wiser/data-infra';

export type DataJobHandlerResult = DataJobSettlement;

export type DataJobHandler = (
  job: ClaimedDataJob,
) => Promise<DataJobHandlerResult>;

export class DataJobHandlerError extends Error {
  constructor(
    readonly category: string,
    readonly retryable: boolean,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'DataJobHandlerError';
  }
}

export class StaticJobHandlerRegistry {
  readonly #handlers: ReadonlyMap<string, DataJobHandler>;
  readonly jobTypes: readonly string[];

  constructor(
    registrations: readonly {
      readonly jobType: string;
      readonly handler: DataJobHandler;
    }[],
  ) {
    const handlers = new Map<string, DataJobHandler>();
    for (const registration of registrations) {
      if (registration.jobType.length === 0) {
        throw new Error('Data Worker handler job type is required.');
      }
      if (handlers.has(registration.jobType)) {
        throw new Error(
          `Duplicate Data Worker handler for ${registration.jobType}.`,
        );
      }
      handlers.set(registration.jobType, registration.handler);
    }
    this.#handlers = handlers;
    this.jobTypes = Object.freeze([...handlers.keys()].sort());
  }

  resolve(jobType: string): DataJobHandler | undefined {
    return this.#handlers.get(jobType);
  }
}
