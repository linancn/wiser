'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  RelationListOutputSchema,
  type RelationAssertion,
  type BusinessQuery,
} from '@wiser/data-contracts';
import { getDictionary, type Locale } from '@/lib/i18n';
import {
  businessPeriod,
  readBusinessPeriodUnit,
  writeBusinessPeriodUnit,
  type BusinessPeriodUnit,
} from '@/lib/business-period';
import { businessGraphRows, businessRecordFocus } from '@/lib/business-graph';
import { relationNodeIdentity } from '@/lib/relation-graph';
import {
  readGraphLayoutSettings,
  writeGraphLayoutSettings,
  type GraphLayoutSettings,
} from '@/lib/graph-layout-settings';
import { readBusinessReading, readingPage } from '@/lib/business-reading';
import { withBusinessFocus } from '@/lib/exploration-business-focus';
import { businessObjectSources } from '@/lib/business-object-sources';
import { withRecordFocus } from '@/lib/exploration-record-focus';
import { explorationHref } from '@/lib/exploration-navigation';
import {
  invalidatesExploration,
  type InvalidateExploration,
} from '@/lib/exploration-request';
import { businessScene } from '@/lib/business-scene';
import {
  readSceneView,
  writeSceneView,
  type SceneView,
} from '@/lib/business-scene-view';
import { BusinessSceneCanvas } from './business-scene-canvas';
import { BusinessSceneEvidence } from './business-scene-evidence';
import { KnowledgeGraphCanvas } from './data-foundation-graph';
import { BusinessEvidencePathPanel } from './business-evidence-path';
import { useExplorationViewState } from './exploration-view-context';
import styles from './data-reconciliation.module.css';
import businessStyles from './data-explorer-business.module.css';

