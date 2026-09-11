const configured = new WeakSet<object>();

/** AMap's non-WebGL fallback rounds fractional zoom. Keep both engines at integral scales. */
export function requireIntegerMapZoom(map: {
  getZoom(): number;
  jumpTo(camera: { zoom: number }): unknown;
  on(event: 'moveend', listener: () => void): unknown;
  scrollZoom: { disable(): void };
  touchZoomRotate: { disable(): void };
}) {
  if (configured.has(map)) return;
  configured.add(map);
  map.scrollZoom.disable();
  map.touchZoomRotate.disable();
  const settle = () => {
    const zoom = map.getZoom(),
      integral = Math.floor(zoom + 1e-8);
    if (Math.abs(zoom - integral) > 1e-8) map.jumpTo({ zoom: integral });
  };
  map.on('moveend', settle);
  settle();
}
