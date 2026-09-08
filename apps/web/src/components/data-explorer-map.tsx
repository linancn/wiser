'use client';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeatureCollection, Geometry } from 'geojson';
import * as maplibre from 'maplibre-gl';
import Map, {
  Source,
  Layer,
  NavigationControl,
  AttributionControl,
  type MapRef,
} from 'react-map-gl/maplibre';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ExplorationRecord,
  ExplorationResult,
} from '@wiser/data-contracts';
import { getDictionary, type Locale } from '@/lib/i18n';
import styles from './data-explorer.module.css';

type MapData = FeatureCollection<Geometry>;
type MapGeometry = Geometry;
maplibre.setWorkerUrl('/vendor/maplibre/6.8.0/maplibre-gl-worker.mjs');

export default function DataExplorerMap({
  result,
  selectedId,
  onSelect,
  locale,
}: {
  readonly result: ExplorationResult;
  readonly selectedId: string | null;
  readonly onSelect: (record: ExplorationRecord) => void;
  readonly locale: Locale;
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
  const data = useMemo<MapData>(
    () => ({
      type: 'FeatureCollection',
      features: (result.features ?? []).map((feature) => ({
        type: 'Feature',
        id: feature.id,
        geometry: feature.geometry as unknown as MapGeometry,
        properties: { recordId: feature.id },
      })),
    }),
    [result],
  );
  function fit() {
    const bounds = new maplibre.LngLatBounds();
    function collect(value: unknown): void {
      if (!Array.isArray(value)) return;
      const coordinates: readonly unknown[] = value;
      if (
        typeof coordinates[0] === 'number' &&
        typeof coordinates[1] === 'number'
      )
        bounds.extend([coordinates[0], coordinates[1]]);
      else coordinates.forEach(collect);
    }
    for (const feature of result.features ?? [])
      collect(feature.geometry['coordinates']);
    if (!bounds.isEmpty())
      map.current?.fitBounds(bounds, {
        padding: 60,
        maxZoom: 5.5,
        duration: 0,
      });
  }
  useEffect(() => {
    if (ready) fit();
  }, [ready, result]);
  const style: maplibre.StyleSpecification = {
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
  };
  return (
    <div
      className={styles.mapCanvas}
      data-testid="explorer-map"
      data-ready={ready}
      data-rendered-feature-count={renderedCount}
      data-selected-record={selectedId ?? ''}
    >
      <Map
        ref={map}
        mapLib={maplibre}
        initialViewState={{ longitude: 105, latitude: 35, zoom: 2 }}
        mapStyle={style}
        style={{ height: '100%', width: '100%' }}
        attributionControl={false}
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
                .map((feature) => String(feature.properties?.['recordId'])),
            ).size,
          );
        }}
        onError={() => setFailed(true)}
        onClick={(event) => {
          const id: unknown = event.features?.[0]?.properties?.['recordId'];
          const record = result.features?.find(
            (feature) => feature.id === id,
          )?.properties;
          if (record) onSelect(record);
        }}
      >
        <NavigationControl position="top-right" />
        <AttributionControl compact={false} />
        <Source id="records" type="geojson" data={data}>
          <Layer
            id="records-polygons"
            type="fill"
            filter={['==', ['geometry-type'], 'Polygon']}
            paint={{ 'fill-color': palette.accent, 'fill-opacity': 0.3 }}
          />
          <Layer
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
                ['==', ['get', 'recordId'], selectedId ?? ''],
                palette.selected,
                palette.accent,
              ],
              'line-width': 3,
            }}
          />
          <Layer
            id="records-points"
            type="circle"
            filter={['==', ['geometry-type'], 'Point']}
            paint={{
              'circle-color': [
                'case',
                ['==', ['get', 'recordId'], selectedId ?? ''],
                palette.selected,
                palette.accent,
              ],
              'circle-radius': [
                'case',
                ['==', ['get', 'recordId'], selectedId ?? ''],
                10,
                6,
              ],
              'circle-stroke-color': palette.ink,
              'circle-stroke-width': 2,
            }}
          />
        </Source>
      </Map>
      <div className={styles.mapSummary}>
        <button onClick={fit}>{copy.fitMap}</button>
        <span>
          {copy.shownFeatures} {(result.features ?? []).length} /{' '}
          {result.totalCount}
        </span>
      </div>
      {failed ? (
        <div className={styles.mapNotice} role="status">
          {copy.mapUnavailable}
        </div>
      ) : null}
    </div>
  );
}