export function DataExplorerBusiness({
  queryId,
  scope,
  locale,
  onInvalidated,
  onApply,
}: {
  readonly queryId: string;
  readonly scope: BusinessQuery;
  readonly locale: Locale;
  readonly onInvalidated: InvalidateExploration;
  readonly onApply: (
    scope: BusinessQuery,
    periodUnit: BusinessPeriodUnit,
  ) => void;
}) {
  const copy = getDictionary(locale).knowledgeRelations;
  const search = useSearchParams(),
    pathname = usePathname();
  type Kind = RelationAssertion['candidate']['subject']['kind'];
  const readKind = search.get('businessKind');
  const kind: Kind | null =
    readKind && Object.hasOwn(copy.kinds, readKind) ? (readKind as Kind) : null;
  const [rows, setRows] = useState<RelationAssertion[]>([]),
    [busy, setBusy] = useState(true),
    [failed, setFailed] = useState(false),
    [loaded, setLoaded] = useState(0);
  const mode = search.get('businessMode') === 'all' ? 'all' : 'overview';
  const reading = readBusinessReading(search);
  const presentation = reading.presentation;
  const layoutSettings = readGraphLayoutSettings(search);
  const selected = search.get('businessEntity');
  const selectedEdge = search.get('businessEdge');
  const scene = useMemo(() => businessScene(rows), [rows]);
  const sceneSettings = readSceneView(search);
  const changeScene = (value: SceneView) => {
    const params = new URLSearchParams(window.location.search);
    writeSceneView(params, value);
    window.history.replaceState(null, '', pathname + '?' + params.toString());
  };
  const selectEdge = (id: string | null) => {
    const params = new URLSearchParams(window.location.search);
    params.delete('businessEdge');
    params.delete('businessKind');
    params.delete('businessEntity');
    params.delete('businessPage');
    if (id) params.set('businessEdge', id);
    window.history.replaceState(null, '', pathname + '?' + params.toString());
  };
  const edgeRow = rows.find((r) => r.assertionId === selectedEdge);
  const [draft, setDraft] = useState(scope.filters);
  const urlPeriodUnit = readBusinessPeriodUnit(search);
  const [periodUnit, setPeriodUnit] =
    useState<BusinessPeriodUnit>(urlPeriodUnit);
  useEffect(() => setPeriodUnit(urlPeriodUnit), [urlPeriodUnit]);
  useEffect(() => {
    setDraft(scope.filters);
  }, [scope.filters]);
  const viewState = useExplorationViewState();
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setFailed(false);
    setLoaded(0);
    setRows([]);
    viewState?.report('graph', null);
    void (async () => {
      try {
        let after: string | undefined, total: number | undefined;
        const items: RelationAssertion[] = [];
        const cursors = new Set<string>();
        do {
          const response = await fetch('/api/data-foundation/relations/list', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              queryId,
              status: scope.status,
              first: 100,
              ...(after ? { after } : {}),
            }),
            cache: 'no-store',
            signal: controller.signal,
          });
          if (!response.ok) {
            if (invalidatesExploration(response.status))
              onInvalidated(queryId, response.status);
            throw Error('Unavailable');
          }
          const page = RelationListOutputSchema.parse(await response.json());
          if (total !== undefined && total !== page.totalCount)
            throw Error('Changed scope');
          total = page.totalCount;
          items.push(...page.items);
          after = page.nextCursor;
          if (after && cursors.has(after)) throw Error('Repeated cursor');
          if (after) cursors.add(after);
          if (items.length > 2000) throw Error('Scope too large');
          if (!controller.signal.aborted) setLoaded(items.length);
        } while (after);
        if (
          items.length !== total ||
          new Set(items.map((r) => r.assertionId)).size !== items.length
        )
          throw Error('Incomplete scope');
        if (!controller.signal.aborted) {
          setRows(items);
          viewState?.report('graph', { queryId, view: 'graph', first: 25 });
        }
      } catch {
        if (!controller.signal.aborted) {
          setRows([]);
          setFailed(true);
        }
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    })();
    return () => controller.abort();
  }, [queryId, scope.status, onInvalidated, viewState]);
  const visible = useMemo(
    () =>
      edgeRow
        ? [edgeRow]
        : businessGraphRows(
            rows,
            presentation === 'network' ? 'all' : mode,
            selected,
            kind,
          ),
    [rows, mode, selected, kind, presentation, edgeRow],
  );
  const readingRows = useMemo(() => {
    const groups = new Map<string, RelationAssertion[]>();
    for (const row of visible) {
      const key = relationNodeIdentity(row, row.candidate.subject);
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    return [...groups.values()].flat();
  }, [visible]);
  const page = useMemo(
    () => readingPage(readingRows, reading.page),
    [readingRows, reading.page],
  );
  const sources = useMemo(() => businessObjectSources(rows), [rows]);
  const selectedSource = selected ? sources.get(selected) : undefined;
  const graphRows = presentation === 'network' ? rows : visible;
  const graph = useMemo(() => {
    const degree = new Map<string, number>();
    for (const r of graphRows)
      for (const e of [r.candidate.subject, r.candidate.object]) {
        const id = relationNodeIdentity(r, e);
        degree.set(id, (degree.get(id) ?? 0) + 1);
      }
    const representatives = new Map<string, string>();
    for (const r of graphRows)
      for (const e of [r.candidate.subject, r.candidate.object]) {
        const id = relationNodeIdentity(r, e),
          prior = representatives.get(e.kind);
        if (!prior || (degree.get(id) ?? 0) > (degree.get(prior) ?? 0))
          representatives.set(e.kind, id);
      }
    const anchors = new Set(representatives.values());
    return {
      nodes: [
        ...new Map(
          graphRows.flatMap((r) =>
            [r.candidate.subject, r.candidate.object].map((e) => {
              const id = relationNodeIdentity(r, e);
              return [
                id,
                {
                  entityId: id,
                  label: copy.kinds[e.kind] + ' · ' + e.label,
                  kind: e.kind,
                  source: sources.get(id)
                    ? `${sources.get(id)!.dataItemId}:${sources.get(id)!.versionId}`
                    : undefined,
                  overviewLabel: anchors.has(id),
                },
              ] as const;
            }),
          ),
        ).values(),
      ],
      edges: graphRows.map((r) => ({
        edgeId: r.assertionId,
        fromEntityId: relationNodeIdentity(r, r.candidate.subject),
        toEntityId: relationNodeIdentity(r, r.candidate.object),
        label: copy.predicates[r.candidate.predicate],
      })),
    };
  }, [graphRows, copy, sources]);
  const pageGraph = useMemo(() => {
    const ids = new Set(page.rows.map((r) => r.assertionId));
    const edges = graph.edges.filter((e) => ids.has(e.edgeId));
    const endpoints = new Set(
      edges.flatMap((e) => [e.fromEntityId, e.toEntityId]),
    );
    return {
      nodes: graph.nodes.filter((n) => endpoints.has(n.entityId)),
      edges,
    };
  }, [graph, page.rows]);
  const navigateReading = (
    nextPage: number,
    nextPresentation = presentation,
  ) => {
    const params = new URLSearchParams(window.location.search);
    params.delete('businessPage');
    params.delete('businessPresentation');
    if (nextPresentation === 'reading')
      params.set('businessPresentation', 'reading');
    if (nextPage > 1) params.set('businessPage', String(nextPage));
    window.history.replaceState(null, '', pathname + '?' + params.toString());
  };
  const changeLayout = (settings: GraphLayoutSettings) => {
    const params = new URLSearchParams(window.location.search);
    writeGraphLayoutSettings(params, settings);
    window.history.replaceState(null, '', pathname + '?' + params.toString());
  };
  const recordHref = (view: 'records' | 'map') =>
    withBusinessFocus(
      explorationHref(locale, queryId, view),
      search.toString(),
      { viewId: search.get('saved') ?? '', queryId },
    );
  const pagination = (
    <div className={businessStyles.readingPagination}>
      <button
        disabled={page.page === 1}
        onClick={() => navigateReading(page.page - 1)}
      >
        {copy.businessPreviousGroup}
      </button>
      <span>
        {copy.businessGroupCount
          .replace('{page}', String(page.page))
          .replace('{count}', String(page.count))}
      </span>
      <button
        disabled={page.page === page.count}
        onClick={() => navigateReading(page.page + 1)}
      >
        {copy.businessNextGroup}
      </button>
    </div>
  );
  const kinds = useMemo(
    () =>
      [
        ...new Set(
          rows.flatMap((r) => [
            r.candidate.subject.kind,
            r.candidate.object.kind,
          ]),
        ),
      ].sort(),
    [rows],
  );
  const select = (
    id: string | null,
    nextKind: Kind | null = kind,
    nextMode: 'overview' | 'all' = mode,
  ) => {
    const params = new URLSearchParams(search.toString());
    params.delete('businessPage');
    params.delete('businessEdge');
    if (id) params.set('businessEntity', id);
    else params.delete('businessEntity');
    if (nextKind) params.set('businessKind', nextKind);
    else params.delete('businessKind');
    if (nextMode === 'all') params.set('businessMode', 'all');
    else params.delete('businessMode');
    window.history.replaceState(null, '', pathname + '?' + params.toString());
  };
  return (
    <section
      className={`${styles.frame} ${styles.body} ${businessStyles.compact}`}
      aria-label={copy.businessTitle}
    >
      <header className={businessStyles.heading}>
        <div>
          <h2>{copy.businessTitle}</h2>
          <p>{copy.businessHint}</p>
        </div>
        <p className={businessStyles.authority}>
          {copy.statuses[scope.status]} · {copy.pageCount}
          {loaded}
          {busy ? ' · ' + copy.businessLoading : ''}
        </p>
      </header>
      {scope.status === 'PENDING_REVIEW' ? (
        <p>{copy.recordRelationPending}</p>
      ) : null}
      <details>
        <summary>
          {copy.businessScope} · {scope.filters.from ?? copy.filterAll} —{' '}
          {scope.filters.to ?? copy.filterAll}
        </summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onApply({ ...scope, filters: draft }, periodUnit);
          }}
        >
          <fieldset className={businessStyles.timeFilters}>
            <legend>{copy.businessScope}</legend>
            <label>
              {copy.filterTimeRole}
              <select
                value={draft.timeRole}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    timeRole: e.target.value as typeof draft.timeRole,
                  })
                }
              >
                <option value="ALL">{copy.filterAll}</option>
                {Object.entries(copy.timeRoles).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {copy.filterFrom}
              <input
                type="date"
                value={draft.from ?? ''}
                onChange={(e) =>
                  setDraft({ ...draft, from: e.target.value || null })
                }
              />
            </label>
            <label>
              {copy.filterTo}
              <input
                type="date"
                value={draft.to ?? ''}
                onChange={(e) =>
                  setDraft({ ...draft, to: e.target.value || null })
                }
              />
            </label>
            <label>
              {copy.periodUnit}
              <select
                value={periodUnit}
                onChange={(event) => {
                  const unit = event.target.value as BusinessPeriodUnit;
                  setPeriodUnit(unit);
                  const params = new URLSearchParams(window.location.search);
                  writeBusinessPeriodUnit(params, unit);
                  window.history.replaceState(
                    window.history.state,
                    '',
                    pathname + '?' + params.toString(),
                  );
                }}
              >
                <option value="month">{copy.periodMonth}</option>
                <option value="year">{copy.periodYear}</option>
              </select>
            </label>
            {([-1, 0, 1] as const).map((offset) => {
              const period = businessPeriod(draft.from, periodUnit, offset);
              return (
                <button
                  key={offset}
                  type="button"
                  disabled={busy || !period || draft.timeRole === 'ALL'}
                  onClick={() => period && setDraft({ ...draft, ...period })}
                >
                  {offset === -1
                    ? copy.periodPrevious
                    : offset === 1
                      ? copy.periodNext
                      : copy.periodCurrent}
                </button>
              );
            })}
            <p>{copy.periodHint}</p>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={draft.includeUndated}
                onChange={(e) =>
                  setDraft({ ...draft, includeUndated: e.target.checked })
                }
              />
              {copy.filterUndated}
            </label>
            <button
              type="submit"
              disabled={
                busy || Boolean(draft.from && draft.to && draft.from > draft.to)
              }
            >
              {copy.businessApply}
            </button>
          </fieldset>
        </form>
      </details>
      {failed ? <p role="alert">{copy.recordRelationFailed}</p> : null}
      {!busy && !failed ? (
        <>
          <div className={styles.actions}>
            {presentation === 'reading' ? (
              <>
                <button
                  onClick={() => {
                    select(null, null, 'overview');
                  }}
                  aria-pressed={mode === 'overview' && !selected && !kind}
                >
                  {copy.businessOverview}
                </button>
                <button
                  onClick={() => {
                    select(null, null, 'all');
                  }}
                  aria-pressed={mode === 'all' && !selected && !kind}
                >
                  {copy.businessAll}
                </button>
              </>
            ) : null}
            {selected ? (
              <button onClick={() => select(null)}>
                {copy.businessClearFocus}
              </button>
            ) : null}
          </div>
          <div
            className={businessStyles.categories}
            aria-label={copy.businessCategories}
          >
            {kinds.map((k) => (
              <button
                key={k}
                aria-pressed={kind === k && !selected}
                onClick={() => select(null, k)}
              >
                {copy.kinds[k]}
              </button>
            ))}
          </div>
          {kind && presentation === 'reading' ? (
            <p>{copy.businessCategoryHint}</p>
          ) : null}
          <p>
            {copy.businessVisible}
            {graphRows.length} / {rows.length} ·{' '}
            {presentation === 'network'
              ? copy.businessGlobalHint
              : copy.businessOverviewHint}
          </p>
          {selectedSource ? (
            <section
              aria-label={copy.businessSelectedObject}
              className={businessStyles.selectedObject}
            >
              <strong>
                {copy.businessSelectedObject} ·{' '}
                {graph.nodes.find((n) => n.entityId === selected)?.label}
              </strong>
              <Link
                href={`/${locale}/data-foundation/catalog/${selectedSource.dataItemId}?version=${selectedSource.versionId}`}
              >
                {selectedSource.title ||
                  `${copy.businessObjectSource}${selectedSource.sourceNumber}`}
              </Link>
            </section>
          ) : null}
          <div className={businessStyles.readingToolbar}>
            <div role="group" aria-label={copy.businessPresentation}>
              <button
                aria-pressed={presentation === 'reading'}
                onClick={() => navigateReading(1, 'reading')}
              >
                {copy.businessReading}
              </button>
              <button
                aria-pressed={presentation === 'network'}
                onClick={() => navigateReading(1, 'network')}
              >
                {copy.businessNetwork}
              </button>
            </div>
            {presentation === 'reading' ? pagination : null}
          </div>
          <p className={businessStyles.readingHint}>
            {presentation === 'reading'
              ? copy.businessReadingHint
                  .replace('{count}', String(page.rows.length))
                  .replace('{total}', String(visible.length))
              : copy.businessNetworkHint}
          </p>
          {graphRows.length ? (
            presentation === 'network' ? (
              <BusinessSceneCanvas
                queryId={queryId}
                onInvalidated={onInvalidated}
                scene={scene}
                settings={sceneSettings}
                onSettings={changeScene}
                selectedId={selected}
                selectedEdge={selectedEdge}
                selectedKind={kind}
                onSelect={(id) => select(id, null)}
                onEdge={selectEdge}
                locale={locale}
                evidence={
                  edgeRow ? (
                    <BusinessSceneEvidence
                      row={edgeRow}
                      locale={locale}
                      recordHref={recordHref}
                    />
                  ) : undefined
                }
              />
            ) : (
              <KnowledgeGraphCanvas
                result={pageGraph}
                reading
                layoutSettings={layoutSettings}
                onLayoutSettingsChange={changeLayout}
                locale={locale}
                selectedId={selected}
                onSelect={select}
              />
            )
          ) : (
            <p>{copy.filteredEmpty}</p>
          )}
          <details>
            <summary>
              {copy.businessObjects} ({graph.nodes.length})
            </summary>
            <ul className={businessStyles.objectList}>
              {graph.nodes.map((n) => {
                const source = sources.get(n.entityId)!;
                return (
                  <li key={n.entityId}>
                    <button
                      aria-pressed={selected === n.entityId}
                      onClick={() => select(n.entityId)}
                    >
                      <span>{n.label}</span>{' '}
                      <small>
                        {copy.businessObjectSource}
                        {source.title || source.sourceNumber}
                        {source.objectNumber
                          ? ` · ${copy.businessObjectNumber} ${source.objectNumber}`
                          : ''}
                      </small>
                    </button>
                  </li>
                );
              })}
            </ul>
          </details>
          <h3>{copy.businessEvidence}</h3>
          <BusinessEvidencePathPanel
            rows={rows}
            locale={locale}
            expanded={sceneSettings.view === 'trace'}
          />
          {page.rows.map((row) => (
            <article className={businessStyles.evidence} key={row.assertionId}>
              <button
                aria-pressed={selectedEdge === row.assertionId}
                onClick={() => selectEdge(row.assertionId)}
              >
                {copy.scene.relationSelected}
              </button>
              <h4>
                {row.candidate.subject.label} →{' '}
                {copy.predicates[row.candidate.predicate]} →{' '}
                {row.candidate.object.label}
              </h4>
              <p>
                {row.candidate.qualifiers.context
                  ? copy.natures[row.candidate.qualifiers.context.recordNature]
                  : ''}{' '}
                ·{' '}
                {row.candidate.qualifiers.context?.validFrom ??
                  row.candidate.qualifiers.observedAt ??
                  copy.timeRoles.UNKNOWN}{' '}
                — {row.candidate.qualifiers.context?.validTo ?? ''}
              </p>
              {row.candidate.qualifiers.context ? (
                <p>{row.candidate.qualifiers.context.applicability}</p>
              ) : null}
              {[...new Set(row.candidate.qualifiers.limitations)]
                .filter(
                  (v) => v !== row.candidate.qualifiers.context?.applicability,
                )
                .map((v) => (
                  <p key={v}>{v}</p>
                ))}
              <Link
                href={`/${locale}/data-foundation/catalog/${row.dataItemId}?version=${row.versionId}`}
              >
                {copy.source}
              </Link>
              {[row.candidate.subject, row.candidate.object].map(
                (entity, i) => {
                  const focus = businessRecordFocus(row, entity);
                  return focus ? (
                    <p key={i}>
                      <Link
                        href={withRecordFocus(recordHref('records'), focus)}
                      >
                        {copy.boundRecord}
                      </Link>
                      {' · '}
                      <Link href={withRecordFocus(recordHref('map'), focus)}>
                        {copy.boundRecordMap}
                      </Link>
                    </p>
                  ) : null;
                },
              )}
              <details>
                <summary>
                  {copy.businessOriginalEvidence} (
                  {row.candidate.evidence.length})
                </summary>
                <ul>
                  {row.candidate.evidence.map((e, i) => (
                    <li key={i}>
                      <Link
                        href={`/api/data-foundation/assets/${e.source?.versionId ?? row.versionId}/${e.assetId}`}
                      >
                        {e.locator}
                      </Link>
                      {e.excerpt ? <blockquote>{e.excerpt}</blockquote> : null}
                    </li>
                  ))}
                </ul>
              </details>
            </article>
          ))}
          {pagination}
        </>
      ) : null}
    </section>
  );
}
