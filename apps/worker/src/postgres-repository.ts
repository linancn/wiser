import { createHash } from 'node:crypto';

import type { EvaluationResult } from '@agent-excon/core';
import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResultRow,
} from 'pg';

import { resolveEvaluationInput } from './evaluation-input.js';
import type {
  ClaimedEvaluationJob,
  EvaluationRepository,
  EvaluationWorkItem,
  FailureDisposition,
} from './types.js';
import { WorkerError } from './types.js';

interface ClaimRow extends QueryResultRow {
  readonly id: string;
  readonly episode_id: string;
  readonly submission_id: string;
  readonly attempts: number;
  readonly max_attempts: number;
  readonly lease_expires_at: Date;
  readonly payload: unknown;
}

interface LoadRow extends QueryResultRow {
  readonly actor_user_id: string;
  readonly revision_no: number;
  readonly submitted_virtual_at: Date;
  readonly is_final: boolean;
  readonly submission_payload: unknown;
  readonly constraints_version: string | null;
  readonly allocation_items: unknown;
  readonly evidence_timestamps: unknown;
  readonly episode_virtual_time: Date;
}

interface EpisodeRow extends QueryResultRow {
  readonly state: string;
  readonly virtual_time: Date;
  readonly last_event_seq: string;
  readonly last_event_hash: Buffer | null;
}

interface IdRow extends QueryResultRow {
  readonly id: string;
}

interface StatusRow extends QueryResultRow {
  readonly status: 'pending' | 'dead';
}

interface CountRow extends QueryResultRow {
  readonly count: string;
}

const CLAIM_SQL = `
  select *
  from excon_private.claim_evaluation_jobs(
    $1,
    $2,
    make_interval(secs => $3::double precision)
  )
`;

const LOAD_SQL = `
  select
    s.actor_user_id::text,
    s.revision_no,
    s.submitted_virtual_at,
    s.is_final,
    s.payload as submission_payload,
    p.constraints_version,
    e.virtual_time as episode_virtual_time,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'sourceCode', ai.source_code,
          'maxFlowM3s', ai.max_flow_m3_s::double precision
        ) order by ai.priority, ai.id
      ) filter (where ai.id is not null),
      '[]'::jsonb
    ) as allocation_items,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'informationId', ii.id::text,
            'accessedVirtualTime', o.accessed_virtual_at
          ) order by o.accessed_virtual_at, o.id
        )
        from public.observations as o
        join excon_private.injects as i on i.id = o.inject_id
        join excon_private.information_items as ii
          on ii.id = i.information_item_id
        where o.episode_id = s.episode_id
          and o.recipient_user_id = s.actor_user_id
      ),
      '[]'::jsonb
    ) as evidence_timestamps
  from public.submissions as s
  join public.episodes as e on e.id = s.episode_id
  left join public.allocation_plans as p on p.submission_id = s.id
  left join public.allocation_items as ai on ai.allocation_plan_id = p.id
  where s.id = $1
    and s.episode_id = $2
  group by s.id, p.id, e.id
`;

