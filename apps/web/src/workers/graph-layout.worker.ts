import { computeGraphLayout } from '../lib/graph-layout-engine';
import type { GraphLayoutInput } from '../lib/graph-layout-types';

self.addEventListener('message', (event: MessageEvent<GraphLayoutInput>) => {
  void computeGraphLayout(event.data).then(
    (positions) => self.postMessage(positions),
    () => self.postMessage(null),
  );
});
