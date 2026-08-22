'use client';

import 'maplibre-gl/dist/maplibre-gl.css';

import {
  AttributionControl,
  LngLatBounds,
  Map as MapLibreMap,
  NavigationControl,
  type StyleSpecification,
} from 'maplibre-gl';
import { useEffect, useRef } from 'react';

import type { MapFeatureCollectionDto } from '@/lib/data-foundation';

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

export function DataFoundationMap({
  ariaLabel,
  features,
}: {
  readonly ariaLabel: string;
  readonly features: MapFeatureCollectionDto;
}) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (container.current === null || features.features.length === 0) return;
    const color = (name: string, fallback: string) =>
      getComputedStyle(container.current!).getPropertyValue(name).trim() ||
      fallback;
    const data = geoJsonData(features);
    const style: StyleSpecification = {
      version: 8,
      sources: {
        authority: { type: 'geojson', data },
      },
      layers: [
        {
          id: 'authority-background',
          type: 'background',
          paint: {
            'background-color': color('--surface-strong', '#071a21'),
          },
        },
        {
          id: 'authority-polygons',
          type: 'fill',
          source: 'authority',
          filter: ['==', ['geometry-type'], 'Polygon'],
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
          paint: {
            'circle-color': color('--warning-bright', '#dfa33e'),
            'circle-radius': 5,
            'circle-stroke-color': color('--text-on-strong', '#eff9fa'),
            'circle-stroke-width': 1.5,
          },
        },
      ],
    };
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
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 52, maxZoom: 11, duration: 0 });
      }
    });
    const updateTheme = () => {
      if (!map.loaded()) return;
      map.setPaintProperty(
        'authority-background',
        'background-color',
        color('--surface-strong', '#071a21'),
      );
      map.setPaintProperty(
        'authority-polygons',
        'fill-color',
        color('--accent-fill', '#087886'),
      );
      map.setPaintProperty(
        'authority-lines',
        'line-color',
        color('--accent-bright', '#5cc7d2'),
      );
      map.setPaintProperty(
        'authority-points',
        'circle-color',
        color('--warning-bright', '#dfa33e'),
      );
      map.setPaintProperty(
        'authority-points',
        'circle-stroke-color',
        color('--text-on-strong', '#eff9fa'),
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
  }, [features]);

  return (
    <div
      ref={container}
      className={styles.map}
      role="img"
      aria-label={ariaLabel}
      data-testid="data-foundation-map"
    />
  );
}
