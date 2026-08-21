'use client';

import { useMemo, useState, type CSSProperties } from 'react';

import { getDictionary, type Locale } from '@/lib/i18n';
import type {
  AgentSession,
  ExerciseRun,
  ExerciseSpan,
  PlatformScenario,
} from '@/lib/platform';
import type { ReadModelGap } from '@/lib/read-model-source';
import { ReadModelGaps } from './read-model-state';
import { RunWorkspaceHeader } from './run-workspace';
import workspaceStyles from './run-workspace.module.css';

type TimelineStyle = CSSProperties & {
  '--span-left': string;
  '--span-width': string;
};

function stateLabel(state: AgentSession['state'], locale: Locale): string {
  const labels = {
    complete: { 'zh-CN': '已完成', en: 'Complete' },
    disconnected: { 'zh-CN': '已断开', en: 'Disconnected' },
    done: { 'zh-CN': '已完成', en: 'Done' },
    joined: { 'zh-CN': '已加入', en: 'Joined' },
    ready: { 'zh-CN': '已就绪', en: 'Ready' },
    removed: { 'zh-CN': '已移除', en: 'Removed' },
    waiting: { 'zh-CN': '等待中', en: 'Waiting' },
    'waiting-feedback': { 'zh-CN': '等待反馈', en: 'Waiting for feedback' },
    working: { 'zh-CN': '工作中', en: 'Working' },
  } as const;
  return labels[state][locale];
}

function operationLabel(operation: ExerciseSpan['operation'], locale: Locale) {
  const labels: Record<ExerciseSpan['operation'], Record<Locale, string>> = {
    inject: { 'zh-CN': '信息注入', en: 'Inject' },
    sync: { 'zh-CN': '同步收据', en: 'Sync receipts' },
    model: { 'zh-CN': '模型推理', en: 'Model' },
    tool: { 'zh-CN': '工具调用', en: 'Tool' },
    contribution: { 'zh-CN': '专业工件', en: 'Contribution' },
    coordination: { 'zh-CN': '团队汇聚', en: 'Coordination' },
    submission: { 'zh-CN': '团队提交', en: 'Submission' },
    evaluation: { 'zh-CN': '确定性裁决', en: 'Evaluation' },
    feedback: { 'zh-CN': '定向反馈', en: 'Feedback' },
  };
  return labels[operation][locale];
}

function AgentIdentity({
  agent,
  locale,
}: {
  agent: AgentSession | undefined;
  locale: Locale;
}) {
  if (agent === undefined) return null;
  const dictionary = getDictionary(locale);
  const version = agent.version ?? agent.agentVersionId;
  return (
    <>
      <strong>{agent.displayName[locale]}</strong>
      <small>
        {version ?? '—'} · {agent.model ?? dictionary.trace.unknownModel}
      </small>
    </>
  );
}

