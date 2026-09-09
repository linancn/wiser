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
  SecurityLevel,
} from '@/lib/data-foundation';
import { ingestionStepState } from '@/lib/data-foundation';
import {
  isRegistrationExcerpt,
  SOURCE_REGISTRATION_LIMITATION,
  namedCapability,
  sourceLimitationLabel,
  type DisplaySearchResult,
} from '@/lib/data-foundation-presentation';
import type { DataFoundationApiError } from '@/lib/data-foundation-dal.server';
import { getDictionary, type Locale } from '@/lib/i18n';

import styles from './data-foundation-workspace.module.css';
import { FailureState } from './failure-state';
import { DataFoundationGraph } from './data-foundation-graph';

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

export function DataDisclosure({
  title,
  children,
  open = false,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly open?: boolean;
}) {
  return (
    <details className={styles.disclosure} open={open}>
      <summary>{title}</summary>
      <div>{children}</div>
    </details>
  );
}

export function ExplorationEntry({
  locale,
  view,
}: {
  readonly locale: Locale;
  readonly view: 'map' | 'graph';
}) {
  const copy = getDictionary(locale).dataFoundation.presentation;
  return (
    <div className={styles.explorationEntry}>
      <p>{copy.exploreGuide}</p>
      <Link href={`/${locale}/data-foundation/explore?view=${view}`}>
        {view === 'map' ? copy.openMap : copy.openGraph}
        <span aria-hidden="true"> →</span>
      </Link>
    </div>
  );
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
        {eyebrow.toLowerCase() === title.toLowerCase() ? null : (
          <p className={styles.eyebrow}>{eyebrow}</p>
        )}
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
  const primaryAction = (() => {
    switch (error.kind) {
      case 'authentication':
        return {
          href: `/${locale}/login?next=/${locale}/data-foundation`,
          label: failure.action,
        };
      case 'invalid-request':
      case 'not-found':
        return {
          href: `/${locale}/data-foundation/catalog`,
          label: failure.action,
        };
      default:
        return {
          href: `/${locale}`,
          label: copy.common.returnPortal,
        };
    }
  })();
  return (
    <FailureState
      headingLevel={2}
      eyebrow={copy.title}
      title={failure.title}
      copy={failure.copy}
      guidance={failure.action}
      primaryAction={primaryAction}
    />
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
  hrefBase,
  locale,
  selectedVersionId,
  versions,
}: {
  readonly hrefBase?: string;
  readonly locale: Locale;
  readonly selectedVersionId?: string;
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
        <li
          key={version.versionId}
          data-selected={
            version.versionId === selectedVersionId ? 'true' : undefined
          }
        >
          {hrefBase === undefined ? (
            <div className={styles.versionIndex}>v{version.version}</div>
          ) : (
            <Link
              className={styles.versionIndex}
              href={`${hrefBase}?version=${encodeURIComponent(version.versionId)}`}
              aria-current={
                version.versionId === selectedVersionId ? 'page' : undefined
              }
              aria-label={copy.itemPage.selectVersion.replace(
                '{version}',
                String(version.version),
              )}
            >
              v{version.version}
            </Link>
          )}
          <div>
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
              <dt>{copy.presentation.technical}</dt>
              <dd>
                <DataDisclosure title={copy.presentation.evidenceDetails}>
                  <p>
                    {copy.common.versionId}:{' '}
                    <ProtocolValue>{version.versionId}</ProtocolValue>
                  </p>
                  <p>
                    {copy.common.sourceHash}:{' '}
                    <ProtocolValue>{version.sourceHash}</ProtocolValue>
                  </p>
                </DataDisclosure>
              </dd>
            </div>
          </dl>
        </li>
      ))}
    </ol>
  );
}

