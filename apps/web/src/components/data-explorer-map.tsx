'use client';
import {
  invalidatesExploration,
  type InvalidateExploration,
} from '@/lib/exploration-request';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as maplibre from 'maplibre-gl';
import Map, {
  Source,
  Layer,
  NavigationControl,
  AttributionControl,
  type MapRef,
} from 'react-map-gl/maplibre';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ExplorationResultSchema,
  type ExplorationRecord,
  type ExplorationResult,
} from '@wiser/data-contracts';
import { getDictionary, type Locale } from '@/lib/i18n';
import styles from './data-explorer.module.css';

maplibre.setWorkerUrl('/vendor/maplibre/6.8.0/maplibre-gl-worker.mjs');

export default function DataExplorerMap({
  result,
  selectedId,
  onSelect,
  onInvalidated,
  locale,
}: {
  readonly result: ExplorationResult;
  readonly selectedId: string | null;
  readonly onSelect: (record: ExplorationRecord) => void;
  readonly locale: Locale;
  readonly onInvalidated: InvalidateExploration;
}) {
  const map = useRef<MapRef>(null);
  const [ready, setReady] = useState(false);
  const [renderedCount, setRenderedCount] = useState(0);
  const [failed, setFailed] = useState(false);
  const [theme, setTheme] = useState(0);
  const copy = getDictionary(locale).dataFoundation.explorer;
  const controls = getDictionary(locale).dataFoundation.mapPage.controls;
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme((value) => value + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    });
    return () => observer.disconnect();
  }, []);
  const palette = useMemo(() => {
    void theme;
    const css = getComputedStyle(document.documentElement);
    const color = (name: string) => css.getPropertyValue(name).trim();
    return {
      background: color('--canvas-deep'),
      land: color('--surface'),
      border: color('--border-strong'),
      accent: color('--accent'),
      selected: color('--warning-bright'),
      ink: color('--text-strong'),
    };
  }, [theme]);
  const pending = useRef<AbortController | null>(null);
  const [selected, setSelected] = useState(selectedId);
  useEffect(() => setSelected(selectedId), [selectedId]);
  useEffect(() => () => pending.current?.abort(), []);
  function fit() {
    const extent = result.spatial?.bounds;
    if (extent)
      map.current?.fitBounds(
        [
          [extent[0], Math.max(-85.0511287798066, extent[1])],
          [extent[2], Math.min(85.0511287798066, extent[3])],
        ],
        { padding: 60, maxZoom: 5.5, duration: 0 },
      );
  }
  async function select(properties: Record<string, unknown>) {
    if (properties['cluster'] === true) return;
    const recordId = properties['recordId'],
      versionId = properties['versionId'],
      assetId = properties['assetId'];
    if (
      typeof recordId !== 'string' ||
      typeof versionId !== 'string' ||
      typeof assetId !== 'string'
    )
      return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setSelected(recordId);
    try {
      const response = await fetch('/api/data-foundation/explore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          queryId: result.queryId,
          view: 'records',
          versionId,
          assetId,
          recordId,
        }),
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        if (
          !controller.signal.aborted &&
          invalidatesExploration(response.status)
        )
          onInvalidated(result.queryId, response.status);
        throw new Error('Record unavailable');
      }
      const data = ExplorationResultSchema.parse(await response.json());
      if (controller.signal.aborted) return;
      const record = data.records?.[0];
      if (data.queryId !== result.queryId || record?.recordId !== recordId)
        throw new Error('Record mismatch');
      onSelect(record);
    } catch {
      if (!controller.signal.aborted) {
        setFailed(true);
        setReady(false);
      }
    }
  }
  useEffect(() => {
    if (ready) fit();
  }, [ready, result]);
  const tiles = useMemo(
    () => [
      `${window.location.origin}/api/data-foundation/geo/tiles/vector/queries/${result.queryId}/{z}/{x}/{y}.pbf`,
    ],
    [result.queryId],
  );
  const style = useMemo<maplibre.StyleSpecification>(
    () => ({
      version: 8,
      sources: {
        land: {
          type: 'geojson',
          data: '/basemap/land-110m.geojson',
          attribution: 'Natural Earth',
        },
      },
      layers: [
        {
          id: 'ocean',
          type: 'background',
          paint: { 'background-color': palette.background },
        },
        {
          id: 'land',
          type: 'fill',
          source: 'land',
          paint: {
            'fill-color': palette.land,
            'fill-outline-color': palette.border,
          },
        },
      ],
    }),
    [palette],
  );
  return (
    <div
      className={styles.mapCanvas}
      data-testid="explorer-map"
      data-ready={ready}
      data-rendered-feature-count={renderedCount}
      data-selected-record={selected ?? ''}
    >
      {failed ? null : (
        <Map
          ref={map}
          mapLib={maplibre}
          initialViewState={{ longitude: 105, latitude: 35, zoom: 2 }}
          mapStyle={style}
          style={{ height: '100%', width: '100%' }}
          attributionControl={false}
          renderWorldCopies={false}
          locale={{
            'Map.Title': controls.title,
            'NavigationControl.ZoomIn': controls.zoomIn,
            'NavigationControl.ZoomOut': controls.zoomOut,
            'NavigationControl.ResetBearing': controls.resetBearing,
            'AttributionControl.ToggleAttribution': controls.toggleAttribution,
          }}
          interactiveLayerIds={[
            'records-points',
            'records-lines',
            'records-polygons',
          ]}
          onLoad={() => setReady(true)}
          onIdle={() => {
            const instance = map.current?.getMap();
            if (!instance) return;
            const layers = [
              'records-points',
              'records-lines',
              'records-polygons',
            ].filter((id) => instance.getLayer(id));
            if (layers.length === 0) return;
            setRenderedCount(
              new Set(
                instance
                  .queryRenderedFeatures({ layers })
                  .map((feature) =>
                    String(
                      feature.properties?.['recordId'] ??
                        feature.properties?.['clusterId'],
                    ),
                  ),
              ).size,
            );
          }}
          onError={(event) => {
            const error: unknown = event.error;
            if (
              typeof error === 'object' &&
              error !== null &&
              'status' in error &&
              typeof error.status === 'number' &&
              invalidatesExploration(error.status)
            )
              onInvalidated(result.queryId, error.status);
            setFailed(true);
            setReady(false);
          }}
          onClick={(event) => {
            const properties = event.features?.[0]?.properties;
            if (!properties) return;
            if (properties['cluster'] === true) {
              map.current?.easeTo({
                center: event.lngLat,
                zoom: Math.min(22, (map.current?.getZoom() ?? 0) + 2),
                duration: 0,
              });
            } else void select(properties);
          }}
        >
          <NavigationControl position="top-right" />
          <AttributionControl compact={false} />
          <Source
            id="records"
            type="vector"
            tiles={tiles}
            minzoom={0}
            maxzoom={22}
          >
            <Layer
              source-layer="exploration"
              id="records-polygons"
              type="fill"
              filter={['==', ['geometry-type'], 'Polygon']}
              paint={{ 'fill-color': palette.accent, 'fill-opacity': 0.3 }}
            />
            <Layer
              source-layer="exploration"
              id="records-lines"
              type="line"
              filter={[
                'in',
                ['geometry-type'],
                ['literal', ['LineString', 'Polygon']],
              ]}
              paint={{
                'line-color': [
                  'case',
                  ['==', ['get', 'recordId'], selected ?? ''],
                  palette.selected,
                  palette.accent,
                ],
                'line-width': 3,
              }}
            />
            <Layer
              source-layer="exploration"
              id="records-points"
              type="circle"
              filter={['==', ['geometry-type'], 'Point']}
              paint={{
                'circle-color': [
                  'case',
                  ['==', ['get', 'recordId'], selected ?? ''],
                  palette.selected,
                  palette.accent,
                ],
                'circle-radius': [
                  'case',
                  ['==', ['get', 'recordId'], selected ?? ''],
                  10,
                  ['case', ['==', ['get', 'cluster'], true], 16, 6],
                ],
                'circle-stroke-color': palette.ink,
                'circle-stroke-width': 2,
              }}
            />
          </Source>
        </Map>
      )}
      <div className={styles.mapSummary}>
        <button onClick={fit}>{copy.fitMap}</button>
        <span>
          {copy.shownFeatures} {renderedCount.toLocaleString(locale)} ·{' '}
          {copy.spatialRecords}{' '}
          {(
            result.spatial?.mercatorFeatureCount ?? result.totalCount
          ).toLocaleString(locale)}
        </span>
      </div>
      {failed ? (
        <div className={styles.mapNotice} role="status">
          {copy.mapUnavailable}
          <button onClick={() => setFailed(false)}>{copy.retryMap}</button>
        </div>
      ) : null}
    </div>
  );
}
