'use client';

import 'maplibre-gl/dist/maplibre-gl.css';

import {
  setWorkerUrl,
  Map as MapLibreMap,
  NavigationControl,
  type StyleSpecification,
} from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';

import type {
  MapFeatureCollectionDto,
  StacExtentDto,
} from '@/lib/data-foundation';

import styles from './data-foundation-map.module.css';
import { requireIntegerMapZoom } from '@/lib/map-integer-zoom';
import { DataRasterDisplay } from './data-raster-display';
import { rasterDisplayUrl, type RasterDisplay } from '@/lib/raster-display';
import { AmapBasemap, type AmapBasemapHandle } from './amap-basemap';
import {
  amapCoordinates,
  toAmap,
  type MapCoordinateSystem,
} from '@/lib/amap-coordinates';
import { getDictionary, type Locale } from '@/lib/i18n';
import { registerAmapRaster } from '@/lib/amap-raster-protocol';
import { mapDisplayBounds } from '@/lib/data-foundation-map-bounds';

setWorkerUrl('/vendor/maplibre/6.8.0/maplibre-gl-worker.mjs');

type Position = [number, number, ...number[]];

function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError('Invalid map geometry.');
  return value;
}

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('Invalid map geometry.');
  }
  return value;
}

function position(value: unknown): Position {
  const values = array(value);
  const first = values[0];
  const second = values[1];
  if (first === undefined || second === undefined) {
    throw new TypeError('Invalid map geometry.');
  }
  return [number(first), number(second), ...values.slice(2).map(number)];
}

function positions(value: unknown): Position[] {
  return array(value).map(position);
}

function rings(value: unknown): Position[][] {
  return array(value).map(positions);
}

function polygons(value: unknown): Position[][][] {
  return array(value).map(rings);
}

function geoJsonData(
  features: MapFeatureCollectionDto,
  crs: MapCoordinateSystem,
) {
  return {
    type: 'FeatureCollection' as const,
    features: features.features.map((feature) => {
      const geometry = (() => {
        switch (feature.geometry.type) {
          case 'Point':
            return {
              type: 'Point' as const,
              coordinates: position(feature.geometry.coordinates),
            };
          case 'MultiPoint':
          case 'LineString':
            return {
              type: feature.geometry.type,
              coordinates: positions(feature.geometry.coordinates),
            };
          case 'MultiLineString':
          case 'Polygon':
            return {
              type: feature.geometry.type,
              coordinates: rings(feature.geometry.coordinates),
            };
          case 'MultiPolygon':
            return {
              type: 'MultiPolygon' as const,
              coordinates: polygons(feature.geometry.coordinates),
            };
        }
      })();
      return {
        type: 'Feature' as const,
        id: feature.id,
        geometry: {
          ...geometry,
          coordinates: amapCoordinates(
            geometry.coordinates,
            crs,
          ) as typeof geometry.coordinates,
        },
        properties: feature.properties,
      };
    }),
  };
}

function stacData(extents: readonly StacExtentDto[]) {
  return {
    type: 'FeatureCollection' as const,
    features: extents.map((extent) => {
      const [minimumX, minimumY, maximumX, maximumY] = extent.bbox;
      return {
        type: 'Feature' as const,
        id: extent.itemId,
        properties: {
          versionId: extent.versionId,
          dataItemId: extent.dataItemId,
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              toAmap([minimumX, minimumY]),
              toAmap([maximumX, minimumY]),
              toAmap([maximumX, maximumY]),
              toAmap([minimumX, maximumY]),
              toAmap([minimumX, minimumY]),
            ],
          ],
        },
      };
    }),
  };
}

type MapLayer = 'authority' | 'stac' | 'vector' | 'raster';

interface MapLayerLabels {
  readonly layersLabel: string;
  readonly authorityLayer: string;
  readonly stacLayer: string;
  readonly vectorLayer: string;
  readonly rasterLayer: string;
  readonly selectedVersion: string;
  readonly noSelectedVersion: string;
  readonly displayCrs: string;
  readonly controls: {
    readonly toggleAttribution: string;
    readonly title: string;
    readonly resetBearing: string;
    readonly zoomIn: string;
    readonly zoomOut: string;
    readonly windowsHelp: string;
    readonly macHelp: string;
    readonly mobileHelp: string;
  };
}

