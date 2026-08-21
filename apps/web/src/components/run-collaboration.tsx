'use client';

import { useMemo, useState } from 'react';

import { getDictionary, type Locale } from '@/lib/i18n';
import type {
  CollaborationExchange,
  ExerciseRun,
  PlatformScenario,
} from '@/lib/platform';
import type { ReadModelGap } from '@/lib/read-model-source';
import {
  collaborationKindLabel,
  collaborationSummary,
  deliveryStateLabel,
  interactionNeedsAttention,
} from '@/lib/run-collaboration';
import { ReadModelGaps } from './read-model-state';
import { RunLiveRefresh } from './run-live-refresh';
import { RunWorkspaceHeader } from './run-workspace';
import workspaceStyles from './run-workspace.module.css';
import styles from './run-collaboration.module.css';

type CollaborationFilter = 'all' | 'attention' | 'requests' | 'handoffs';

function agentName(run: ExerciseRun, agentId: string, locale: Locale): string {
  return (
    run.participants.find(({ id }) => id === agentId)?.displayName[locale] ??
    agentId
  );
}

function senderName(
  exchange: CollaborationExchange,
  run: ExerciseRun,
  locale: Locale,
): string {
  return exchange.senderType === 'EXCON'
    ? getDictionary(locale).collaboration.operator
    : agentName(run, exchange.senderId, locale);
}

function exchangeStatusLabel(
  exchange: CollaborationExchange,
  locale: Locale,
): string {
  const copy = getDictionary(locale).collaboration;
  if (exchange.status === 'responded') return copy.responded;
  if (exchange.status === 'complete') return copy.complete;
  return copy.open;
}

function deliverySummary(
  exchange: CollaborationExchange,
  locale: Locale,
): string {
  if (exchange.deliveries.some(({ state }) => state === 'pending_sync')) {
    return deliveryStateLabel('pending_sync', locale);
  }
  if (exchange.deliveries.some(({ state }) => state === 'issued')) {
    return deliveryStateLabel('issued', locale);
  }
  return deliveryStateLabel('acknowledged', locale);
}

function ExchangeDetail({
  exchange,
  exchangesById,
  locale,
  onSelect,
  run,
}: {
  readonly exchange: CollaborationExchange;
  readonly exchangesById: ReadonlyMap<string, CollaborationExchange>;
  readonly locale: Locale;
  readonly onSelect: (exchangeId: string) => void;
  readonly run: ExerciseRun;
}) {
  const copy = getDictionary(locale).collaboration;
  const responses = exchange.responseMessageIds
    .map((responseId) => exchangesById.get(responseId))
    .filter((response): response is CollaborationExchange => Boolean(response));

  return (
    <div className={styles.detail}>
      <header className={styles.detailHeader}>
        <span data-kind={exchange.kind}>
          {collaborationKindLabel(exchange.kind, locale)}
        </span>
        <h3>{exchange.subject[locale]}</h3>
        <p>{exchangeStatusLabel(exchange, locale)}</p>
      </header>

      <dl className={styles.detailFacts}>
        <div>
          <dt>{copy.sequence}</dt>
          <dd>#{exchange.createdRunSeq}</dd>
        </div>
        <div>
          <dt>{getDictionary(locale).common.virtualTime}</dt>
          <dd>{exchange.createdVirtualAt}</dd>
        </div>
        <div>
          <dt>{copy.sender}</dt>
          <dd>{senderName(exchange, run, locale)}</dd>
        </div>
        <div>
          <dt>{copy.thread}</dt>
          <dd title={exchange.threadId}>{exchange.threadId}</dd>
        </div>
      </dl>

      <section className={styles.detailSection}>
        <h4>{copy.delivery}</h4>
        <ul className={styles.deliveryList}>
          {exchange.deliveries.map((delivery) => (
            <li key={delivery.recipientRunAgentId} data-state={delivery.state}>
              <span>
                <strong>
                  {agentName(run, delivery.recipientRunAgentId, locale)}
                </strong>
                <small>{deliveryStateLabel(delivery.state, locale)}</small>
              </span>
              {delivery.agentReceiptSeq === undefined ? null : (
                <code>
                  {copy.receiptSeq} #{delivery.agentReceiptSeq}
                  {delivery.acknowledgedRunSeq === undefined
                    ? ''
                    : ` · ${copy.runSeq} #${delivery.acknowledgedRunSeq}`}
                </code>
              )}
            </li>
          ))}
        </ul>
      </section>

      {exchange.artifactVersionRefs.length === 0 ? null : (
        <section className={styles.detailSection}>
          <h4>{copy.artifacts}</h4>
          <ul className={styles.artifactList}>
            {exchange.artifactVersionRefs.map((artifact) => (
              <li key={artifact.artifactVersionId}>
                <code>{artifact.artifactVersionId}</code>
                <small>{artifact.contentHash}</small>
              </li>
            ))}
          </ul>
        </section>
      )}

      {responses.length === 0 ? null : (
        <section className={styles.detailSection}>
          <h4>{copy.responses}</h4>
          <div className={styles.responseLinks}>
            {responses.map((response) => (
              <button
                type="button"
                key={response.id}
                onClick={() => onSelect(response.id)}
              >
                <span>{agentName(run, response.senderId, locale)}</span>
                <strong>{response.subject[locale]}</strong>
                <small>#{response.createdRunSeq} ↗</small>
              </button>
            ))}
          </div>
        </section>
      )}

      <p className={styles.trustNote}>{copy.trustNote}</p>
    </div>
  );
}

