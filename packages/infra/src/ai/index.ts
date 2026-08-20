import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import OpenAI from 'openai';
import { z, type ZodType } from 'zod';

import type { AiProviderKind } from '@agent-excon/contracts';

export interface JsonGenerationRequest<Output> {
  readonly purpose: 'feedback_summary' | 'operator_note';
  readonly instruction: string;
  readonly input: unknown;
  readonly schema: ZodType<Output>;
  readonly timeoutMs?: number;
}

export interface JsonGenerationResult<Output> {
  readonly output: Output;
  readonly provider: AiProviderKind;
  readonly model: string;
  readonly usage: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
  };
  readonly latencyMs: number;
  readonly rawResponseHash: string;
}

export interface AiProvider {
  readonly kind: AiProviderKind;
  generateJson<Output>(
    request: JsonGenerationRequest<Output>,
  ): Promise<JsonGenerationResult<Output>>;
}

export class AiProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AiProviderError';
  }
}

function hashRawResponse(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function parseJson<Output>(raw: string, schema: ZodType<Output>): Output {
  try {
    return schema.parse(JSON.parse(raw));
  } catch (error) {
    throw new AiProviderError(
      'AI_OUTPUT_INVALID',
      'The AI provider returned output that does not match the required schema.',
      { cause: error },
    );
  }
}

function buildPrompt<Output>(request: JsonGenerationRequest<Output>): string {
  return [
    'Return one JSON object that matches the supplied output schema.',
    'Do not add Markdown, commentary, or fields that are not in the schema.',
    `Purpose: ${request.purpose}`,
    `Instruction: ${request.instruction}`,
    `Input JSON: ${JSON.stringify(request.input)}`,
  ].join('\n');
}

export class FakeAiProvider implements AiProvider {
  readonly kind = 'fake' as const;

  constructor(private readonly fixture: unknown) {}

  generateJson<Output>(
    request: JsonGenerationRequest<Output>,
  ): Promise<JsonGenerationResult<Output>> {
    const startedAt = performance.now();
    const raw = JSON.stringify(this.fixture);
    return Promise.resolve({
      output: parseJson(raw, request.schema),
      provider: this.kind,
      model: 'deterministic-fixture',
      usage: {},
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      rawResponseHash: hashRawResponse(raw),
    });
  }
}

export interface LocalCodexExecutorInput {
  readonly prompt: string;
  readonly schema: Record<string, unknown>;
  readonly timeoutMs: number;
  readonly model?: string;
}

export type LocalCodexExecutor = (
  input: LocalCodexExecutorInput,
) => Promise<string>;

async function executeLocalCodex(
  input: LocalCodexExecutorInput,
): Promise<string> {
  const workingDirectory = await mkdtemp(join(tmpdir(), 'agent-excon-codex-'));
  const schemaPath = join(workingDirectory, 'output-schema.json');
  const outputPath = join(workingDirectory, 'output.json');
  await writeFile(schemaPath, JSON.stringify(input.schema), 'utf8');

  const args = [
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--color',
    'never',
    '--cd',
    workingDirectory,
    '--output-schema',
    schemaPath,
    '--output-last-message',
    outputPath,
  ];
  if (input.model !== undefined) args.push('--model', input.model);
  args.push('-');

  const environment = { ...process.env };
  delete environment.CODEX_API_KEY;
  delete environment.OPENAI_API_KEY;

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('codex', args, {
        cwd: workingDirectory,
        env: environment,
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      let standardError = '';
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(
          new AiProviderError(
            'AI_TIMEOUT',
            `Local Codex exceeded ${input.timeoutMs} ms.`,
          ),
        );
      }, input.timeoutMs);
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        standardError = `${standardError}${chunk}`.slice(-16_384);
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(
          new AiProviderError(
            'LOCAL_CODEX_UNAVAILABLE',
            'Could not start the Codex CLI. Install it and run codex login.',
            { cause: error },
          ),
        );
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else {
          reject(
            new AiProviderError(
              'LOCAL_CODEX_FAILED',
              `Codex CLI exited with ${String(code)}: ${standardError.trim()}`,
            ),
          );
        }
      });
      child.stdin.end(input.prompt);
    });
    return await readFile(outputPath, 'utf8');
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

