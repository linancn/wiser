'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import { getDictionary, type Locale } from '@/lib/i18n';
import type {
  ExerciseRun,
  PlatformScenario,
  ReplayReceipt,
} from '@/lib/platform';
import type { ReadModelGap } from '@/lib/read-model-source';
import { ReadModelGaps } from './read-model-state';
import { RunWorkspaceHeader } from './run-workspace';
import workspaceStyles from './run-workspace.module.css';

type ReplayProgressStyle = CSSProperties & { '--replay-progress': string };

function categoryLabel(category: string, locale: Locale): string {
  const labels: Record<string, Record<Locale, string>> = {
    acknowledgement: { 'zh-CN': '确认接收', en: 'Acknowledgement' },
    artifact: { 'zh-CN': '工件', en: 'Artifact' },
    contribution: { 'zh-CN': '专业工件', en: 'Contribution' },
    endorsement: { 'zh-CN': '背书', en: 'Endorsement' },
    evaluation: { 'zh-CN': '裁决', en: 'Evaluation' },
    feedback: { 'zh-CN': '反馈', en: 'Feedback' },
    inject: { 'zh-CN': '信息注入', en: 'Inject' },
    message: { 'zh-CN': '消息', en: 'Message' },
    receipt: { 'zh-CN': '可见性收据', en: 'Receipt' },
    run: { 'zh-CN': '运行', en: 'Run' },
    submission: { 'zh-CN': '提交', en: 'Submission' },
  };
  return labels[category]?.[locale] ?? category;
}

