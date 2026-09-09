import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageFile = require.resolve('maplibre-gl/package.json');
const manifest = JSON.parse(await readFile(packageFile, 'utf8'));
if (manifest.version !== '6.8.0')
  throw new Error(
    'Update the pinned MapLibre worker path when changing its version.',
  );
const destination = fileURLToPath(
  new URL('../public/vendor/maplibre/6.8.0/', import.meta.url),
);
await mkdir(destination, { recursive: true });
for (const name of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  await copyFile(
    join(dirname(packageFile), 'dist', name),
    join(destination, name),
  );
}
