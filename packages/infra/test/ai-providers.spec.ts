import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  type AiProviderError,
  FakeAiProvider,
  OpenAiCompatibleProvider,
  TrustedLocalCodexProvider,
  selectAiProviderKind,
} from '../src/ai/index.js';

const outputSchema = z
  .object({
    summary: z.string(),
    nextAction: z.string(),
  })
  .strict();

const request = {
  purpose: 'feedback_summary' as const,
  instruction: 'Summarize the deterministic result without changing it.',
  input: { verdict: 'partial', score: 78 },
  schema: outputSchema,
};

describe('AI provider boundary', () => {
  it('uses a deterministic fake in tests and validates its fixture', async () => {
    const provider = new FakeAiProvider({
      summary: 'Constraint checks are deterministic.',
      nextAction: 'Review source limits.',
    });

    await expect(provider.generateJson(request)).resolves.toMatchObject({
      provider: 'fake',
      model: 'deterministic-fixture',
      output: {
        summary: 'Constraint checks are deterministic.',
        nextAction: 'Review source limits.',
      },
    });
  });

  it('requires an explicit trusted-host opt-in for Codex subscription auth', () => {
    expect(
      () => new TrustedLocalCodexProvider({ trustedLocal: false }),
    ).toThrowError(
      expect.objectContaining<Partial<AiProviderError>>({
        code: 'TRUSTED_LOCAL_CODEX_DISABLED',
      }),
    );
  });

  it('runs local Codex through an injectable structured-output executor', async () => {
    const execute = vi.fn().mockResolvedValue(
      JSON.stringify({
        summary: 'The plan respects the synthetic boundary.',
        nextAction: 'Advance to stage two.',
      }),
    );
    const provider = new TrustedLocalCodexProvider({
      trustedLocal: true,
      model: 'account-default',
      execute,
    });

    await expect(provider.generateJson(request)).resolves.toMatchObject({
      provider: 'trusted-local-codex',
      model: 'account-default',
      output: { nextAction: 'Advance to stage two.' },
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('supports an OpenAI-compatible endpoint without network calls in CI', async () => {
    const execute = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        summary: 'One source exceeds its synthetic limit.',
        nextAction: 'Reduce the Guanting release.',
      }),
      model: 'compatible-model-v1',
      inputTokens: 120,
      outputTokens: 24,
    });
    const provider = new OpenAiCompatibleProvider({
      baseURL: 'https://example.invalid/v1',
      apiKey: 'test-only',
      model: 'configured-model',
      execute,
    });

    await expect(provider.generateJson(request)).resolves.toMatchObject({
      provider: 'openai-compatible',
      model: 'compatible-model-v1',
      usage: { inputTokens: 120, outputTokens: 24 },
      output: { nextAction: 'Reduce the Guanting release.' },
    });
  });

  it('defaults development to Codex and tests or CI to fake', () => {
    expect(selectAiProviderKind({ NODE_ENV: 'development' })).toBe(
      'trusted-local-codex',
    );
    expect(selectAiProviderKind({ NODE_ENV: 'test' })).toBe('fake');
    expect(selectAiProviderKind({ CI: 'true' })).toBe('fake');
  });
});
