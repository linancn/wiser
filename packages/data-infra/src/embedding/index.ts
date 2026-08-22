import { createHash } from 'node:crypto';

export interface EmbeddingModelIdentity {
  readonly provider: 'fake';
  readonly model: 'sha256-expansion';
  readonly version: string;
  readonly dimensions: number;
}

export interface EmbeddingPort {
  readonly model: EmbeddingModelIdentity;
  embed(text: string): Promise<readonly number[]>;
}

export interface DeterministicFakeEmbeddingOptions {
  readonly dimensions: number;
  readonly version: string;
}

function validText(value: string): boolean {
  if (value.length < 1 || value.length > 1_048_576) return false;
  return ![...value].some((character) => {
    const code = character.charCodeAt(0);
    return (
      code === 0 || code === 127 || (code < 32 && ![9, 10, 13].includes(code))
    );
  });
}

export class DeterministicFakeEmbedding implements EmbeddingPort {
  readonly model: EmbeddingModelIdentity;

  constructor(options: DeterministicFakeEmbeddingOptions) {
    if (
      !Number.isSafeInteger(options.dimensions) ||
      options.dimensions < 8 ||
      options.dimensions > 4_096
    ) {
      throw new Error('Fake embedding dimensions must be from 8 to 4096.');
    }
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(options.version)) {
      throw new Error('Fake embedding version is invalid.');
    }
    this.model = Object.freeze({
      provider: 'fake',
      model: 'sha256-expansion',
      version: options.version,
      dimensions: options.dimensions,
    });
  }

  embed(text: string): Promise<readonly number[]> {
    if (!validText(text)) {
      return Promise.reject(new Error('Fake embedding text is invalid.'));
    }
    const values: number[] = [];
    let block = 0;
    while (values.length < this.model.dimensions) {
      const digest = createHash('sha256')
        .update('wiser:data-foundation:fake-embedding\0', 'utf8')
        .update(this.model.version, 'utf8')
        .update('\0', 'utf8')
        .update(text, 'utf8')
        .update('\0', 'utf8')
        .update(String(block), 'utf8')
        .digest();
      for (const byte of digest) {
        values.push((byte - 127.5) / 127.5);
        if (values.length === this.model.dimensions) break;
      }
      block += 1;
    }
    const norm = Math.sqrt(
      values.reduce((sum, value) => sum + value * value, 0),
    );
    return Promise.resolve(
      Object.freeze(values.map((value) => (norm === 0 ? 0 : value / norm))),
    );
  }
}