export function RunCollaboration({
  gaps,
  interactions,
  liveMode,
  locale,
  run,
  scenario,
}: {
  readonly gaps: readonly ReadModelGap[];
  readonly interactions: readonly CollaborationExchange[];
  readonly liveMode: boolean;
  readonly locale: Locale;
  readonly run: ExerciseRun;
  readonly scenario: PlatformScenario;
}) {
  const dictionary = getDictionary(locale);
  const copy = dictionary.collaboration;
  const [filter, setFilter] = useState<CollaborationFilter>('all');
  const [selectedId, setSelectedId] = useState<string | undefined>(
    interactions[0]?.id,
  );
  const [mobileExpandedId, setMobileExpandedId] = useState<string>();
  const summary = collaborationSummary(interactions);
  const exchangesById = useMemo(
    () => new Map(interactions.map((exchange) => [exchange.id, exchange])),
    [interactions],
  );

  const filtered = useMemo(() => {
    if (filter === 'attention') {
      return interactions.filter(interactionNeedsAttention);
    }
    if (filter === 'requests') {
      return interactions.filter(
        ({ kind }) => kind === 'request' || kind === 'response',
      );
    }
    if (filter === 'handoffs') {
      return interactions.filter(({ kind }) => kind === 'handoff');
    }
    return interactions;
  }, [filter, interactions]);
  const selected = filtered.find(({ id }) => id === selectedId) ?? filtered[0];
  const filters: readonly {
    id: CollaborationFilter;
    label: string;
  }[] = [
    { id: 'all', label: copy.all },
    { id: 'attention', label: copy.attention },
    { id: 'requests', label: copy.requests },
    { id: 'handoffs', label: copy.handoffs },
  ];

  function selectExchange(exchangeId: string) {
    setSelectedId(exchangeId);
    setMobileExpandedId((current) =>
      current === exchangeId ? undefined : exchangeId,
    );
  }

  return (
    <main id="main-content" className={workspaceStyles.workspace}>
      <RunWorkspaceHeader
        active="collaboration"
        locale={locale}
        run={run}
        scenario={scenario}
      />
      <section className={styles.page}>
        <header className={styles.toolHeader}>
          <div>
            <p>{copy.eyebrow}</p>
            <h2>{copy.heading}</h2>
          </div>
          <p>{copy.lede}</p>
        </header>

        <RunLiveRefresh
          autoRefresh={liveMode && run.state === 'running'}
          className={styles.refreshBar}
          locale={locale}
        />

        <section
          className={styles.statusBand}
          aria-labelledby="collaboration-status-heading"
        >
          <strong id="collaboration-status-heading">{copy.statusLabel}</strong>
          <span>
            <b>{summary.handoffCount}</b> {copy.handoffClosedSuffix}
          </span>
          <span data-attention={summary.openRequestCount > 0}>
            <b>{summary.openRequestCount}</b> {copy.openRequestSuffix}
          </span>
          <span>
            <b>{summary.responseCount}</b> {copy.responseSuffix}
          </span>
          <span>
            <b>
              {summary.acknowledgedDeliveries}/{summary.totalDeliveries}
            </b>{' '}
            {copy.deliveryClosedSuffix}
          </span>
        </section>

        <div className={styles.filterBar}>
          <div role="group" aria-label={copy.filterLabel}>
            {filters.map((item) => (
              <button
                type="button"
                aria-pressed={filter === item.id}
                key={item.id}
                onClick={() => {
                  setFilter(item.id);
                  setSelectedId(undefined);
                  setMobileExpandedId(undefined);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <code>
            {filtered.length} {copy.exchangeCount}
          </code>
        </div>

        <section className={styles.routingMap} aria-label={copy.routingMap}>
          <header>
            <span>{copy.routingMap}</span>
            <small>{copy.routingProtocol}</small>
          </header>
          <div>
            {run.participants.map((agent) => {
              const inbound = interactions.filter(({ deliveries }) =>
                deliveries.some(
                  ({ recipientRunAgentId }) => recipientRunAgentId === agent.id,
                ),
              ).length;
              const outbound = interactions.filter(
                ({ senderId }) => senderId === agent.id,
              ).length;
              return (
                <article
                  data-testid="collaboration-agent-node"
                  data-coordinator={agent.roleId.includes('coordination')}
                  key={agent.id}
                >
                  <i aria-hidden="true" />
                  <strong>{agent.displayName[locale]}</strong>
                  <small>{agent.roleId}</small>
                  <dl>
                    <div>
                      <dt>{copy.inbound}</dt>
                      <dd>{inbound}</dd>
                    </div>
                    <div>
                      <dt>{copy.outbound}</dt>
                      <dd>{outbound}</dd>
                    </div>
                  </dl>
                </article>
              );
            })}
          </div>
        </section>

        <div className={styles.workspaceGrid}>
          <section className={styles.ledger} aria-labelledby="ledger-heading">
            <header className={styles.ledgerHeader}>
              <div>
                <span>{copy.ledgerEyebrow}</span>
                <h3 id="ledger-heading">{copy.ledger}</h3>
              </div>
              <p>{copy.ledgerLede}</p>
            </header>

            {filtered.length === 0 ? (
              <p className={styles.empty}>{copy.noExchanges}</p>
            ) : (
              <ol className={styles.exchangeList}>
                {filtered.map((exchange) => {
                  const isSelected = selected?.id === exchange.id;
                  const sender = senderName(exchange, run, locale);
                  const recipients = exchange.recipientRunAgentIds
                    .map((agentId) => agentName(run, agentId, locale))
                    .join(locale === 'zh-CN' ? '、' : ', ');
                  const testId =
                    exchange.kind === 'handoff'
                      ? 'collaboration-handoff'
                      : exchange.kind === 'request'
                        ? 'collaboration-request'
                        : undefined;
                  const mobileDetailId = `mobile-exchange-detail-${exchange.id}`;
                  const isMobileExpanded = mobileExpandedId === exchange.id;
                  return (
                    <li
                      data-testid="collaboration-exchange"
                      data-kind={exchange.kind}
                      data-status={exchange.status}
                      key={exchange.id}
                    >
                      <div
                        data-testid={testId}
                        className={styles.exchangeShell}
                      >
                        <button
                          type="button"
                          className={styles.exchangeButton}
                          aria-controls={mobileDetailId}
                          aria-expanded={isMobileExpanded}
                          aria-pressed={isSelected}
                          onClick={() => selectExchange(exchange.id)}
                        >
                          <span className={styles.exchangeMeta}>
                            <code>#{exchange.createdRunSeq}</code>
                            <span data-kind={exchange.kind}>
                              {collaborationKindLabel(exchange.kind, locale)}
                            </span>
                            <time>{exchange.createdVirtualAt}</time>
                          </span>
                          <span className={styles.exchangeRoute}>
                            <small>{sender}</small>
                            <i aria-hidden="true">→</i>
                            <small>{recipients}</small>
                          </span>
                          <strong>{exchange.subject[locale]}</strong>
                          <span className={styles.exchangeState}>
                            <small>
                              {exchangeStatusLabel(exchange, locale)}
                            </small>
                            <b>{deliverySummary(exchange, locale)}</b>
                          </span>
                        </button>
                        {isMobileExpanded ? (
                          <div
                            id={mobileDetailId}
                            className={styles.mobileDetail}
                            data-testid="mobile-exchange-detail"
                            role="region"
                            aria-label={`${exchange.subject[locale]} · ${copy.inspector}`}
                          >
                            <ExchangeDetail
                              exchange={exchange}
                              exchangesById={exchangesById}
                              locale={locale}
                              onSelect={selectExchange}
                              run={run}
                            />
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <aside
            id="collaboration-inspector"
            className={styles.inspector}
            data-testid="collaboration-inspector"
            aria-live="polite"
          >
            <div className={styles.inspectorLabel}>
              <span>{copy.inspector}</span>
              <code>{copy.capturedNotInferred}</code>
            </div>
            {selected === undefined ? (
              <p className={styles.empty}>{copy.noExchanges}</p>
            ) : (
              <ExchangeDetail
                exchange={selected}
                exchangesById={exchangesById}
                locale={locale}
                onSelect={selectExchange}
                run={run}
              />
            )}
          </aside>
        </div>

        <ReadModelGaps gaps={gaps} locale={locale} />
      </section>
    </main>
  );
}