export class TrustedLocalCodexProvider implements AiProvider {
  readonly kind = 'trusted-local-codex' as const;

  constructor(
    private readonly options: {
      readonly trustedLocal: boolean;
      readonly model?: string;
      readonly execute?: LocalCodexExecutor;
    },
  ) {
    if (!options.trustedLocal) {
      throw new AiProviderError(
        'TRUSTED_LOCAL_CODEX_DISABLED',
        'Local Codex is host-only. Enable it explicitly in a trusted development environment.',
      );
    }
  }

  async generateJson<Output>(
    request: JsonGenerationRequest<Output>,
  ): Promise<JsonGenerationResult<Output>> {
    const startedAt = performance.now();
    const execute = this.options.execute ?? executeLocalCodex;
    const raw = await execute({
      prompt: buildPrompt(request),
      schema: z.toJSONSchema(request.schema),
      timeoutMs: request.timeoutMs ?? 120_000,
      ...(this.options.model === undefined
        ? {}
        : { model: this.options.model }),
    });
    return {
      output: parseJson(raw, request.schema),
      provider: this.kind,
      model: this.options.model ?? 'codex-account-default',
      usage: {},
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      rawResponseHash: hashRawResponse(raw),
    };
  }
}

export interface OpenAiCompatibleCompletion {
  readonly content: string;
  readonly model: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export type OpenAiCompatibleExecutor = (input: {
  readonly prompt: string;
  readonly schema: Record<string, unknown>;
  readonly timeoutMs: number;
}) => Promise<OpenAiCompatibleCompletion>;

export class OpenAiCompatibleProvider implements AiProvider {
  readonly kind = 'openai-compatible' as const;
  private readonly execute: OpenAiCompatibleExecutor;

  constructor(
    private readonly options: {
      readonly baseURL: string;
      readonly apiKey: string;
      readonly model: string;
      readonly execute?: OpenAiCompatibleExecutor;
    },
  ) {
    if (options.execute !== undefined) {
      this.execute = options.execute;
      return;
    }
    const client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });
    this.execute = async ({ prompt, schema, timeoutMs }) => {
      const response = await client.chat.completions.create(
        {
          model: options.model,
          messages: [{ role: 'user', content: prompt }],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'agent_excon_output',
              strict: true,
              schema,
            },
          },
        },
        { timeout: timeoutMs },
      );
      const content = response.choices[0]?.message.content;
      if (content === undefined || content === null || content.length === 0) {
        throw new AiProviderError(
          'AI_OUTPUT_EMPTY',
          'The OpenAI-compatible endpoint returned no message content.',
        );
      }
      return {
        content,
        model: response.model,
        ...(response.usage?.prompt_tokens === undefined
          ? {}
          : { inputTokens: response.usage.prompt_tokens }),
        ...(response.usage?.completion_tokens === undefined
          ? {}
          : { outputTokens: response.usage.completion_tokens }),
      };
    };
  }

  async generateJson<Output>(
    request: JsonGenerationRequest<Output>,
  ): Promise<JsonGenerationResult<Output>> {
    const startedAt = performance.now();
    const completion = await this.execute({
      prompt: buildPrompt(request),
      schema: z.toJSONSchema(request.schema),
      timeoutMs: request.timeoutMs ?? 60_000,
    });
    return {
      output: parseJson(completion.content, request.schema),
      provider: this.kind,
      model: completion.model,
      usage: {
        ...(completion.inputTokens === undefined
          ? {}
          : { inputTokens: completion.inputTokens }),
        ...(completion.outputTokens === undefined
          ? {}
          : { outputTokens: completion.outputTokens }),
      },
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      rawResponseHash: hashRawResponse(completion.content),
    };
  }
}

export function selectAiProviderKind(
  environment: NodeJS.ProcessEnv,
): AiProviderKind {
  if (environment.AI_PROVIDER !== undefined) {
    return z
      .enum(['fake', 'trusted-local-codex', 'openai-compatible'])
      .parse(environment.AI_PROVIDER);
  }
  return environment.NODE_ENV === 'test' || environment.CI === 'true'
    ? 'fake'
    : 'trusted-local-codex';
}