export function DataFoundationMap({
  locale,
  ariaLabel,
  displayCrs,
  features,
  labels,
  rasterTileUrl,
  requestedBounds,
  selectedVersion,
  selectedName,
  stacExtents,
  vectorTileUrl,
}: {
  readonly locale: Locale;
  readonly ariaLabel: string;
  readonly displayCrs: 'EPSG:4326' | 'EPSG:4490';
  readonly features: MapFeatureCollectionDto;
  readonly labels: MapLayerLabels;
  readonly rasterTileUrl?: string;
  readonly requestedBounds?: readonly [number, number, number, number];
  readonly selectedVersion?: string;
  readonly selectedName?: string;
  readonly stacExtents: readonly StacExtentDto[];
  readonly vectorTileUrl?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const basemap = useRef<AmapBasemapHandle>(null);
  const amapCopy = getDictionary(locale).dataFoundation.amap;
  const mapCopy = getDictionary(locale).dataFoundation.mapPage;
  const rasterCopy = getDictionary(locale).rasterDisplay;
  const rasterRef = useRef<ReturnType<typeof registerAmapRaster> | null>(null);
  const displayRef = useRef<RasterDisplay | null>(null);
  const sourceTemplate = useRef(rasterTileUrl);
  const [rasterState, setRasterState] = useState<
    'loading' | 'ready' | 'failed'
  >('loading');
  const rasterFailed = useRef(false);
  const [integerZoom, setIntegerZoom] = useState(false);
  const integerZoomRef = useRef(false);
  function applyDisplay(display: RasterDisplay | null) {
    displayRef.current = display;
    const map = mapRef.current;
    if (!map || !rasterTileUrl) return;
    const replace = () => {
      if (mapRef.current !== map) return;
      const style = map.getStyle();
      const source = style.sources['governed-raster'];
      const index = style.layers.findIndex(
        (layer) => layer.id === 'governed-raster-layer',
      );
      const layer = style.layers[index];
      if (source?.type !== 'raster' || !layer) return;
      const next = registerAmapRaster(
        rasterDisplayUrl(rasterTileUrl, displayRef.current),
      );
      const previous = rasterRef.current;
      // Detach the old source before stopping its worker, so late failures cannot
      // change the new attempt's state. Other layers and the camera stay intact.
      map.removeLayer(layer.id);
      map.removeSource('governed-raster');
      previous?.dispose();
      rasterRef.current = next;
      rasterFailed.current = false;
      setRasterState('loading');
      map.addSource('governed-raster', { ...source, tiles: [next.url] });
      map.addLayer(layer, style.layers[index + 1]?.id);
    };
    if (map.isStyleLoaded()) replace();
    else map.once('load', replace);
  }

  const [rasterOpacity, setRasterOpacity] = useState(78);
  const [visible, setVisible] = useState<Readonly<Record<MapLayer, boolean>>>(
    () => ({
      authority: true,
      stac: stacExtents.length > 0,
      vector: vectorTileUrl !== undefined,
      raster: rasterTileUrl !== undefined,
    }),
  );

  useEffect(() => {
    if (container.current === null) return;
    const color = (name: string, fallback: string) =>
      getComputedStyle(container.current!).getPropertyValue(name).trim() ||
      fallback;
    if (sourceTemplate.current !== rasterTileUrl) {
      sourceTemplate.current = rasterTileUrl;
      displayRef.current = null;
      rasterFailed.current = false;
      setRasterState('loading');
    }
    const raster = rasterTileUrl
      ? registerAmapRaster(rasterDisplayUrl(rasterTileUrl, displayRef.current))
      : null;
    rasterRef.current = raster;
    const sources: StyleSpecification['sources'] = {
      authority: { type: 'geojson', data: geoJsonData(features, displayCrs) },
    };
    if (stacExtents.length > 0) {
      sources['stac-extents'] = {
        type: 'geojson',
        data: stacData(stacExtents),
      };
    }
    if (vectorTileUrl !== undefined) {
      sources['governed-vector'] = {
        type: 'vector',
        tiles: [
          vectorTileUrl.replace(
            '/tiles/vector/versions/',
            '/tiles/vector/amap/versions/',
          ),
        ],
        minzoom: 0,
        maxzoom: 22,
      };
    }
    if (rasterTileUrl !== undefined) {
      sources['governed-raster'] = {
        type: 'raster',
        tiles: [raster!.url],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 22,
      };
    }
    const visibility = (layer: MapLayer) =>
      visible[layer] ? ('visible' as const) : ('none' as const);
    const layers: StyleSpecification['layers'] = [];
    if (rasterTileUrl !== undefined) {
      layers.push({
        id: 'governed-raster-layer',
        type: 'raster',
        source: 'governed-raster',
        layout: { visibility: visibility('raster') },
        paint: { 'raster-opacity': 0.78 },
      });
    }
    if (stacExtents.length > 0) {
      layers.push(
        {
          id: 'stac-extents-fill',
          type: 'fill',
          source: 'stac-extents',
          layout: { visibility: visibility('stac') },
          paint: {
            'fill-color': color('--warning-bright', '#dfa33e'),
            'fill-opacity': 0.08,
          },
        },
        {
          id: 'stac-extents-line',
          type: 'line',
          source: 'stac-extents',
          layout: { visibility: visibility('stac') },
          paint: {
            'line-color': color('--warning-bright', '#dfa33e'),
            'line-width': 2,
            'line-dasharray': [3, 2],
          },
        },
      );
    }
    if (vectorTileUrl !== undefined) {
      layers.push(
        {
          id: 'governed-vector-fill',
          type: 'fill',
          source: 'governed-vector',
          'source-layer': 'authority',
          filter: ['==', ['geometry-type'], 'Polygon'],
          layout: { visibility: visibility('vector') },
          paint: {
            'fill-color': color('--accent-bright', '#5cc7d2'),
            'fill-opacity': 0.18,
          },
        },
        {
          id: 'governed-vector-line',
          type: 'line',
          source: 'governed-vector',
          'source-layer': 'authority',
          layout: { visibility: visibility('vector') },
          paint: {
            'line-color': color('--accent-bright', '#5cc7d2'),
            'line-width': 2.6,
          },
        },
        {
          id: 'governed-vector-point',
          type: 'circle',
          source: 'governed-vector',
          'source-layer': 'authority',
          filter: ['==', ['geometry-type'], 'Point'],
          layout: { visibility: visibility('vector') },
          paint: {
            'circle-color': color('--accent-bright', '#5cc7d2'),
            'circle-radius': 4.5,
          },
        },
      );
    }
    layers.push(
      {
        id: 'authority-polygons',
        type: 'fill',
        source: 'authority',
        filter: ['==', ['geometry-type'], 'Polygon'],
        layout: { visibility: visibility('authority') },
        paint: {
          'fill-color': color('--accent-fill', '#087886'),
          'fill-opacity': 0.28,
        },
      },
      {
        id: 'authority-lines',
        type: 'line',
        source: 'authority',
        filter: [
          'in',
          ['geometry-type'],
          ['literal', ['LineString', 'Polygon']],
        ],
        layout: { visibility: visibility('authority') },
        paint: {
          'line-color': color('--accent-bright', '#5cc7d2'),
          'line-opacity': 0.92,
          'line-width': 2.1,
        },
      },
      {
        id: 'authority-points',
        type: 'circle',
        source: 'authority',
        filter: ['==', ['geometry-type'], 'Point'],
        layout: { visibility: visibility('authority') },
        paint: {
          'circle-color': color('--warning-bright', '#dfa33e'),
          'circle-radius': 5,
          'circle-stroke-color': color('--text-on-strong', '#eff9fa'),
          'circle-stroke-width': 1.5,
        },
      },
    );
    const style: StyleSpecification = { version: 8, sources, layers };
    const map = new MapLibreMap({
      container: container.current,
      style,
      center: [105, 35],
      zoom: 2.3,
      minZoom: 1,
      maxZoom: 21,
      dragRotate: false,
      pitchWithRotate: false,
      maxPitch: 0,
      attributionControl: false,
      cooperativeGestures: true,
      locale: {
        'AttributionControl.ToggleAttribution':
          labels.controls.toggleAttribution,
        'Map.Title': labels.controls.title,
        'NavigationControl.ResetBearing': labels.controls.resetBearing,
        'NavigationControl.ZoomIn': labels.controls.zoomIn,
        'NavigationControl.ZoomOut': labels.controls.zoomOut,
        'CooperativeGesturesHandler.WindowsHelpText':
          labels.controls.windowsHelp,
        'CooperativeGesturesHandler.MacHelpText': labels.controls.macHelp,
        'CooperativeGesturesHandler.MobileHelpText': labels.controls.mobileHelp,
      },
    });
    mapRef.current = map;
    if (integerZoomRef.current) requireIntegerMapZoom(map);
    map.on('error', (event) => {
      if ('sourceId' in event && event.sourceId === 'governed-raster') {
        rasterFailed.current = true;
        setRasterState('failed');
      }
    });
    map.on('sourcedata', (event) => {
      if (event.sourceId === 'governed-raster' && !rasterFailed.current)
        setRasterState(event.isSourceLoaded ? 'ready' : 'loading');
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    const sync = () => {
      const center = map.getCenter();
      basemap.current?.syncCamera({
        longitude: center.lng,
        latitude: center.lat,
        zoom: map.getZoom(),
        bearing: 0,
        pitch: 0,
      });
    };
    map.on('move', sync);
    map.on('resize', sync);
    map.on('load', sync);
    map.once('load', () => {
      const bounds = mapDisplayBounds(
        features.features.map((feature) => feature.geometry.coordinates),
        stacExtents.map((extent) => extent.bbox),
        displayCrs,
        requestedBounds,
      );
      if (bounds !== undefined) {
        map.fitBounds([...bounds], { padding: 52, maxZoom: 11, duration: 0 });
      }
    });
    const updateTheme = () => {
      if (!map.loaded()) return;
      const update = (id: string, property: string, value: string) => {
        if (map.getLayer(id) === undefined) return;
        switch (property) {
          case 'background-color':
            map.setPaintProperty(id, 'background-color', value);
            break;
          case 'fill-color':
            map.setPaintProperty(id, 'fill-color', value);
            break;
          case 'line-color':
            map.setPaintProperty(id, 'line-color', value);
            break;
          case 'circle-color':
            map.setPaintProperty(id, 'circle-color', value);
            break;
          case 'circle-stroke-color':
            map.setPaintProperty(id, 'circle-stroke-color', value);
            break;
        }
      };
      update(
        'authority-background',
        'background-color',
        color('--surface-strong', '#071a21'),
      );
      update(
        'authority-polygons',
        'fill-color',
        color('--accent-fill', '#087886'),
      );
      update(
        'authority-lines',
        'line-color',
        color('--accent-bright', '#5cc7d2'),
      );
      update(
        'authority-points',
        'circle-color',
        color('--warning-bright', '#dfa33e'),
      );
      update(
        'authority-points',
        'circle-stroke-color',
        color('--text-on-strong', '#eff9fa'),
      );
      update(
        'stac-extents-line',
        'line-color',
        color('--warning-bright', '#dfa33e'),
      );
    };
    map.on('load', updateTheme);
    const themeObserver = new MutationObserver(updateTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    map.once('remove', () => themeObserver.disconnect());
    return () => {
      mapRef.current = null;
      map.remove();
      rasterRef.current?.dispose();
      rasterRef.current = null;
    };
  }, [
    features,
    labels.controls,
    rasterTileUrl,
    requestedBounds,
    stacExtents,
    vectorTileUrl,
    displayCrs,
  ]);
  useEffect(() => {
    const instance = mapRef.current;
    if (!instance) return;
    const update = () => {
      for (const [group, ids] of Object.entries({
        authority: [
          'authority-polygons',
          'authority-lines',
          'authority-points',
        ],
        stac: ['stac-extents-fill', 'stac-extents-line'],
        vector: [
          'governed-vector-fill',
          'governed-vector-line',
          'governed-vector-point',
        ],
        raster: ['governed-raster-layer'],
      }))
        for (const id of ids)
          if (instance.getLayer(id))
            instance.setLayoutProperty(
              id,
              'visibility',
              visible[group as MapLayer] ? 'visible' : 'none',
            );
    };
    update();
    instance.on('load', update);
    return () => {
      instance.off('load', update);
    };
  }, [visible]);
  useEffect(() => {
    const instance = mapRef.current;
    if (!instance) return;
    const update = () => {
      if (instance.getLayer('governed-raster-layer'))
        instance.setPaintProperty(
          'governed-raster-layer',
          'raster-opacity',
          rasterOpacity / 100,
        );
    };
    update();
    instance.on('load', update);
    return () => {
      instance.off('load', update);
    };
  }, [rasterOpacity, rasterTileUrl]);

  const controls: readonly {
    readonly id: MapLayer;
    readonly label: string;
    readonly available: boolean;
  }[] = [
    { id: 'authority', label: labels.authorityLayer, available: true },
    {
      id: 'stac',
      label: labels.stacLayer,
      available: stacExtents.length > 0,
    },
    {
      id: 'vector',
      label: labels.vectorLayer,
      available: vectorTileUrl !== undefined,
    },
    {
      id: 'raster',
      label: labels.rasterLayer,
      available: rasterTileUrl !== undefined,
    },
  ];

  return (
    <section className={styles.frame}>
      <div className={styles.layerControls} aria-label={labels.layersLabel}>
        <fieldset>
          <legend>{labels.layersLabel}</legend>
          {controls.map((control) => (
            <label key={control.id} data-available={control.available}>
              <input
                type="checkbox"
                checked={control.available && visible[control.id]}
                disabled={!control.available}
                onChange={(event) =>
                  setVisible((current) => ({
                    ...current,
                    [control.id]: event.target.checked,
                  }))
                }
              />
              <span>{control.label}</span>
            </label>
          ))}
        </fieldset>
        {rasterTileUrl ? (
          <div className={styles.rasterControls}>
            <label>
              <span>{mapCopy.rasterOpacity}</span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={rasterOpacity}
                disabled={!visible.raster}
                onChange={(event) =>
                  setRasterOpacity(Number(event.target.value))
                }
              />
            </label>
            <output>{rasterOpacity}%</output>
            <p>{mapCopy.rasterMeaning}</p>
            {visible.raster ? (
              <p role="status">
                {rasterCopy[rasterState]}{' '}
                {rasterState === 'failed' ? (
                  <button onClick={() => applyDisplay(displayRef.current)}>
                    {rasterCopy.retry}
                  </button>
                ) : null}
              </p>
            ) : null}
            <DataRasterDisplay
              key={rasterTileUrl}
              locale={locale}
              onApply={applyDisplay}
            />
          </div>
        ) : null}
        <dl>
          <div>
            <dt>{labels.selectedVersion}</dt>
            <dd title={selectedVersion}>
              {selectedName ?? labels.noSelectedVersion}
            </dd>
          </div>
          <div>
            <dt>{amapCopy.coordinateLabel}</dt>
            <dd>{amapCopy.aligned}</dd>
          </div>
        </dl>
        {integerZoom ? <p role="status">{rasterCopy.integerZoom}</p> : null}
      </div>
      <div
        className={styles.map}
        role="region"
        aria-label={ariaLabel}
        data-testid="data-foundation-map"
      >
        <AmapBasemap
          ref={basemap}
          locale={locale}
          onIntegerZoom={() => {
            if (integerZoomRef.current) return;
            integerZoomRef.current = true;
            setIntegerZoom(true);
            if (mapRef.current) requireIntegerMapZoom(mapRef.current);
          }}
        />
        <div ref={container} className={styles.overlay} />
      </div>
    </section>
  );
}