export function RunReplay({
  gaps,
  locale,
  replayByPerspective,
  run,
  scenario,
}: {
  gaps: readonly ReadModelGap[];
  locale: Locale;
  replayByPerspective: Readonly<Record<string, readonly ReplayReceipt[]>>;
  run: ExerciseRun;
  scenario: PlatformScenario;
}) {
  const dictionary = getDictionary(locale);
  const [perspective, setPerspective] = useState('operator');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const events = useMemo(
    () => replayByPerspective[perspective] ?? [],
    [perspective, replayByPerspective],
  );
  const selectedEvent = events[selectedIndex] ?? events[0];
  const perspectiveAgent = run.participants.find(
    (participant) => participant.id === perspective,
  );

  useEffect(() => {
    if (!playing || events.length < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPlaying(false);
      return;
    }
    const timer = window.setInterval(() => {
      setSelectedIndex((current) => {
        if (current >= events.length - 1) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 1_400);
    return () => window.clearInterval(timer);
  }, [events.length, playing]);

  const perspectiveSummary =
    perspectiveAgent === undefined
      ? dictionary.replay.operatorVisible
      : locale === 'zh-CN'
        ? `${perspectiveAgent.displayName[locale]}${dictionary.replay.agentVisibleSuffix}`
        : `${perspectiveAgent.displayName[locale]} — ${dictionary.replay.agentVisibleSuffix}`;
  const progress =
    events.length <= 1 ? 0 : (selectedIndex / (events.length - 1)) * 100;

  return (
    <main id="main-content" className={workspaceStyles.workspace}>
      <RunWorkspaceHeader
        active="replay"
        locale={locale}
        run={run}
        scenario={scenario}
      />
      <section className="replay-page">
        <header className="replay-tool-header">
          <p className="eyebrow">{dictionary.replay.eyebrow}</p>
          <h2>{dictionary.replay.heading}</h2>
          <p>{dictionary.replay.lede}</p>
        </header>

        <ReadModelGaps gaps={gaps} locale={locale} />

        <section
          className="replay-workspace"
          aria-labelledby="replay-stream-heading"
        >
          <div className="replay-control-bar">
            <label>
              <span>{dictionary.replay.perspectiveLabel}</span>
              <select
                aria-label={dictionary.replay.perspectiveLabel}
                value={perspective}
                onChange={(event) => {
                  setPlaying(false);
                  const nextPerspective = event.target.value;
                  const nextEvents = replayByPerspective[nextPerspective] ?? [];
                  const currentSequence = selectedEvent?.sequence;
                  const matchingIndex = nextEvents.findIndex(
                    ({ sequence }) => sequence === currentSequence,
                  );
                  setSelectedIndex(matchingIndex >= 0 ? matchingIndex : 0);
                  setPerspective(nextPerspective);
                }}
              >
                <option value="operator">
                  {dictionary.replay.operatorPerspective}
                </option>
                {run.participants
                  .filter(
                    (participant) =>
                      replayByPerspective[participant.id] !== undefined,
                  )
                  .map((participant) => (
                    <option value={participant.id} key={participant.id}>
                      {participant.displayName[locale]}
                    </option>
                  ))}
              </select>
            </label>
            <div className="replay-perspective-summary" role="status">
              <i aria-hidden="true" />
              {perspectiveSummary}
            </div>
            <span className="readonly-badge light-readonly">
              {dictionary.common.readonly}
            </span>
          </div>

          <div className="replay-trust-boundary" role="note">
            <section>
              <span className="authority-mark" aria-hidden="true">
                ◆
              </span>
              <div>
                <strong>{dictionary.replay.authoritative}</strong>
                <p>{dictionary.replay.authoritativeCopy}</p>
              </div>
            </section>
            <section>
              <span className="overlay-mark" aria-hidden="true">
                ◌
              </span>
              <div>
                <strong>{dictionary.replay.telemetryOverlay}</strong>
                <p>{dictionary.replay.telemetryOverlayCopy}</p>
              </div>
            </section>
          </div>

          <div className="replay-player">
            <div className="replay-buttons">
              <button
                type="button"
                onClick={() => setPlaying((current) => !current)}
                disabled={events.length < 2}
              >
                <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span>
                {playing ? dictionary.replay.pause : dictionary.replay.play}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPlaying(false);
                  setSelectedIndex((current) => Math.max(0, current - 1));
                }}
                disabled={selectedIndex === 0}
              >
                ← {dictionary.replay.previous}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPlaying(false);
                  setSelectedIndex((current) =>
                    Math.min(events.length - 1, current + 1),
                  );
                }}
                disabled={selectedIndex >= events.length - 1}
              >
                {dictionary.replay.next} →
              </button>
            </div>
            <div className="replay-cursor-copy">
              <span>{dictionary.replay.dualClock}</span>
              <code>
                {String(selectedIndex + 1).padStart(2, '0')} /{' '}
                {String(events.length).padStart(2, '0')}
              </code>
            </div>
            <div
              className="replay-timeline"
              style={
                { '--replay-progress': `${progress}%` } as ReplayProgressStyle
              }
            >
              <div className="replay-track" aria-hidden="true">
                <i />
              </div>
              {events.map((event, index) => (
                <button
                  key={event.id}
                  type="button"
                  className={index === selectedIndex ? 'is-current' : ''}
                  style={{
                    left: `${events.length <= 1 ? 0 : (index / (events.length - 1)) * 100}%`,
                  }}
                  onClick={() => {
                    setPlaying(false);
                    setSelectedIndex(index);
                  }}
                  aria-label={`${event.virtualTime} · ${event.title[locale]}`}
                >
                  <i aria-hidden="true" />
                  <span>{event.virtualTime}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="replay-content-grid">
            <section
              className="receipt-stream"
              aria-labelledby="replay-stream-heading"
            >
              <div className="panel-heading">
                <div>
                  <span>{dictionary.replay.eventStoreLabel}</span>
                  <h2 id="replay-stream-heading">
                    {dictionary.replay.eventStream}
                  </h2>
                </div>
                <code>
                  {locale === 'zh-CN'
                    ? `${events.length} ${dictionary.replay.receiptCountLabel}`
                    : `${events.length} visibility ${events.length === 1 ? 'receipt' : 'receipts'}`}
                </code>
              </div>
              {events.length === 0 ? (
                <p className="empty-state">{dictionary.replay.noEvents}</p>
              ) : (
                <ol>
                  {events.map((event, index) => (
                    <li
                      data-testid="replay-event"
                      className={index === selectedIndex ? 'is-current' : ''}
                      key={event.id}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setPlaying(false);
                          setSelectedIndex(index);
                        }}
                      >
                        <span className="receipt-sequence">
                          #{event.sequence}
                        </span>
                        <span
                          className={`receipt-category category-${event.category}`}
                        >
                          {categoryLabel(event.category, locale)}
                        </span>
                        <strong>{event.title[locale]}</strong>
                        <span className="receipt-time">
                          {event.virtualTime} · {event.wallTime}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <aside className="receipt-inspector" aria-live="polite">
              <div className="inspector-heading">
                <span>{dictionary.replay.receipt}</span>
                <code>{dictionary.replay.capturedNotRecomputed}</code>
              </div>
              {selectedEvent === undefined ? null : (
                <>
                  <div className="receipt-inspector-title">
                    <span
                      className={`receipt-category category-${selectedEvent.category}`}
                    >
                      {categoryLabel(selectedEvent.category, locale)}
                    </span>
                    <h2>{selectedEvent.title[locale]}</h2>
                    <p>{selectedEvent.detail[locale]}</p>
                  </div>
                  <dl className="receipt-facts">
                    <div>
                      <dt>{dictionary.replay.sequence}</dt>
                      <dd>#{selectedEvent.sequence}</dd>
                    </div>
                    <div>
                      <dt>{dictionary.common.virtualTime}</dt>
                      <dd>{selectedEvent.virtualTime}</dd>
                    </div>
                    <div>
                      <dt>{dictionary.common.wallTime}</dt>
                      <dd>{selectedEvent.wallTime}</dd>
                    </div>
                    <div>
                      <dt>{dictionary.replay.digest}</dt>
                      <dd>{selectedEvent.digest}</dd>
                    </div>
                  </dl>
                  <div className="receipt-visibility">
                    <span>{dictionary.replay.visibleToLabel}</span>
                    <div>
                      {selectedEvent.visibility === 'operator' ? (
                        <code>{dictionary.replay.operatorPerspective}</code>
                      ) : (
                        selectedEvent.visibleTo.map((agentId) => (
                          <code key={agentId}>{agentId}</code>
                        ))
                      )}
                    </div>
                  </div>
                  {selectedEvent.traceId === undefined ? null : (
                    <div className="id-stack">
                      <span>{dictionary.replay.traceSpanLabel}</span>
                      <code>{selectedEvent.traceId}</code>
                      <code>{selectedEvent.spanId}</code>
                    </div>
                  )}
                </>
              )}
            </aside>
          </div>
        </section>
      </section>
    </main>
  );
}
