'use client';

import 'maplibre-gl/dist/maplibre-gl.css';

import {
  AttributionControl,
  LngLatBounds,
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

function collectBounds(value: unknown, bounds: LngLatBounds): LngLatBounds {
  if (!Array.isArray(value)) return bounds;
  const coordinates: readonly unknown[] = value;
  const longitude: unknown = coordinates[0];
  const latitude: unknown = coordinates[1];
  if (
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude >= -90 &&
    latitude <= 90
  ) {
    bounds.extend([longitude, latitude]);
    return bounds;
  }
  for (const child of coordinates) collectBounds(child, bounds);
  return bounds;
}

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

function geoJsonData(features: MapFeatureCollectionDto) {
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
        geometry,
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
              [minimumX, minimumY],
              [maximumX, minimumY],
              [maximumX, maximumY],
              [minimumX, maximumY],
              [minimumX, minimumY],
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
}

export function DataFoundationMap({
  ariaLabel,
  displayCrs,
  features,
  labels,
  rasterTileUrl,
  selectedVersion,
  stacExtents,
  vectorTileUrl,
}: {
  readonly ariaLabel: string;
  readonly displayCrs: 'EPSG:4326' | 'EPSG:4490';
  readonly features: MapFeatureCollectionDto;
  readonly labels: MapLayerLabels;
  readonly rasterTileUrl?: string;
  readonly selectedVersion?: string;
  readonly stacExtents: readonly StacExtentDto[];
  readonly vectorTileUrl?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<Readonly<Record<MapLayer, boolean>>>(
    () => ({
      authority: true,
      stac: stacExtents.length > 0,
      vector: vectorTileUrl !== undefined,
      raster: false,
    }),
  );

  useEffect(() => {
    if (container.current === null) return;
    const color = (name: string, fallback: string) =>
      getComputedStyle(container.current!).getPropertyValue(name).trim() ||
      fallback;
    const sources: StyleSpecification['sources'] = {
      authority: { type: 'geojson', data: geoJsonData(features) },
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
        tiles: [vectorTileUrl],
        minzoom: 0,
        maxzoom: 22,
      };
    }
    if (rasterTileUrl !== undefined) {
      sources['governed-raster'] = {
        type: 'raster',
        tiles: [rasterTileUrl],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 22,
      };
    }
    const visibility = (layer: MapLayer) =>
      visible[layer] ? ('visible' as const) : ('none' as const);
    const layers: StyleSpecification['layers'] = [
      {
        id: 'authority-background',
        type: 'background',
        paint: {
          'background-color': color('--surface-strong', '#071a21'),
        },
      },
    ];
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
      attributionControl: false,
      cooperativeGestures: true,
      locale:
        document.documentElement.lang === 'zh-CN'
          ? {
              'AttributionControl.ToggleAttribution': '切换地图署名',
              'Map.Title': '数据基座地图',
              'NavigationControl.ResetBearing': '重置方向',
              'NavigationControl.ZoomIn': '放大',
              'NavigationControl.ZoomOut': '缩小',
              'CooperativeGesturesHandler.WindowsHelpText':
                '按住 Ctrl 并滚动以缩放地图',
              'CooperativeGesturesHandler.MacHelpText':
                '按住 Command 并滚动以缩放地图',
              'CooperativeGesturesHandler.MobileHelpText':
                '使用两根手指移动地图',
            }
          : undefined,
    });
    map.addControl(new NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(new AttributionControl({ compact: true }));
    map.once('load', () => {
      const bounds = new LngLatBounds();
      for (const feature of features.features) {
        collectBounds(feature.geometry.coordinates, bounds);
      }
      for (const extent of stacExtents) {
        bounds.extend([extent.bbox[0], extent.bbox[1]]);
        bounds.extend([extent.bbox[2], extent.bbox[3]]);
      }
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 52, maxZoom: 11, duration: 0 });
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
    return () => map.remove();
  }, [features, rasterTileUrl, stacExtents, vectorTileUrl, visible]);

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
        <dl>
          <div>
            <dt>{labels.selectedVersion}</dt>
            <dd>{selectedVersion ?? labels.noSelectedVersion}</dd>
          </div>
          <div>
            <dt>{labels.displayCrs}</dt>
            <dd>{displayCrs} → EPSG:3857</dd>
          </div>
        </dl>
      </div>
      <div
        ref={container}
        className={styles.map}
        role="img"
        aria-label={ariaLabel}
        data-testid="data-foundation-map"
      />
    </section>
  );
}
