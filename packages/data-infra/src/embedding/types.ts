export interface EmbeddingModelIdentity {
  readonly provider: 'fake' | 'openai-compatible';
  readonly model: string;
  readonly version: string;
  readonly dimensions: number;
  readonly queryInstruction?: string;
}

export interface EmbeddingRequestOptions {
  readonly purpose: 'query' | 'document';
}

export interface EmbeddingPort {
  readonly model: EmbeddingModelIdentity;
  embed(
    text: string,
    options?: EmbeddingRequestOptions,
  ): Promise<readonly number[]>;
  embedMany?(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}
