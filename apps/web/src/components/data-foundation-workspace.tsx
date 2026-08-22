import Link from 'next/link';
import type { ReactNode } from 'react';

import type {
  CapabilityRegistryDto,
  DataCatalogItemDto,
  DataItemVersionDto,
  GeoFeatureDto,
  GraphResultDto,
  IngestionDto,
  IngestionState,
  OperationEventDto,
  PublicationStatus,
  SearchResultDto,
  SecurityLevel,
} from '@/lib/data-foundation';
import { ingestionStepState } from '@/lib/data-foundation';
import type { DataFoundationApiError } from '@/lib/data-foundation-dal.server';
import { getDictionary, type Locale } from '@/lib/i18n';

import styles from './data-foundation-workspace.module.css';

type DataCopy = ReturnType<typeof getDictionary>['dataFoundation'];

const INGESTION_STAGES = [
  'RECEIVED',
  'QUARANTINED',
  'SECURITY_SCANNED',
  'FINGERPRINTED',
  'PROFILED',
  'CLASSIFIED',
  'SCHEMA_MAPPED',
  'SEMANTIC_MAPPED',
  'VALIDATED',
  'SPATIOTEMPORAL_ALIGNED',
  'REVIEW_REQUIRED',
  'APPROVED',
  'REJECTED',
  'COMMITTED',
  'PROJECTING',
  'PUBLISHED',
  'FAILED',
  'CANCELLED',
] as const satisfies readonly IngestionState[];

export function DataPageMain({ children }: { readonly children: ReactNode }) {
  return (
    <main id="main-content" className={`page-main ${styles.page}`}>
      {children}
    </main>
  );
}

export function DataSection({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section className={`${styles.section} ${className ?? ''}`.trim()}>
      {children}
    </section>
  );
}

export function PanelGrid({ children }: { readonly children: ReactNode }) {
  return <div className={styles.panelGrid}>{children}</div>;
}

export function QueryForm({
  action,
  defaultValue,
  hint,
  label,
  name,
  placeholder,
  resetHref,
  resetLabel,
  submitLabel,
}: {
  readonly action: string;
  readonly defaultValue?: string;
  readonly hint?: string;
  readonly label: string;
  readonly name: string;
  readonly placeholder: string;
  readonly resetHref: string;
  readonly resetLabel: string;
  readonly submitLabel: string;
}) {
  const inputId = `data-query-${name}`;
  return (
    <form className={styles.queryForm} action={action} method="get">
      <label htmlFor={inputId}>{label}</label>
      <div>
        <input
          id={inputId}
          name={name}
          type="search"
          defaultValue={defaultValue}
          placeholder={placeholder}
          autoComplete="off"
          maxLength={2_048}
        />
        <button type="submit">{submitLabel}</button>
        <Link href={resetHref}>{resetLabel}</Link>
      </div>
      {hint === undefined ? null : <small>{hint}</small>}
    </form>
  );
}

export function Notice({
  copy,
  title,
}: {
  readonly copy: string;
  readonly title: string;
}) {
  return (
    <aside className={styles.notice}>
      <span aria-hidden="true">i</span>
      <div>
        <strong>{title}</strong>
        <p>{copy}</p>
      </div>
    </aside>
  );
}

