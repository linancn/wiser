export interface AmapLngLat {
  getLng(): number;
  getLat(): number;
}
export interface AmapBounds {
  getSouthWest(): AmapLngLat;
  getNorthEast(): AmapLngLat;
}
export interface AmapLayer {
  on(event: string, callback: (event: unknown) => void): void;
  off(event: string, callback: (event: unknown) => void): void;
  show(): void;
  hide(): void;
  setStyle(style: Readonly<Record<string, unknown>>): void;
  setMap(map: AmapMap | null): void;
}
export interface AmapMap {
  on(event: string, callback: (event: unknown) => void): void;
  off(event: string, callback: (event: unknown) => void): void;
  add(layer: AmapLayer | readonly AmapLayer[]): void;
  remove(layer: AmapLayer | readonly AmapLayer[]): void;
  destroy(): void;
  getCenter(): AmapLngLat;
  getZoom(): number;
  getBounds(): AmapBounds;
  setZoom(zoom: number): void;
  setZoomAndCenter(
    zoom: number,
    center: readonly number[],
    immediately?: boolean,
  ): void;
  setBounds(
    bounds: AmapBounds,
    immediately?: boolean,
    padding?: readonly number[],
    maxZoom?: number,
  ): void;
  setMapStyle(style: string): void;
  setFitView(
    overlays?: readonly AmapLayer[],
    immediately?: boolean,
    padding?: readonly number[],
    maxZoom?: number,
  ): void;
  resize(): void;
}
export interface AmapSdk {
  readonly Browser?: { readonly isWebGL?: boolean };
  Map: new (
    container: HTMLElement,
    options: Readonly<Record<string, unknown>>,
  ) => AmapMap;
  Bounds: new (
    southWest: readonly number[],
    northEast: readonly number[],
  ) => AmapBounds;
  GeoJSON: new (options: Readonly<Record<string, unknown>>) => AmapLayer;
  CircleMarker: new (options: Readonly<Record<string, unknown>>) => AmapLayer;
  Polyline: new (options: Readonly<Record<string, unknown>>) => AmapLayer;
  Polygon: new (options: Readonly<Record<string, unknown>>) => AmapLayer;
  MapboxVectorTileLayer: new (
    options: Readonly<Record<string, unknown>>,
  ) => AmapLayer;
  TileLayer: {
    Flexible: new (options: Readonly<Record<string, unknown>>) => AmapLayer;
  };
}

declare global {
  interface Window {
    AMap?: AmapSdk;
    _AMapSecurityConfig?: { serviceHost: string };
  }
}

let loading: Promise<AmapSdk> | undefined;

export function loadAmap(): Promise<AmapSdk> {
  if (loading) return loading;
  loading = initialize().catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

async function initialize(): Promise<AmapSdk> {
  const response = await fetch('/api/maps/amap/config', {
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Map configuration unavailable');
  const config: unknown = await response.json();
  if (
    !config ||
    typeof config !== 'object' ||
    !('key' in config) ||
    typeof config.key !== 'string' ||
    config.key.length === 0 ||
    !('serviceHost' in config) ||
    config.serviceHost !== '/_AMapService'
  )
    throw new Error('Invalid map configuration');
  const key = config.key;
  window._AMapSecurityConfig = {
    serviceHost: `${window.location.origin}/_AMapService`,
  };
  if (window.AMap) return window.AMap;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const url = new URL('https://webapi.amap.com/maps');
    url.search = new URLSearchParams({
      v: '2.0',
      key,
    }).toString();
    script.src = url.href;
    script.async = true;
    script.referrerPolicy = 'strict-origin-when-cross-origin';
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      reject(new Error('Map SDK unavailable'));
    };
    const timer = setTimeout(fail, 20000);
    script.onerror = fail;
    script.onload = () => {
      clearTimeout(timer);
      if (window.AMap) resolve(window.AMap);
      else fail();
    };
    document.head.append(script);
  });
}