export function RunTrace({
  gaps,
  locale,
  run,
  scenario,
}: {
  gaps: readonly ReadModelGap[];
  locale: Locale;
  run: ExerciseRun;
  scenario: PlatformScenario;
}) {
  const dictionary = getDictionary(locale);
  const initialSpan =
    run.spans.find((span) => span.operation === 'evaluation') ?? run.spans[0];
  const [selectedSpanId, setSelectedSpanId] = useState(initialSpan?.id);
  const selectedSpan = run.spans.find((span) => span.id === selectedSpanId);
  const selectedAgent = run.participants.find(
    (agent) => agent.id === selectedSpan?.agentSessionId,
  );

  const lanes = useMemo(
    () => [
      {
        id: 'excon',
        label: dictionary.trace.excon,
        agent: undefined,
        state: 'working' as const,
      },
      ...run.participants.map((agent) => ({
        id: agent.id,
        label: agent.displayName[locale],
        agent,
        state: agent.state,
      })),
    ],
    [dictionary.trace.excon, locale, run.participants],
  );

  function selectAgent(agentId: string) {
    const preferred = [...run.spans]
      .reverse()
      .find((span) => span.agentSessionId === agentId);
    if (preferred !== undefined) setSelectedSpanId(preferred.id);
  }

  return (
    <main id="main-content" className={workspaceStyles.workspace}>
      <RunWorkspaceHeader
        active="trace"
        locale={locale}
        run={run}
        scenario={scenario}
      />
      <section className="trace-page">
        <header className="trace-tool-header">
          <div>
            <p className="eyebrow">{dictionary.trace.eyebrow}</p>
            <h2>{dictionary.trace.workspaceHeading}</h2>
            <p>{dictionary.trace.workspaceLede}</p>
          </div>
        </header>

        <ReadModelGaps gaps={gaps} locale={locale} />

        {run.spans.length === 0 ? (
          <section
            className="trace-summary-section"
            aria-labelledby="trace-summary-heading"
          >
            <div className="trace-section-heading">
              <div>
                <p className="eyebrow">TRACE-LEVEL · NO SYNTHETIC SPANS</p>
                <h2 id="trace-summary-heading">
                  {dictionary.trace.traceSummaries}
                </h2>
              </div>
              <p>{dictionary.trace.traceSummariesLede}</p>
            </div>
            {run.traceSummaries.length === 0 ? (
              <p className="empty-state">{dictionary.trace.noTelemetry}</p>
            ) : (
              <ol className="trace-summary-list">
                {run.traceSummaries.map((trace) => {
                  const participant = run.participants.find(
                    ({ id }) => id === trace.runAgentId,
                  );
                  return (
                    <li data-testid="trace-summary" key={trace.traceId}>
                      <div>
                        <span className={`trust-mark trust-${trace.trust}`} />
                        <strong>{trace.name}</strong>
                        <code>{trace.traceId}</code>
                      </div>
                      <dl>
                        <div>
                          <dt>{dictionary.trace.agentSession}</dt>
                          <dd>
                            {participant?.displayName[locale] ??
                              dictionary.trace.excon}
                          </dd>
                        </div>
                        <div>
                          <dt>{dictionary.trace.duration}</dt>
                          <dd>{trace.durationMs.toLocaleString(locale)} ms</dd>
                        </div>
                        <div>
                          <dt>{dictionary.trace.spanCount}</dt>
                          <dd>{trace.spanCount}</dd>
                        </div>
                        <div>
                          <dt>{dictionary.trace.status}</dt>
                          <dd>{trace.status}</dd>
                        </div>
                        <div>
                          <dt>{dictionary.trace.source}</dt>
                          <dd>
                            {trace.source === 'excon_service'
                              ? dictionary.trace.exconService
                              : dictionary.trace.participantExporter}
                          </dd>
                        </div>
                        <div>
                          <dt>{dictionary.common.wallTime}</dt>
                          <dd>{trace.startedAt}</dd>
                        </div>
                      </dl>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        ) : (
          <section
            className="trace-workspace"
            aria-labelledby="agent-lanes-heading"
          >
            <div className="trace-section-heading trace-workspace-heading">
              <div>
                <p className="eyebrow">WALL + VIRTUAL TIME</p>
                <h2 id="agent-lanes-heading">{dictionary.trace.agentLanes}</h2>
              </div>
              <div className="clock-legend">
                <span>
                  <i className="wall-dot" aria-hidden="true" />
                  {dictionary.trace.wallClock}
                </span>
                <span>
                  <i className="virtual-dot" aria-hidden="true" />
                  {dictionary.trace.virtualClock}
                </span>
              </div>
            </div>

            <div className="trace-layout">
              <div className="waterfall-panel">
                <div
                  className="dual-clock-axis"
                  aria-label={dictionary.trace.dualClock}
                >
                  <div className="axis-labels wall-axis">
                    {[
                      '10:31:40',
                      '10:31:45',
                      '10:31:50',
                      '10:31:55',
                      '10:32:00',
                    ].map((time) => (
                      <span key={time}>{time}</span>
                    ))}
                  </div>
                  <div className="axis-line" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                  <div className="axis-labels virtual-axis">
                    {[
                      'T+12:00',
                      'T+12:01',
                      'T+12:02',
                      'T+12:04',
                      'T+12:05',
                    ].map((time) => (
                      <span key={time}>{time}</span>
                    ))}
                  </div>
                </div>

                <div className="agent-lanes">
                  {lanes.map((lane) => {
                    const laneSpans = run.spans.filter(
                      (span) => span.agentSessionId === lane.id,
                    );
                    return (
                      <div
                        className={`agent-lane ${selectedSpan?.agentSessionId === lane.id ? 'is-selected' : ''}`}
                        data-testid="agent-lane"
                        key={lane.id}
                      >
                        <button
                          type="button"
                          className="lane-identity"
                          onClick={() => selectAgent(lane.id)}
                          aria-label={`${lane.label} · ${stateLabel(lane.state, locale)}`}
                          aria-pressed={
                            selectedSpan?.agentSessionId === lane.id
                          }
                        >
                          <span
                            className={`agent-state ${lane.state}`}
                            aria-hidden="true"
                          />
                          <span>
                            {lane.agent === undefined ? (
                              <>
                                <strong>{lane.label}</strong>
                                <small>service.name / agent-excon</small>
                              </>
                            ) : (
                              <AgentIdentity
                                agent={lane.agent}
                                locale={locale}
                              />
                            )}
                          </span>
                        </button>
                        <div className="lane-track">
                          <div className="lane-water" aria-hidden="true" />
                          {laneSpans.map((span) => (
                            <button
                              type="button"
                              className={`span-block operation-${span.operation} status-${span.status} trust-${span.telemetryTrust} ${selectedSpanId === span.id ? 'is-selected' : ''}`}
                              style={
                                {
                                  '--span-left': `${span.startPercent}%`,
                                  '--span-width': `${span.durationPercent}%`,
                                } as TimelineStyle
                              }
                              title={`${span.name[locale]} · ${span.durationMs}ms`}
                              onClick={() => setSelectedSpanId(span.id)}
                              aria-pressed={selectedSpanId === span.id}
                              key={span.id}
                            >
                              <span>{span.name[locale]}</span>
                              {span.links.length > 0 ? (
                                <b
                                  aria-label={`${span.links.length} ${dictionary.trace.linkedSpans}`}
                                >
                                  ↝{span.links.length}
                                </b>
                              ) : null}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <aside
                className="span-inspector"
                data-testid="span-inspector"
                aria-live="polite"
              >
                <div className="inspector-heading">
                  <span>{dictionary.trace.inspector}</span>
                  <code>OTel safe projection</code>
                </div>
                {selectedSpan === undefined ? (
                  <p className="inspector-empty">
                    {dictionary.trace.selectHint}
                  </p>
                ) : (
                  <>
                    <div className="inspector-title">
                      <span
                        className={`operation-mark operation-${selectedSpan.operation}`}
                        aria-hidden="true"
                      />
                      <div>
                        <small>
                          {operationLabel(selectedSpan.operation, locale)}
                        </small>
                        <h3>{selectedSpan.name[locale]}</h3>
                      </div>
                    </div>
                    <dl className="inspector-facts">
                      <div>
                        <dt>{dictionary.trace.agentSession}</dt>
                        <dd>
                          {selectedAgent?.displayName[locale] ??
                            dictionary.trace.excon}
                        </dd>
                      </div>
                      <div>
                        <dt>{dictionary.trace.duration}</dt>
                        <dd>
                          {selectedSpan.durationMs.toLocaleString(locale)} ms
                        </dd>
                      </div>
                      <div>
                        <dt>{dictionary.trace.status}</dt>
                        <dd>{selectedSpan.status}</dd>
                      </div>
                      <div>
                        <dt>{dictionary.trace.operation}</dt>
                        <dd>{selectedSpan.operation}</dd>
                      </div>
                      <div>
                        <dt>{dictionary.trace.source}</dt>
                        <dd>
                          {selectedSpan.telemetrySource === 'excon_service'
                            ? dictionary.trace.exconService
                            : dictionary.trace.participantExporter}
                        </dd>
                      </div>
                      <div>
                        <dt>{dictionary.trace.trust}</dt>
                        <dd>
                          {selectedSpan.telemetryTrust === 'platform_observed'
                            ? dictionary.trace.platformObserved
                            : dictionary.trace.participantReported}
                        </dd>
                      </div>
                    </dl>
                    <div className="id-stack">
                      <span>{dictionary.trace.traceId}</span>
                      <code>{selectedSpan.traceId}</code>
                      <span>{dictionary.trace.spanId}</span>
                      <code>{selectedSpan.id}</code>
                    </div>
                    <section className="inspector-section">
                      <h4>{dictionary.trace.linkedSpans}</h4>
                      {selectedSpan.links.length === 0 ? (
                        <p>—</p>
                      ) : (
                        <ul className="link-list">
                          {selectedSpan.links.map((link) => (
                            <li key={`${link.spanId}-${link.label.en}`}>
                              <span>↝ {link.label[locale]}</span>
                              <code>{link.spanId}</code>
                              <small>{dictionary.trace.linkRelation}</small>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                    <section className="inspector-section attributes-section">
                      <h4>{dictionary.trace.attributes}</h4>
                      <dl>
                        {Object.entries(selectedSpan.attributes).map(
                          ([key, value]) => (
                            <div key={key}>
                              <dt>{key}</dt>
                              <dd>{value}</dd>
                            </div>
                          ),
                        )}
                      </dl>
                    </section>
                    <section className="inspector-section log-section">
                      <h4>{dictionary.trace.logs}</h4>
                      <p>{dictionary.trace.logsCopy}</p>
                      {selectedSpan.events.length === 0 ? (
                        <code>{dictionary.trace.noLogs}</code>
                      ) : (
                        selectedSpan.events.map((event) => (
                          <code key={`${event.atMs}-${event.name}`}>
                            +{event.atMs}ms {event.name} ·{' '}
                            {event.detail[locale]}
                          </code>
                        ))
                      )}
                    </section>
                  </>
                )}
              </aside>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
