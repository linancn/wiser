import type { PlatformRequestContext } from '@wiser/platform-contracts';

export type DataFoundationResourceErrorCode =
  'INVALID_RESPONSE' | 'NOT_FOUND' | 'RESPONSE_TOO_LARGE' | 'UNAVAILABLE';

export class DataFoundationResourceError extends Error {
  constructor(
    readonly code: DataFoundationResourceErrorCode,
    cause?: unknown,
  ) {
    super(
      'Data Foundation resource request failed safely.',
      cause === undefined ? undefined : { cause },
    );
    this.name = 'DataFoundationResourceError';
  }
}

export interface DataFoundationResourcePort {
  readEvidence(input: {
    readonly context: PlatformRequestContext;
    readonly evidenceId: string;
  }): Promise<unknown>;
  readStacItem(input: {
    readonly context: PlatformRequestContext;
    readonly collectionId: string;
    readonly itemId: string;
  }): Promise<unknown>;
}
