'use client';
import {
  invalidatesExploration,
  type InvalidateExploration,
} from '@/lib/exploration-request';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeatureCollection } from 'geojson';
import { loadBusinessMap, businessMapBounds } from '@/lib/business-map';
import * as maplibre from 'maplibre-gl';
import Map, {
  Source,
  Layer,
  NavigationControl,
  type MapRef,
} from 'react-map-gl/maplibre';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ExplorationResultSchema,
  ExplorationBoundsSchema,
  type ExplorationBounds,
  type ExplorationRecord,
  type ExplorationResult,
} from '@wiser/data-contracts';
import { getDictionary, type Locale } from '@/lib/i18n';
import { SpatialAttribution } from './spatial-attribution';
import styles from './data-explorer.module.css';
import { AmapBasemap, type AmapBasemapHandle } from './amap-basemap';
import { requireIntegerMapZoom } from '@/lib/map-integer-zoom';
import { authorityCamera, displayCamera } from '@/lib/amap-camera';
import { toAmap, fromAmap } from '@/lib/amap-coordinates';
import { useExplorationViewState } from './exploration-view-context';

maplibre.setWorkerUrl('/vendor/maplibre/6.11.2/maplibre-gl-worker.mjs');

export default function DataExplorerMap({
  result,
  selectedId,
  onSelect,
  onInvalidated,
  locale,
  onBounds,
}: {
  readonly result: ExplorationResult;
  readonly selectedId: string | null;
  readonly onSelect: (record: ExplorationRecord) => void;
  readonly locale: Locale;
  readonly onBounds?: (bounds: ExplorationBounds | undefined) => void;
  readonly onInvalidated: InvalidateExploration;
}) {
  const viewState = useExplorationViewState();
  const [savedMap] = useState(() => viewState?.initial.map);
  const camera = useRef(savedMap?.camera);
  const map = useRef<MapRef>(null);
  const basemap = useRef<AmapBasemapHandle>(null);
  const [ready, setReady] = useState(false);
  const integerZoom = useRef(false);
  const [integerZoomNotice, setIntegerZoomNotice] = useState(false);
  const [renderedCount, setRenderedCount] = useState(0);
  const [failed, setFailed] = useState(false);
  const business = Boolean(result.spec.businessQuery);
  const [retry, setRetry] = useState(0);
  const [businessMap, setBusinessMap] = useState<FeatureCollection | null>(
    null,
  );
  useEffect(() => {
    if (!business) return;
    const controller = new AbortController();
    void loadBusinessMap(result, async (after) => {
      const response = await fetch('/api/data-foundation/explore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          queryId: result.queryId,
          view: 'map',
          first: 200,
          after,
        }),
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) {
        if (invalidatesExploration(response.status))
          onInvalidated(result.queryId, response.status);
        throw Error('Map unavailable');
      }
      return ExplorationResultSchema.parse(await response.json());
    })
      .then((data) => {
        if (!controller.signal.aborted) setBusinessMap(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [business, result, onInvalidated, retry]);
  const [layers, setLayers] = useState(
    savedMap?.layers ?? {
      points: true,
      lines: true,
      polygons: true,
    },
  );
  useEffect(() => {
    viewState?.reportMap({ camera: camera.current, layers });
  }, [layers, viewState]);
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
    const extent = business
      ? businessMapBounds(businessMap)
      : (result.spec.spatialBounds ?? result.spatial?.bounds);
    const display = (point: [number, number]): [number, number] =>
      business ? point : (toAmap(point) as [number, number]);
    if (extent)
      map.current?.fitBounds(
        [
          display([extent[0], Math.max(-85.0511287798066, extent[1])]),
          display([extent[2], Math.min(85.0511287798066, extent[3])]),
        ],
        { padding: 60, maxZoom: business ? 14 : 5.5, duration: 0 },
      );
  }
  function filterArea() {
    const bounds = map.current?.getBounds();
    if (!bounds) return;
    const southWest = fromAmap([
      Math.max(-180, bounds.getWest()),
      Math.max(-85.0511287798066, bounds.getSouth()),
    ]);
    const northEast = fromAmap([
      Math.min(180, bounds.getEast()),
      Math.min(85.0511287798066, bounds.getNorth()),
    ]);
    const parsed = ExplorationBoundsSchema.safeParse([
      southWest[0],
      southWest[1],
      northEast[0],
      northEast[1],
    ]);
    if (parsed.success) onBounds?.(parsed.data);
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
        setRenderedCount(0);
        setFailed(true);
        setReady(false);
      }
    }
  }
  useEffect(() => {
    if (ready && !savedMap?.camera) fit();
  }, [ready, result, businessMap]);
  const tiles = useMemo(
    () => [
      `${window.location.origin}/api/data-foundation/geo/tiles/vector/amap/queries/${result.queryId}/{z}/{x}/{y}.pbf`,
    ],
    [result.queryId],
  );
  const style = useMemo<maplibre.StyleSpecification>(
    () => ({ version: 8, sources: {}, layers: [] }),
    [],
  );
  return (
    <>
      <div className={styles.mapSummary} data-testid="explorer-map-controls">
        <button onClick={fit}>{copy.fitMap}</button>
        {onBounds && !business ? (
          <button disabled={!ready || failed} onClick={filterArea}>
            {copy.mapLayers.filter}
          </button>
        ) : null}
        <span>
          {copy.shownFeatures} {renderedCount.toLocaleString(locale)} ·{' '}
          {copy.spatialRecords}{' '}
          {(
            result.spatial?.mercatorFeatureCount ?? result.totalCount
          ).toLocaleString(locale)}
        </span>
      </div>
      <div
        className={styles.mapCanvas}
        data-testid="explorer-map"
        data-ready={ready}
        data-rendered-feature-count={renderedCount}
        data-selected-record={selected ?? ''}
      >
        <AmapBasemap
          ref={basemap}
          locale={locale}
          onIntegerZoom={() => {
            if (integerZoom.current) return;
            integerZoom.current = true;
            setIntegerZoomNotice(true);
            if (map.current) requireIntegerMapZoom(map.current.getMap());
          }}
        />
        {failed || (business && !businessMap) ? null : (
          <Map
            ref={map}
            mapLib={maplibre}
            initialViewState={displayCamera(
              savedMap?.camera ?? {
                longitude: 105,
                latitude: 35,
                zoom: 2,
                bearing: 0,
                pitch: 0,
              },
            )}
            mapStyle={style}
            style={{
              height: '100%',
              width: '100%',
              clipPath: 'inset(0 0 28px 0)',
            }}
            minZoom={1}
            maxZoom={21}
            dragRotate={false}
            pitchWithRotate={false}
            maxPitch={0}
            attributionControl={false}
            renderWorldCopies={false}
            locale={{
              'Map.Title': controls.title,
              'NavigationControl.ZoomIn': controls.zoomIn,
              'NavigationControl.ZoomOut': controls.zoomOut,
              'NavigationControl.ResetBearing': controls.resetBearing,
              'AttributionControl.ToggleAttribution':
                controls.toggleAttribution,
            }}
            interactiveLayerIds={[
              'records-points',
              'records-lines',
              'records-polygons',
            ]}
            onLoad={() => {
              if (integerZoom.current && map.current)
                requireIntegerMapZoom(map.current.getMap());
              const instance = map.current?.getMap();
              instance?.touchZoomRotate.disableRotation();
              if (instance)
                basemap.current?.syncCamera({
                  longitude: instance.getCenter().lng,
                  latitude: instance.getCenter().lat,
                  zoom: instance.getZoom(),
                  bearing: 0,
                  pitch: 0,
                });
              setReady(true);
            }}
            onMove={(event) =>
              basemap.current?.syncCamera({
                ...event.viewState,
                bearing: 0,
                pitch: 0,
              })
            }
            onMoveEnd={(event) => {
              const { longitude, latitude, zoom, bearing, pitch } =
                event.viewState;
              camera.current = authorityCamera({
                longitude: ((((longitude + 180) % 360) + 360) % 360) - 180,
                latitude,
                zoom,
                bearing: ((((bearing + 180) % 360) + 360) % 360) - 180,
                pitch,
              });
              viewState?.reportMap({ camera: camera.current, layers });
            }}
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
              setRenderedCount(0);
              setFailed(true);
              setReady(false);
            }}
            onClick={(event) => {
              const properties = event.features?.[0]?.properties;
              if (!properties) return;
              if (properties['cluster'] === true) {
                map.current?.easeTo({
                  center: event.lngLat,
                  zoom: Math.min(21, (map.current?.getZoom() ?? 0) + 2),
                  duration: 0,
                });
              } else void select(properties);
            }}
          >
            <NavigationControl position="top-right" showCompass={false} />
            <Source
              id="records"
              {...(business && businessMap
                ? { type: 'geojson' as const, data: businessMap }
                : { type: 'vector' as const, tiles, minzoom: 0, maxzoom: 22 })}
            >
              <Layer
                {...(business ? {} : { 'source-layer': 'exploration' })}
                id="records-polygons"
                layout={{ visibility: layers.polygons ? 'visible' : 'none' }}
                type="fill"
                filter={['==', ['geometry-type'], 'Polygon']}
                paint={{ 'fill-color': palette.accent, 'fill-opacity': 0.3 }}
              />
              <Layer
                {...(business ? {} : { 'source-layer': 'exploration' })}
                id="records-lines"
                layout={{
                  visibility:
                    layers.lines || layers.polygons ? 'visible' : 'none',
                }}
                type="line"
                filter={[
                  'in',
                  ['geometry-type'],
                  [
                    'literal',
                    [
                      ...(layers.lines ? ['LineString'] : []),
                      ...(layers.polygons ? ['Polygon'] : []),
                    ],
                  ],
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
                {...(business ? {} : { 'source-layer': 'exploration' })}
                id="records-points"
                layout={{ visibility: layers.points ? 'visible' : 'none' }}
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
                    [
                      'case',
                      ['==', ['get', 'cluster'], true],
                      [
                        'step',
                        ['get', 'count'],
                        16,
                        100,
                        20,
                        1000,
                        24,
                        10000,
                        30,
                      ],
                      6,
                    ],
                  ],
                  'circle-stroke-color': palette.ink,
                  'circle-stroke-width': 2,
                }}
              />
              <Layer
                {...(business ? {} : { 'source-layer': 'exploration' })}
                id="records-cluster-labels"
                type="symbol"
                filter={['==', ['get', 'cluster'], true]}
                layout={{
                  visibility: layers.points ? 'visible' : 'none',
                  'text-field': ['to-string', ['get', 'count']],
                  'text-font': ['Arial', 'sans-serif'],
                  'text-size': 12,
                  'text-allow-overlap': true,
                  'text-ignore-placement': true,
                }}
                paint={{ 'text-color': palette.background }}
              />
            </Source>
          </Map>
        )}
        {!failed ? (
          <details className={styles.mapLegend}>
            <summary>{copy.mapLayers.title}</summary>
            <fieldset>
              {(['points', 'lines', 'polygons'] as const).map((key) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={layers[key]}
                    onChange={(event) =>
                      setLayers((value) => ({
                        ...value,
                        [key]: event.target.checked,
                      }))
                    }
                  />
                  {copy.mapLayers[key]}
                </label>
              ))}
              <p>
                <span className={styles.selectedSwatch} aria-hidden="true" />
                {copy.mapLayers.selected}
              </p>
              <p>{copy.mapLayers.clusters}</p>
              <p>{copy.mapLayers.hint}</p>
            </fieldset>
          </details>
        ) : null}
        {failed ? (
          <div className={styles.mapNotice} role="status">
            {copy.mapUnavailable}
            <button
              onClick={() => {
                setFailed(false);
                setRetry((value) => value + 1);
              }}
            >
              {copy.retryMap}
            </button>
          </div>
        ) : null}
      </div>
      <SpatialAttribution
        collection={
          business ? businessMap : { features: result.features ?? [] }
        }
      />
      <p role="note" className={styles.mapPositionNote}>
        {getDictionary(locale).dataFoundation.amap.positionLimit}
        {business ? (
          <span>
            {' '}
            {getDictionary(locale).knowledgeRelations.businessMapScope}
          </span>
        ) : null}
      </p>
      {integerZoomNotice && !failed ? (
        <p className={styles.mapPositionNote}>
          {getDictionary(locale).rasterDisplay.integerZoom}
        </p>
      ) : null}
    </>
  );
}
