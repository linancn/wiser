import { fromAmap, toAmap } from './amap-coordinates';

export interface MapCamera {
  readonly longitude: number;
  readonly latitude: number;
  readonly zoom: number;
  readonly bearing: number;
  readonly pitch: number;
}

export function amapCamera(display: MapCamera) {
  return {
    center: [display.longitude, display.latitude],
    zoom: display.zoom + 1,
  };
}

export function displayCamera(authority: MapCamera): MapCamera {
  const [longitude, latitude] = toAmap([
    authority.longitude,
    authority.latitude,
  ]);
  return { ...authority, longitude, latitude, bearing: 0, pitch: 0 };
}

export function authorityCamera(display: MapCamera): MapCamera {
  const [longitude, latitude] = fromAmap([display.longitude, display.latitude]);
  return { ...display, longitude, latitude, bearing: 0, pitch: 0 };
}
