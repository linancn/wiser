'use client';
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react';
import { amapCamera, type MapCamera } from '@/lib/amap-camera';
import { loadAmap, type AmapMap } from '@/lib/amap-loader';
import { getDictionary, type Locale } from '@/lib/i18n';
import styles from './amap-basemap.module.css';

export interface AmapBasemapHandle {
  syncCamera(camera: MapCamera): void;
}

export function AmapBasemap({
  ref,
  locale,
}: {
  readonly ref: Ref<AmapBasemapHandle>;
  readonly locale: Locale;
}) {
  const copy = getDictionary(locale).dataFoundation.amap;
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<AmapMap | null>(null);
  const camera = useRef<MapCamera>({
    longitude: 105,
    latitude: 35,
    zoom: 2,
    bearing: 0,
    pitch: 0,
  });
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>(
    'loading',
  );
  const [attempt, setAttempt] = useState(0);
  useImperativeHandle(
    ref,
    () => ({
      syncCamera(next) {
        camera.current = next;
        const { center, zoom } = amapCamera(next);
        map.current?.setZoomAndCenter(zoom, center, true);
      },
    }),
    [],
  );
  useEffect(() => {
    let disposed = false;
    let instance: AmapMap | null = null;
    let observer: MutationObserver | undefined;
    let resize: ResizeObserver | undefined;
    const timeout = setTimeout(() => {
      if (!disposed) setStatus('failed');
    }, 30000);
    const theme = () =>
      document.documentElement.dataset.theme === 'dark'
        ? 'amap://styles/darkblue'
        : 'amap://styles/whitesmoke';
    void (async () => {
      try {
        const sdk = await loadAmap();
        if (disposed || !container.current) return;
        const position = amapCamera(camera.current);
        instance = new sdk.Map(container.current, {
          ...position,
          zooms: [2, 22],
          viewMode: '2D',
          lang: copy.language,
          mapStyle: theme(),
          showBuildingBlock: false,
          showIndoorMap: false,
          dragEnable: false,
          scrollWheel: false,
          doubleClickZoom: false,
          keyboardEnable: false,
          touchZoom: false,
          rotateEnable: false,
          pitchEnable: false,
          resizeEnable: true,
        });
        map.current = instance;
        instance.on('complete', () => {
          if (disposed) return;
          clearTimeout(timeout);
          setStatus('ready');
        });
        observer = new MutationObserver(() => instance?.setMapStyle(theme()));
        observer.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['data-theme'],
        });
        if (typeof ResizeObserver !== 'undefined') {
          resize = new ResizeObserver(() => instance?.resize());
          resize.observe(container.current);
        }
      } catch {
        if (!disposed) {
          clearTimeout(timeout);
          setStatus('failed');
        }
      }
    })();
    return () => {
      disposed = true;
      clearTimeout(timeout);
      observer?.disconnect();
      resize?.disconnect();
      instance?.destroy();
      map.current = null;
    };
  }, [attempt, copy.language]);
  return (
    <>
      <div
        ref={container}
        className={styles.base}
        data-testid="amap-basemap"
        data-state={status}
        aria-label={copy.provider}
      />
      {status !== 'ready' ? (
        <div className={styles.status} role="status">
          <span>{status === 'loading' ? copy.loading : copy.failed}</span>
          {status === 'failed' ? (
            <button
              type="button"
              onClick={() => {
                setStatus('loading');
                setAttempt(attempt + 1);
              }}
            >
              {copy.retry}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