export function MetricStrip({
  metrics,
}: {
  readonly metrics: readonly {
    readonly label: string;
    readonly value: ReactNode;
    readonly state?: 'danger' | 'success' | 'warning';
  }[];
}) {
  return (
    <dl className={styles.metricStrip}>
      {metrics.map((metric) => (
        <div key={metric.label} data-state={metric.state}>
          <dt>{metric.label}</dt>
          <dd>{metric.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function tone(value: string): 'danger' | 'neutral' | 'success' | 'warning' {
  if (
    ['FAILED', 'REJECTED', 'CORRECTION_REQUIRED', 'WITHDRAWN'].includes(value)
  ) {
    return 'danger';
  }
  if (
    ['PASSED', 'PUBLISHED', 'SUCCEEDED', 'COMMITTED', 'APPROVED', 'A'].includes(
      value,
    )
  ) {
    return 'success';
  }
  if (
    [
      'PENDING',
      'PUBLISHING',
      'WAITING_INPUT',
      'WAITING_REVIEW',
      'REVIEW_REQUIRED',
      'CONDITIONALLY_PASSED',
      'B',
    ].includes(value)
  ) {
    return 'warning';
  }
  return 'neutral';
}

export function formatDataDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value));
}

export function DataPageHeader({
  aside,
  eyebrow,
  lede,
  title,
}: {
  readonly aside?: ReactNode;
  readonly eyebrow: string;
  readonly lede: string;
  readonly title: string;
}) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        <p className={styles.lede}>{lede}</p>
      </div>
      {aside}
    </header>
  );
}

export function AuthorityFlag({ locale }: { readonly locale: Locale }) {
  const copy = getDictionary(locale).dataFoundation.common;
  return (
    <aside className={styles.authorityFlag}>
      <span>{copy.authorityEyebrow}</span>
      <strong>{copy.liveData}</strong>
      <small>{copy.noReferenceData}</small>
    </aside>
  );
}

export function DataFailureState({
  error,
  locale,
}: {
  readonly error: DataFoundationApiError;
  readonly locale: Locale;
}) {
  const copy = getDictionary(locale).dataFoundation;
  const failure = (() => {
    switch (error.kind) {
      case 'authentication':
        return copy.failures.authentication;
      case 'authorization':
        return copy.failures.authorization;
      case 'configuration':
        return copy.failures.configuration;
      case 'contract':
        return copy.failures.contract;
      case 'invalid-request':
        return copy.failures.invalidRequest;
      case 'not-found':
        return copy.failures.notFound;
      case 'unavailable':
        return copy.failures.unavailable;
    }
  })();
  return (
    <section className={styles.failure} role="alert">
      <div className={styles.failureGauge} aria-hidden="true">
        <span>!</span>
      </div>
      <div>
        <p className={styles.eyebrow}>HTTP {error.status}</p>
        <h1>{failure.title}</h1>
        <p>{failure.copy}</p>
        <strong>{failure.action}</strong>
      </div>
    </section>
  );
}

export function DataEmpty({
  copy,
  title,
}: {
  readonly copy: string;
  readonly title: string;
}) {
  return (
    <div className={styles.empty}>
      <span aria-hidden="true">∅</span>
      <div>
        <strong>{title}</strong>
        <p>{copy}</p>
      </div>
    </div>
  );
}

export function ProtocolValue({ children }: { readonly children: ReactNode }) {
  return <code className={styles.protocol}>{children}</code>;
}

export function StatusBadge({
  code,
  label,
}: {
  readonly code: string;
  readonly label: string;
}) {
  return (
    <span className={styles.status} data-tone={tone(code)}>
      <i aria-hidden="true" />
      <span>{label}</span>
      <code>{code}</code>
    </span>
  );
}

export function securityLabel(copy: DataCopy, level: SecurityLevel): string {
  return copy.status.security[level];
}

export function publicationLabel(
  copy: DataCopy,
  status: PublicationStatus,
): string {
  return copy.status.publication[status];
}

export function FieldGrid({
  fields,
}: {
  readonly fields: readonly {
    readonly label: string;
    readonly value: ReactNode;
  }[];
}) {
  return (
    <dl className={styles.fieldGrid}>
      {fields.map((field) => (
        <div key={field.label}>
          <dt>{field.label}</dt>
          <dd>{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionHeading({
  eyebrow,
  lede,
  title,
}: {
  readonly eyebrow?: string;
  readonly lede?: string;
  readonly title: string;
}) {
  return (
    <header className={styles.sectionHeading}>
      <div>
        {eyebrow === undefined ? null : (
          <p className={styles.eyebrow}>{eyebrow}</p>
        )}
        <h2>{title}</h2>
      </div>
      {lede === undefined ? null : <p>{lede}</p>}
    </header>
  );
}

export function DataItemList({
  items,
  locale,
}: {
  readonly items: readonly DataCatalogItemDto[];
  readonly locale: Locale;
}) {
  const copy = getDictionary(locale).dataFoundation;
  if (items.length === 0) {
    return (
      <DataEmpty title={copy.catalogPage.tableLabel} copy={copy.common.empty} />
    );
  }
  return (
    <div className={styles.dataList} aria-label={copy.catalogPage.tableLabel}>
      {items.map((item) => (
        <article
          className={styles.dataRow}
          key={item.dataItemId}
          data-testid="data-item-row"
        >
          <header>
            <div>
              <p className={styles.rowKicker}>
                {item.businessDomains.join(' · ')}
              </p>
              <h3>{item.name}</h3>
            </div>
            <Link
              className={styles.textAction}
              href={`/${locale}/data-foundation/catalog/${item.dataItemId}`}
            >
              {copy.common.inspect}
            </Link>
          </header>
          <div className={styles.badgeRow}>
            <StatusBadge
              code={item.securityLevel}
              label={copy.status.security[item.securityLevel]}
            />
            <StatusBadge
              code={item.qualityGrade}
              label={`${copy.common.quality} ${item.qualityGrade}`}
            />
            <StatusBadge
              code={item.acceptanceStatus}
              label={copy.status.acceptance[item.acceptanceStatus]}
            />
            <StatusBadge
              code={item.publicationStatus}
              label={copy.status.publication[item.publicationStatus]}
            />
          </div>
          <dl className={styles.rowFacts}>
            <div>
              <dt>{copy.common.source}</dt>
              <dd>{item.sourceOrganization}</dd>
            </div>
            <div>
              <dt>{copy.common.authorization}</dt>
              <dd>
                <ProtocolValue>{item.authorizationScope}</ProtocolValue>
              </dd>
            </div>
            <div>
              <dt>{copy.common.processing}</dt>
              <dd>{copy.status.processing[item.processingStage]}</dd>
            </div>
            <div>
              <dt>{copy.common.version}</dt>
              <dd>
                <ProtocolValue>v{item.version}</ProtocolValue>
              </dd>
            </div>
            <div>
              <dt>{copy.common.updatedAt}</dt>
              <dd>{formatDataDate(item.updatedAt, locale)}</dd>
            </div>
          </dl>
          <footer>
            <ProtocolValue>{item.dataItemId}</ProtocolValue>
          </footer>
        </article>
      ))}
    </div>
  );
}

export function VersionList({
  locale,
  versions,
}: {
  readonly locale: Locale;
  readonly versions: readonly DataItemVersionDto[];
}) {
  const copy = getDictionary(locale).dataFoundation;
  if (versions.length === 0) {
    return (
      <DataEmpty
        title={copy.itemPage.versionsTitle}
        copy={copy.itemPage.noVersions}
      />
    );
  }
  return (
    <ol className={styles.versionList}>
      {versions.map((version) => (
        <li key={version.versionId}>
          <div className={styles.versionIndex}>v{version.version}</div>
          <div>
            <ProtocolValue>{version.versionId}</ProtocolValue>
            <div className={styles.badgeRow}>
              <StatusBadge
                code={version.securityLevel}
                label={copy.status.security[version.securityLevel]}
              />
              <StatusBadge
                code={version.acceptanceStatus}
                label={copy.status.acceptance[version.acceptanceStatus]}
              />
              <StatusBadge
                code={version.publicationStatus}
                label={copy.status.publication[version.publicationStatus]}
              />
            </div>
          </div>
          <dl>
            <div>
              <dt>{copy.common.createdAt}</dt>
              <dd>{formatDataDate(version.createdAt, locale)}</dd>
            </div>
            <div>
              <dt>{copy.common.assetIds}</dt>
              <dd>{version.assetIds.length}</dd>
            </div>
            <div>
              <dt>{copy.common.sourceHash}</dt>
              <dd>
                <ProtocolValue>{version.sourceHash}</ProtocolValue>
              </dd>
            </div>
          </dl>
        </li>
      ))}
    </ol>
  );
}

export function CoverageGap({
  copy,
  title,
}: {
  readonly copy: string;
  readonly title: string;
}) {
  return (
    <article className={styles.coverageGap}>
      <p className={styles.rowKicker}>API</p>
      <h3>{title}</h3>
      <strong>{copy}</strong>
    </article>
  );
}

export function IngestionStateRail({
  locale,
  state,
}: {
  readonly locale: Locale;
  readonly state: IngestionState;
}) {
  const copy = getDictionary(locale).dataFoundation;
  return (
    <ol className={styles.stateRail}>
      {INGESTION_STAGES.map((stage) => {
        const stepState = ingestionStepState(state, stage);
        return (
          <li key={stage} data-step-state={stepState}>
            <i aria-hidden="true" />
            <span>{copy.status.ingestion[stage]}</span>
            <code>{stage}</code>
          </li>
        );
      })}
    </ol>
  );
}

export function IngestionRuntimeSummaries({
  ingestion,
  locale,
}: {
  readonly ingestion: IngestionDto;
  readonly locale: Locale;
}) {
  const copy = getDictionary(locale).dataFoundation;
  const qualityIssues = ingestion.qualityIssues ?? [];
  const agentRuns = ingestion.agentRuns ?? [];
  const projectionStatuses = ingestion.projectionStatuses ?? [];
  return (
    <div className={styles.runtimeSummaryGrid}>
      <article className={styles.runtimePanel}>
        <header>
          <h3>{copy.ingestionPage.issuesTitle}</h3>
          <ProtocolValue>{qualityIssues.length}</ProtocolValue>
        </header>
        {qualityIssues.length === 0 ? (
          <DataEmpty
            title={copy.ingestionPage.issuesTitle}
            copy={copy.ingestionPage.emptyIssues}
          />
        ) : (
          <ol className={styles.runtimeSummaryList}>
            {qualityIssues.map((issue) => (
              <li key={issue.issueId}>
                <div className={styles.badgeRow}>
                  <StatusBadge code={issue.severity} label={issue.severity} />
                  <StatusBadge code={issue.status} label={issue.status} />
                </div>
                <p>{issue.message}</p>
                <dl className={styles.compactFacts}>
                  <div>
                    <dt>{copy.ingestionPage.fieldPath}</dt>
                    <dd>{issue.fieldPath ?? copy.common.notProvided}</dd>
                  </div>
                  <div>
                    <dt>{copy.common.createdAt}</dt>
                    <dd>{formatDataDate(issue.createdAt, locale)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ol>
        )}
      </article>

      <article className={styles.runtimePanel}>
        <header>
          <h3>{copy.ingestionPage.agentRunsTitle}</h3>
          <ProtocolValue>{agentRuns.length}</ProtocolValue>
        </header>
        {agentRuns.length === 0 ? (
          <DataEmpty
            title={copy.ingestionPage.agentRunsTitle}
            copy={copy.ingestionPage.emptyAgentRuns}
          />
        ) : (
          <ol className={styles.runtimeSummaryList}>
            {agentRuns.map((run) => (
              <li key={run.agentRunId}>
                <div className={styles.runtimeRecordHeader}>
                  <strong>{run.agentKind}</strong>
                  <StatusBadge code={run.status} label={run.status} />
                </div>
                <p>
                  {run.provider} · {run.model}
                </p>
                <dl className={styles.compactFacts}>
                  <div>
                    <dt>{copy.ingestionPage.deterministic}</dt>
                    <dd>
                      {run.deterministic
                        ? copy.ingestionPage.yes
                        : copy.ingestionPage.no}
                    </dd>
                  </div>
                  <div>
                    <dt>{copy.ingestionPage.inputHash}</dt>
                    <dd>
                      <ProtocolValue>{run.inputHash}</ProtocolValue>
                    </dd>
                  </div>
                  {run.outputHash === undefined ? null : (
                    <div>
                      <dt>{copy.ingestionPage.outputHash}</dt>
                      <dd>
                        <ProtocolValue>{run.outputHash}</ProtocolValue>
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>{copy.common.updatedAt}</dt>
                    <dd>{formatDataDate(run.updatedAt, locale)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ol>
        )}
      </article>

      <article className={styles.runtimePanel}>
        <header>
          <h3>{copy.ingestionPage.projectionTitle}</h3>
          <ProtocolValue>{projectionStatuses.length}</ProtocolValue>
        </header>
        {projectionStatuses.length === 0 ? (
          <DataEmpty
            title={copy.ingestionPage.projectionTitle}
            copy={copy.ingestionPage.emptyProjections}
          />
        ) : (
          <ol className={styles.runtimeSummaryList}>
            {projectionStatuses.map((projection) => (
              <li key={`${projection.versionId}:${projection.projectionKind}`}>
                <div className={styles.runtimeRecordHeader}>
                  <strong>{projection.projectionKind}</strong>
                  <StatusBadge
                    code={projection.status}
                    label={projection.status}
                  />
                </div>
                <ProtocolValue>{projection.dataItemId}</ProtocolValue>
                <dl className={styles.compactFacts}>
                  <div>
                    <dt>{copy.common.versionId}</dt>
                    <dd>
                      <ProtocolValue>{projection.versionId}</ProtocolValue>
                    </dd>
                  </div>
                  <div>
                    <dt>{copy.ingestionPage.attemptCount}</dt>
                    <dd>{projection.attemptCount}</dd>
                  </div>
                  <div>
                    <dt>{copy.ingestionPage.projectedAt}</dt>
                    <dd>
                      {projection.projectedAt === undefined
                        ? copy.common.notProvided
                        : formatDataDate(projection.projectedAt, locale)}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ol>
        )}
      </article>
    </div>
  );
}

export function OperationEventList({
  events,
  locale,
}: {
  readonly events: readonly OperationEventDto[];
  readonly locale: Locale;
}) {
  const copy = getDictionary(locale).dataFoundation;
  if (events.length === 0) {
    return (
      <DataEmpty
        title={copy.operationPage.eventsTitle}
        copy={copy.operationPage.noEvents}
      />
    );
  }
  return (
    <ol className={styles.eventList}>
      {events.map((event) => (
        <li key={event.eventId}>
          <div className={styles.eventSequence}>{event.sequence}</div>
          <div>
            <div className={styles.badgeRow}>
              <StatusBadge
                code={event.eventType}
                label={copy.status.events[event.eventType]}
              />
            </div>
            {event.message === undefined ? null : <p>{event.message}</p>}
            <time dateTime={event.occurredAt}>
              {formatDataDate(event.occurredAt, locale)}
            </time>
          </div>
          <ProtocolValue>{event.eventId}</ProtocolValue>
        </li>
      ))}
    </ol>
  );
}

export function SearchResultList({
  items,
  locale,
  title,
}: {
  readonly items: readonly SearchResultDto[];
  readonly locale: Locale;
  readonly title: string;
}) {
  const copy = getDictionary(locale).dataFoundation;
  if (items.length === 0)
    return <DataEmpty title={title} copy={copy.common.empty} />;
  return (
    <div className={styles.searchResults}>
      {items.map((result) => (
        <article key={`${result.evidenceId}:${result.versionId}`}>
          <header>
            <ProtocolValue>{result.source}</ProtocolValue>
            <span className={styles.score}>{result.score.toFixed(3)}</span>
          </header>
          {result.excerpt === undefined ? (
            <p>{copy.common.notProvided}</p>
          ) : (
            <p>{result.excerpt}</p>
          )}
          <div className={styles.badgeRow}>
            <StatusBadge
              code={result.securityLevel}
              label={copy.status.security[result.securityLevel]}
            />
            <StatusBadge
              code={result.acceptanceStatus}
              label={copy.status.acceptance[result.acceptanceStatus]}
            />
          </div>
          <dl className={styles.compactFacts}>
            <div>
              <dt>{copy.common.dataItemId}</dt>
              <dd>
                <ProtocolValue>{result.dataItemId}</ProtocolValue>
              </dd>
            </div>
            <div>
              <dt>{copy.common.versionId}</dt>
              <dd>
                <ProtocolValue>{result.versionId}</ProtocolValue>
              </dd>
            </div>
            <div>
              <dt>{copy.common.evidenceId}</dt>
              <dd>
                <ProtocolValue>{result.evidenceId}</ProtocolValue>
              </dd>
            </div>
          </dl>
          {result.limitations.length === 0 ? null : (
            <div className={styles.limitations}>
              <strong>{copy.common.limitations}</strong>
              <ul>
                {result.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

export function GraphResultView({
  locale,
  result,
}: {
  readonly locale: Locale;
  readonly result: GraphResultDto;
}) {
  const copy = getDictionary(locale).dataFoundation;
  return (
    <div className={styles.graphGrid}>
      <section>
        <SectionHeading title={copy.graphPage.nodesTitle} />
        {result.nodes.length === 0 ? (
          <DataEmpty
            title={copy.graphPage.nodesTitle}
            copy={copy.common.empty}
          />
        ) : (
          <ul className={styles.nodeList}>
            {result.nodes.map((node) => (
              <li key={node.entityId}>
                <strong>{node.label}</strong>
                <ProtocolValue>{node.entityId}</ProtocolValue>
                <span>
                  {copy.common.confidence}: {node.confidence.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <SectionHeading title={copy.graphPage.edgesTitle} />
        {result.edges.length === 0 ? (
          <DataEmpty
            title={copy.graphPage.edgesTitle}
            copy={copy.common.empty}
          />
        ) : (
          <ol className={styles.edgeList}>
            {result.edges.map((edge) => (
              <li key={edge.edgeId}>
                <strong>{edge.relationType}</strong>
                <span>
                  {copy.graphPage.from}:{' '}
                  <ProtocolValue>{edge.fromEntityId}</ProtocolValue>
                </span>
                <span>
                  {copy.graphPage.to}:{' '}
                  <ProtocolValue>{edge.toEntityId}</ProtocolValue>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

export function GeoFeatureList({
  features,
  locale,
}: {
  readonly features: readonly GeoFeatureDto[];
  readonly locale: Locale;
}) {
  const copy = getDictionary(locale).dataFoundation;
  if (features.length === 0) {
    return (
      <DataEmpty title={copy.geoPage.resultsTitle} copy={copy.common.empty} />
    );
  }
  return (
    <div className={styles.geoList}>
      {features.map((feature) => (
        <article key={feature.featureId}>
          <strong>{feature.geometry.type}</strong>
          <ProtocolValue>{feature.featureId}</ProtocolValue>
          <dl className={styles.compactFacts}>
            <div>
              <dt>{copy.common.dataItemId}</dt>
              <dd>
                <ProtocolValue>{feature.dataItemId}</ProtocolValue>
              </dd>
            </div>
            <div>
              <dt>{copy.common.versionId}</dt>
              <dd>
                <ProtocolValue>{feature.versionId}</ProtocolValue>
              </dd>
            </div>
            <div>
              <dt>{copy.common.coordinates}</dt>
              <dd>
                <ProtocolValue>{feature.geometry.crs}</ProtocolValue>
              </dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
}

export function CapabilityList({
  locale,
  registry,
}: {
  readonly locale: Locale;
  readonly registry: CapabilityRegistryDto;
}) {
  const copy = getDictionary(locale).dataFoundation;
  return (
    <div className={styles.capabilityList}>
      {registry.capabilities.map((capability) => (
        <article key={capability.id}>
          <header>
            <div>
              <ProtocolValue>{capability.id}</ProtocolValue>
              <h3>{capability.kind}</h3>
            </div>
            <ProtocolValue>v{capability.version}</ProtocolValue>
          </header>
          <FieldGrid
            fields={[
              {
                label: copy.capabilitiesPage.execution,
                value: capability.executionMode,
              },
              {
                label: copy.capabilitiesPage.timeout,
                value: `${capability.timeout} ms`,
              },
              {
                label: copy.capabilitiesPage.idempotent,
                value: capability.idempotent
                  ? copy.capabilitiesPage.yes
                  : copy.capabilitiesPage.no,
              },
              {
                label: copy.capabilitiesPage.endpoint,
                value: (
                  <ProtocolValue>
                    {capability.restMethod} {capability.restPath}
                  </ProtocolValue>
                ),
              },
              {
                label: copy.capabilitiesPage.scopes,
                value: capability.requiredScopes.join(' · '),
              },
            ]}
          />
        </article>
      ))}
    </div>
  );
}

export function WorkspaceLinks({
  links,
}: {
  readonly links: readonly {
    readonly href: string;
    readonly label: string;
    readonly detail: string;
  }[];
}) {
  return (
    <div className={styles.workspaceLinks}>
      {links.map((link) => (
        <Link href={link.href} key={link.href}>
          <strong>{link.label}</strong>
          <span>{link.detail}</span>
          <i aria-hidden="true">→</i>
        </Link>
      ))}
    </div>
  );
}
