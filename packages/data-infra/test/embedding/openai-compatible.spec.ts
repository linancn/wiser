import { describe, expect, it, vi } from 'vitest';
import {
  OpenAiCompatibleEmbedding,
  embeddingCollectionName,
  loadDataEmbeddingConfig,
} from '../../src/embedding/index.js';

const options = {
  baseUrl: 'http://embedding.local:7710/v1',
  model: 'Qwen/Qwen3-Embedding-8B',
  version: '1.0.0-qwen3',
  dimensions: 4096,
  queryInstruction:
    'Given a web search query, retrieve relevant passages that answer the query',
};
const vector = [3, 4, ...Array<number>(4094).fill(0)];
const response = (data: unknown, model = options.model) =>
  new Response(JSON.stringify({ model, data }), { status: 200 });

describe('OpenAI-compatible embeddings', () => {
  it('uses the served model and query instruction while leaving source documents unchanged', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        response([{ index: 0, embedding: vector }]),
      );
    const provider = new OpenAiCompatibleEmbedding({
      ...options,
      fetch: fetcher,
    });
    const result = await provider.embed('北京水库', { purpose: 'query' });
    expect(result.slice(0, 2)).toEqual([0.6, 0.8]);
    expect(fetcher.mock.calls[0]?.[0].toString()).toBe(
      'http://embedding.local:7710/v1/embeddings',
    );
    expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toEqual({
      model: options.model,
      input: [`Instruct: ${options.queryInstruction}\nQuery: 北京水库`],
      encoding_format: 'float',
    });
    await provider.embed('原始观测记录');
    expect(
      JSON.parse(fetcher.mock.calls[1]?.[1]?.body as string).input,
    ).toEqual(['原始观测记录']);
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe('error');
  });

  it('reorders a batch by response index', async () => {
    const provider = new OpenAiCompatibleEmbedding({
      ...options,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        response([
          { index: 1, embedding: vector.map((value) => -value) },
          { index: 0, embedding: vector },
        ]),
      ),
    });
    const result = await provider.embedMany(['first', 'second']);
    expect(result.map((entry) => entry[0])).toEqual([0.6, -0.6]);
  });

  it.each([
    [],
    [{ index: 1, embedding: vector }],
    [{ index: 0, embedding: [1, 2] }],
    [{ index: 0, embedding: Array<number>(4096).fill(0) }],
    [{ index: 0, embedding: [null, ...vector.slice(1)] }],
    [
      { index: 0, embedding: vector },
      { index: 0, embedding: vector },
    ],
  ])(
    'rejects invalid embedding envelopes without returning fake vectors: %#',
    async (data) => {
      const provider = new OpenAiCompatibleEmbedding({
        ...options,
        fetch: vi.fn<typeof fetch>().mockResolvedValue(response(data)),
      });
      await expect(provider.embed('query')).rejects.toThrow(
        'Embedding response is invalid',
      );
    },
  );

  it('rejects a different served model', async () => {
    const provider = new OpenAiCompatibleEmbedding({
      ...options,
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          response([{ index: 0, embedding: vector }], 'another-model'),
        ),
    });
    await expect(provider.embed('query')).rejects.toThrow(
      'Embedding response is invalid',
    );
  });

  it('keeps upstream bodies and credentials out of errors', async () => {
    const provider = new OpenAiCompatibleEmbedding({
      ...options,
      apiKey: 'private-key',
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response('private upstream prompt', { status: 503 }),
        ),
    });
    await expect(provider.embed('private query')).rejects.toThrow(
      /^Embedding service is unavailable\.$/,
    );
  });

  it('bounds requests and rejects credential-bearing URLs before any network call', async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(
      () =>
        new OpenAiCompatibleEmbedding({
          ...options,
          baseUrl: 'http://user:secret@embedding.local/v1',
          fetch: fetcher,
        }),
    ).toThrow();
    const provider = new OpenAiCompatibleEmbedding({
      ...options,
      fetch: fetcher,
    });
    await expect(provider.embed('x'.repeat(32769))).rejects.toThrow();
    await expect(
      provider.embedMany(Array<string>(17).fill('query')),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('embedding profile configuration', () => {
  it('keeps CI fake by default and selects Qwen only explicitly', () => {
    expect(loadDataEmbeddingConfig({}).provider).toBe('fake');
    const config = loadDataEmbeddingConfig({
      DATA_EMBEDDING_PROVIDER: 'openai-compatible',
      DATA_EMBEDDING_BASE_URL: options.baseUrl,
      DATA_EMBEDDING_MODEL: options.model,
      DATA_EMBEDDING_VERSION: options.version,
      DATA_EMBEDDING_DIMENSIONS: '4096',
    });
    expect(config).toMatchObject({ provider: 'openai-compatible', ...options });
  });

  it('isolates dimensions, revisions and query instructions in separate collection names', () => {
    const identity = { provider: 'openai-compatible' as const, ...options };
    const name = embeddingCollectionName(identity);
    expect(name).toMatch(/^WiserEvidenceChunkV3_[a-f0-9]{20}$/);
    expect(embeddingCollectionName(identity)).toBe(name);
    for (const change of [
      { dimensions: 1024 },
      { version: '2.0.0' },
      { queryInstruction: 'Different instruction' },
    ])
      expect(embeddingCollectionName({ ...identity, ...change })).not.toBe(
        name,
      );
  });
});