const RECOVER_EXPIRED_SQL = `
  with recovered as (
    update excon_private.evaluation_jobs
    set status = case when attempts >= max_attempts then 'dead' else 'pending' end,
        run_after = case
          when attempts >= max_attempts then run_after
          else now() + least(power(2::numeric, greatest(attempts - 1, 0)), 60) * interval '1 second'
        end,
        locked_by = null,
        locked_at = null,
        lease_expires_at = null,
        last_error_code = 'LEASE_EXPIRED',
        updated_at = now()
    where status = 'processing'
      and lease_expires_at <= now()
    returning 1
  )
  select count(*)::text as count from recovered
`;

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkerError('INVALID_EVALUATION_INPUT', `${field} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new WorkerError('INVALID_EVALUATION_INPUT', `${field} is invalid.`);
  }
  return value;
}

function asDate(value: unknown, field: string): string {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString();
  }
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  throw new WorkerError('INVALID_EVALUATION_INPUT', `${field} is invalid.`);
}

function toClaimedJob(row: ClaimRow): ClaimedEvaluationJob {
  return {
    id: String(row.id),
    episodeId: row.episode_id,
    submissionId: row.submission_id,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    leaseExpiresAt: asDate(row.lease_expires_at, 'lease_expires_at'),
    payload: asRecord(row.payload, 'job.payload'),
  };
}

function parseAllocationItems(
  value: unknown,
): readonly { sourceCode: string; maxFlowM3s: number }[] {
  return asArray(value, 'allocation_items').map((raw) => {
    const item = asRecord(raw, 'allocation_item');
    if (
      typeof item.sourceCode !== 'string' ||
      typeof item.maxFlowM3s !== 'number' ||
      !Number.isFinite(item.maxFlowM3s)
    ) {
      throw new WorkerError(
        'INVALID_EVALUATION_INPUT',
        'An allocation item is invalid.',
      );
    }
    return { sourceCode: item.sourceCode, maxFlowM3s: item.maxFlowM3s };
  });
}

function parseEvidenceTimestamps(
  value: unknown,
): readonly { informationId: string; accessedVirtualTime: string }[] {
  return asArray(value, 'evidence_timestamps').map((raw) => {
    const timestamp = asRecord(raw, 'evidence_timestamp');
    if (typeof timestamp.informationId !== 'string') {
      throw new WorkerError(
        'INVALID_EVALUATION_INPUT',
        'An evidence timestamp is invalid.',
      );
    }
    return {
      informationId: timestamp.informationId,
      accessedVirtualTime: asDate(
        timestamp.accessedVirtualTime,
        'evidence.accessedVirtualTime',
      ),
    };
  });
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  return `{${entries
    .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
    .join(',')}}`;
}

function sha256Hex(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function databaseVerdict(
  verdict: EvaluationResult['verdict'],
): 'accepted' | 'partially_accepted' | 'rejected' {
  if (verdict === 'pass') return 'accepted';
  if (verdict === 'partial') return 'partially_accepted';
  return 'rejected';
}

function feedbackContent(
  result: EvaluationResult,
  isFinal: boolean,
): {
  summary: Readonly<Record<'zh-CN' | 'en', string>>;
  guidance: Readonly<Record<'zh-CN' | 'en', readonly string[]>>;
  allowedActions: readonly string[];
} {
  if (result.verdict === 'pass') {
    return {
      summary: {
        'zh-CN': '联合调度方案满足水源、生态流量、模型与证据约束。',
        en: 'The joint allocation plan satisfies source, ecological-flow, model, and evidence constraints.',
      },
      guidance: {
        'zh-CN': ['保持当前约束版本，并在下一检查点复核实际水情。'],
        en: [
          'Keep the current rules version and verify observed conditions at the next checkpoint.',
        ],
      },
      allowedActions: isFinal ? [] : ['advance'],
    };
  }
  if (result.verdict === 'partial') {
    return {
      summary: {
        'zh-CN': '联合调度方案基本可行，但仍有指标需要修订。',
        en: 'The joint allocation plan is broadly viable, but some metrics still need revision.',
      },
      guidance: {
        'zh-CN': ['复核生态断面覆盖率和引用证据后提交新版本。'],
        en: [
          'Review ecological-section coverage and cited evidence before submitting a revision.',
        ],
      },
      allowedActions: ['observe', 'revise_submission'],
    };
  }
  return {
    summary: {
      'zh-CN': '联合调度方案未满足确定性约束，不能按当前版本执行。',
      en: 'The joint allocation plan fails deterministic constraints and cannot proceed as submitted.',
    },
    guidance: {
      'zh-CN': ['检查水源流量上限、生态断面目标和证据时间线。'],
      en: [
        'Check source-flow limits, ecological-section targets, and the evidence timeline.',
      ],
    },
    allowedActions: ['observe', 'revise_submission'],
  };
}

function eventHash(
  previousHash: Buffer | null,
  event: Readonly<Record<string, unknown>>,
): Buffer {
  const hash = createHash('sha256');
  if (previousHash !== null) hash.update(previousHash);
  hash.update(stableJson(event));
  return hash.digest();
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('rollback');
  } catch {
    // The original transaction error is more useful than a rollback failure.
  }
}

export class PostgresEvaluationRepository implements EvaluationRepository {
  private readonly pool: Pool;

  constructor(config: PoolConfig | Pool) {
    this.pool = config instanceof Pool ? config : new Pool(config);
  }

  async recoverExpiredLeases(): Promise<number> {
    const result = await this.pool.query<CountRow>(RECOVER_EXPIRED_SQL);
    return Number(result.rows[0]?.count ?? 0);
  }

  async claim(
    workerId: string,
    limit: number,
    leaseMs: number,
  ): Promise<readonly ClaimedEvaluationJob[]> {
    const result = await this.pool.query<ClaimRow>(CLAIM_SQL, [
      workerId,
      limit,
      leaseMs / 1_000,
    ]);
    return result.rows.map(toClaimedJob);
  }

  async load(job: ClaimedEvaluationJob): Promise<EvaluationWorkItem> {
    const result = await this.pool.query<LoadRow>(LOAD_SQL, [
      job.submissionId,
      job.episodeId,
    ]);
    const row = result.rows[0];
    if (row === undefined) {
      throw new WorkerError(
        'SUBMISSION_NOT_FOUND',
        `Submission ${job.submissionId} was not found for the claimed job.`,
      );
    }
    const evidenceTimestamps = parseEvidenceTimestamps(row.evidence_timestamps);
    const input = resolveEvaluationInput(job.payload, {
      submissionPayload: row.submission_payload,
      revisionNo: row.revision_no,
      submittedVirtualAt: asDate(
        row.submitted_virtual_at,
        'submission.submitted_virtual_at',
      ),
      isFinal: row.is_final,
      allocationItems: parseAllocationItems(row.allocation_items),
      evidenceTimestamps,
    });
    const payloadRulesVersion = job.payload.rulesVersion;
    const payloadOutcomeVersion = job.payload.outcomeVersion;
    const payloadFeedbackLevel = job.payload.feedbackLevel;
    return {
      ...job,
      recipientUserId: row.actor_user_id,
      episodeVirtualTime: asDate(
        row.episode_virtual_time,
        'episode.virtual_time',
      ),
      isFinal: row.is_final,
      feedbackLevel:
        typeof payloadFeedbackLevel === 'number' &&
        Number.isInteger(payloadFeedbackLevel) &&
        payloadFeedbackLevel >= 0 &&
        payloadFeedbackLevel <= 6
          ? payloadFeedbackLevel
          : 2,
      rulesVersion:
        typeof payloadRulesVersion === 'string'
          ? payloadRulesVersion
          : (row.constraints_version ?? 'yongding-river-rules-v1'),
      outcomeVersion:
        typeof payloadOutcomeVersion === 'string'
          ? payloadOutcomeVersion
          : 'historical-replay-v1',
      input,
    };
  }

  async complete(
    workerId: string,
    item: EvaluationWorkItem,
    result: EvaluationResult,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const lease = await client.query<QueryResultRow>(
        `
          select id
          from excon_private.evaluation_jobs
          where id = $1
            and status = 'processing'
            and locked_by = $2
            and lease_expires_at > now()
          for update
        `,
        [item.id, workerId],
      );
      if (lease.rowCount !== 1) {
        throw new WorkerError(
          'LEASE_LOST',
          `The lease for evaluation job ${item.id} is no longer valid.`,
        );
      }

      const episodeResult = await client.query<EpisodeRow>(
        `
          select state, virtual_time, last_event_seq::text, last_event_hash
          from public.episodes
          where id = $1
          for update
        `,
        [item.episodeId],
      );
      const episode = episodeResult.rows[0];
      if (episode === undefined || episode.state !== 'evaluating') {
        throw new WorkerError(
          'EPISODE_STATE_CONFLICT',
          `Episode ${item.episodeId} is not in the evaluating state.`,
        );
      }

      const verdict = databaseVerdict(result.verdict);
      const evaluationResult = await client.query<IdRow>(
        `
          insert into excon_private.evaluations (
            job_id,
            submission_id,
            evaluator_key,
            evaluator_version,
            rules_version,
            outcome_version,
            verdict,
            scores,
            private_evidence,
            result_hash
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)
          returning id::text
        `,
        [
          item.id,
          item.submissionId,
          'jing-jin-ji-yongding-deterministic',
          '1.0.0',
          item.rulesVersion,
          item.outcomeVersion,
          verdict,
          JSON.stringify(result.metrics),
          JSON.stringify({
            method: 'deterministic-core-evaluator',
            scenario: 'jing-jin-ji-yongding-water-system',
          }),
          sha256Hex(result),
        ],
      );
      const evaluationId = evaluationResult.rows[0]?.id;
      if (evaluationId === undefined) {
        throw new WorkerError(
          'EVALUATION_WRITE_FAILED',
          'The evaluation insert did not return an identifier.',
        );
      }

      const feedback = feedbackContent(result, item.isFinal);
      const contentHash = sha256Hex({
        evaluationId,
        verdict,
        scores: result.metrics,
        ...feedback,
      });
      await client.query(
        `
          insert into public.feedbacks (
            episode_id,
            submission_id,
            evaluation_id,
            recipient_user_id,
            feedback_level,
            verdict,
            scores,
            summary_i18n,
            guidance_i18n,
            allowed_actions,
            content_hash
          )
          values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11)
        `,
        [
          item.episodeId,
          item.submissionId,
          evaluationId,
          item.recipientUserId,
          item.feedbackLevel,
          verdict,
          JSON.stringify(result.metrics),
          JSON.stringify(feedback.summary),
          JSON.stringify(feedback.guidance),
          feedback.allowedActions,
          contentHash,
        ],
      );

      const nextSequence = Number(episode.last_event_seq) + 1;
      const safePayload = {
        evaluationId,
        verdict,
        totalScore: result.metrics.totalScore,
        feedbackLevel: item.feedbackLevel,
      };
      const event = {
        episodeId: item.episodeId,
        sequence: nextSequence,
        type: 'evaluation_completed',
        audience: 'participant',
        virtualTime: asDate(episode.virtual_time, 'episode.virtual_time'),
        objectType: 'evaluation',
        objectId: evaluationId,
        safePayload,
      };
      const nextEventHash = eventHash(episode.last_event_hash, event);
      await client.query(
        `
          insert into excon_private.episode_events (
            episode_id,
            seq_no,
            event_type,
            audience,
            virtual_time,
            object_type,
            object_id,
            safe_payload,
            previous_hash,
            event_hash
          )
          values ($1, $2, 'evaluation_completed', 'participant', $3, 'evaluation', $4, $5::jsonb, $6, $7)
        `,
        [
          item.episodeId,
          nextSequence,
          episode.virtual_time,
          evaluationId,
          JSON.stringify(safePayload),
          episode.last_event_hash,
          nextEventHash,
        ],
      );

      const nextState = item.isFinal ? 'completed' : 'feedback_available';
      await client.query(
        `
          update public.episodes
          set state = $2,
              completed_at = case when $2 = 'completed' then now() else null end,
              last_event_seq = $3,
              last_event_hash = $4
          where id = $1
        `,
        [item.episodeId, nextState, nextSequence, nextEventHash],
      );
      await client.query(
        `
          update excon_private.evaluation_jobs
          set status = 'succeeded',
              locked_by = null,
              locked_at = null,
              lease_expires_at = null,
              last_error_code = null,
              updated_at = now()
          where id = $1
        `,
        [item.id],
      );
      await client.query('commit');
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async fail(
    workerId: string,
    job: ClaimedEvaluationJob,
    errorCode: string,
  ): Promise<FailureDisposition> {
    const result = await this.pool.query<StatusRow>(
      `
        update excon_private.evaluation_jobs
        set status = case when attempts >= max_attempts then 'dead' else 'pending' end,
            run_after = case
              when attempts >= max_attempts then run_after
              else now() + least(power(2::numeric, greatest(attempts - 1, 0)), 60) * interval '1 second'
            end,
            locked_by = null,
            locked_at = null,
            lease_expires_at = null,
            last_error_code = $3,
            updated_at = now()
        where id = $1
          and status = 'processing'
          and locked_by = $2
          and lease_expires_at > now()
        returning status
      `,
      [job.id, workerId, errorCode.slice(0, 128)],
    );
    const status = result.rows[0]?.status;
    if (status === undefined) return 'lease_lost';
    return status === 'dead' ? 'dead' : 'retry_scheduled';
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