export function MapQueryForm({
  action,
  bbox,
  bboxHint,
  bboxLabel,
  bboxPlaceholder,
  crs,
  crsLabel,
  dataItem,
  resetLabel,
  submitLabel,
  version,
  versionLabel,
  versionPlaceholder,
}: {
  readonly action: string;
  readonly bbox: string;
  readonly bboxHint: string;
  readonly bboxLabel: string;
  readonly bboxPlaceholder: string;
  readonly crs: 'EPSG:4326' | 'EPSG:4490';
  readonly crsLabel: string;
  readonly dataItem: string;
  readonly resetLabel: string;
  readonly submitLabel: string;
  readonly version: string;
  readonly versionLabel: string;
  readonly versionPlaceholder: string;
}) {
  return (
    <form
      className={`${styles.queryForm} ${styles.mapQueryForm}`}
      action={action}
    >
      <input type="hidden" name="dataItem" value={dataItem} />
      <div className={styles.mapQueryFields}>
        <label>
          <span>{bboxLabel}</span>
          <input
            name="bbox"
            defaultValue={bbox}
            placeholder={bboxPlaceholder}
            autoComplete="off"
            inputMode="decimal"
          />
        </label>
        <label>
          <span>{versionLabel}</span>
          <input
            name="version"
            defaultValue={version}
            placeholder={versionPlaceholder}
            autoComplete="off"
          />
        </label>
        <label>
          <span>{crsLabel}</span>
          <select name="crs" defaultValue={crs}>
            <option value="EPSG:4326">EPSG:4326 · WGS 84</option>
            <option value="EPSG:4490">EPSG:4490 · CGCS2000</option>
          </select>
        </label>
      </div>
      <small>{bboxHint}</small>
      <div className={styles.mapQueryActions}>
        <button type="submit">{submitLabel}</button>
        <Link href={action}>{resetLabel}</Link>
      </div>
    </form>
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
                  <StatusBadge
                    code={issue.severity}
                    label={namedCapability(
                      issue.severity,
                      copy.presentation.runtimeStatus,
                      copy.presentation.unknownStatus,
                    )}
                  />
                  <StatusBadge
                    code={issue.status}
                    label={namedCapability(
                      issue.status,
                      copy.presentation.runtimeStatus,
                      copy.presentation.unknownStatus,
                    )}
                  />
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
                  <strong>{copy.presentation.agentUnknown}</strong>
                  <StatusBadge
                    code={run.status}
                    label={namedCapability(
                      run.status,
                      copy.presentation.runtimeStatus,
                      copy.presentation.unknownStatus,
                    )}
                  />
                </div>
                <DataDisclosure title={copy.presentation.processingDetails}>
                  <p>
                    <ProtocolValue>
                      {run.agentKind} · {run.provider} · {run.model}
                    </ProtocolValue>
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
                </DataDisclosure>
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
                  <strong>
                    {namedCapability(
                      projection.projectionKind.toUpperCase(),
                      copy.presentation.projectionNames,
                      copy.presentation.projectionUnknown,
                    )}
                  </strong>
                  <StatusBadge
                    code={projection.status}
                    label={namedCapability(
                      projection.status,
                      copy.presentation.runtimeStatus,
                      copy.presentation.unknownStatus,
                    )}
                  />
                </div>
                <Link
                  href={`/${locale}/data-foundation/catalog/${projection.dataItemId}?version=${projection.versionId}`}
                >
                  {copy.common.inspect}
                </Link>
                <DataDisclosure title={copy.presentation.technical}>
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
                </DataDisclosure>
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
            <time dateTime={event.occurredAt}>
              {formatDataDate(event.occurredAt, locale)}
            </time>
          </div>
          <span>{event.progressPercent}%</span>
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
  readonly items: readonly DisplaySearchResult[];
  readonly locale: Locale;
  readonly title: string;
}) {
  const copy = getDictionary(locale).dataFoundation;
  const labels = copy.presentation;
  if (items.length === 0)
    return <DataEmpty title={title} copy={copy.common.empty} />;
  return (
    <div
      className={styles.searchResults}
      tabIndex={0}
      role="region"
      aria-label={title}
    >
      {items.map((result) => {
        const registration =
          isRegistrationExcerpt(result.excerpt) ||
          result.limitations.includes(SOURCE_REGISTRATION_LIMITATION);
        const excerpt = result.excerpt?.trim();
        const preview = registration
          ? labels.registrationPreview
          : excerpt
            ? [...excerpt].slice(0, 320).join('') +
              ([...excerpt].length > 320 ? '…' : '')
            : labels.noExcerpt;
        return (
          <article key={`${result.evidenceId}:${result.versionId}`}>
            <header>
              <h3>
                <Link
                  href={`/${locale}/data-foundation/catalog/${result.dataItemId}?version=${result.versionId}`}
                >
                  {result.resourceName ?? labels.searchFallback}
                </Link>
              </h3>
              <StatusBadge
                code={result.securityLevel}
                label={copy.status.security[result.securityLevel]}
              />
            </header>
            {registration ? (
              <span className={styles.resultKind}>{labels.registration}</span>
            ) : null}
            <p>{preview}</p>
            <DataDisclosure
              title={`${labels.sourceDetails} · ${result.limitations.length}`}
            >
              <div className={styles.badgeRow}>
                <StatusBadge
                  code={result.acceptanceStatus}
                  label={copy.status.acceptance[result.acceptanceStatus]}
                />
              </div>
              {result.limitations.length === 0 ? (
                <p>{copy.common.notProvided}</p>
              ) : (
                <ul>
                  {result.limitations.map((limitation) => (
                    <li key={limitation}>
                      {sourceLimitationLabel(limitation, labels)}
                    </li>
                  ))}
                </ul>
              )}
            </DataDisclosure>
            {excerpt && (registration || [...excerpt].length > 320) ? (
              <DataDisclosure title={labels.originalExcerpt}>
                <p className={styles.originalExcerpt} tabIndex={0}>
                  {excerpt}
                </p>
              </DataDisclosure>
            ) : null}
            <DataDisclosure title={labels.evidenceDetails}>
              <FieldGrid
                fields={[
                  {
                    label: copy.common.dataItemId,
                    value: <ProtocolValue>{result.dataItemId}</ProtocolValue>,
                  },
                  {
                    label: copy.common.versionId,
                    value: <ProtocolValue>{result.versionId}</ProtocolValue>,
                  },
                  {
                    label: copy.common.evidenceId,
                    value: <ProtocolValue>{result.evidenceId}</ProtocolValue>,
                  },
                  {
                    label: labels.retrievalSource,
                    value: <ProtocolValue>{result.source}</ProtocolValue>,
                  },
                  { label: labels.ranking, value: result.score.toFixed(3) },
                ]}
              />
            </DataDisclosure>
          </article>
        );
      })}
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
  return <DataFoundationGraph locale={locale} result={result} />;
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
          <header>
            <strong>
              {copy.presentation.geometryNames[feature.geometry.type]}
            </strong>
          </header>
          <p>
            {copy.common.coordinates}:{' '}
            <ProtocolValue>{feature.geometry.crs}</ProtocolValue>
          </p>
          <Link
            href={`/${locale}/data-foundation/catalog/${feature.dataItemId}?version=${feature.versionId}`}
          >
            {copy.presentation.searchFallback}
          </Link>
          <DataDisclosure title={copy.presentation.technical}>
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
          </DataDisclosure>
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
  const labels = copy.presentation;
  return (
    <div className={styles.capabilityList}>
      {registry.capabilities.map((capability) => (
        <article key={capability.id}>
          <header>
            <h3>
              {namedCapability(
                capability.id,
                labels.capabilityNames,
                labels.capabilityFallback,
              )}
            </h3>
            <span className={styles.resultKind}>
              {capability.kind === 'query'
                ? labels.queryKind
                : labels.commandKind}
            </span>
          </header>
          <DataDisclosure title={labels.technical}>
            <p>
              <ProtocolValue>
                {capability.id} · v{capability.version}
              </ProtocolValue>
            </p>
            <FieldGrid
              fields={[
                {
                  label: copy.capabilitiesPage.execution,
                  value:
                    capability.executionMode === 'SYNCHRONOUS'
                      ? labels.sync
                      : labels.async,
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
                  value: (
                    <ProtocolValue>
                      {capability.requiredScopes.join(' · ')}
                    </ProtocolValue>
                  ),
                },
              ]}
            />
          </DataDisclosure>
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
