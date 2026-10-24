// Bundles main, preload and the three renderer surfaces with esbuild.
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');
const surfaces = ['dock', 'launcher', 'settings', 'widgets', 'control', 'splash', 'files', 'monitor'];

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'renderer'), { recursive: true });

const common = { bundle: true, sourcemap: 'linked', logLevel: 'warning', legalComments: 'none' };

await Promise.all([
  build({
    ...common,
    entryPoints: [path.join(root, 'src/main/main.ts')],
    outfile: path.join(dist, 'main.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron', 'koffi'],
  }),
  build({
    ...common,
    entryPoints: [path.join(root, 'src/preload/preload.ts')],
    outfile: path.join(dist, 'preload.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
  }),
  build({
    ...common,
    entryPoints: surfaces.flatMap((s) => [
      { in: path.join(root, `src/renderer/${s}/${s}.ts`), out: s },
      { in: path.join(root, `src/renderer/${s}/${s}.css`), out: s },
    ]),
    outdir: path.join(dist, 'renderer'),
    platform: 'browser',
    format: 'iife',
    target: 'chrome130',
    minify: !watch,
  }),
]);

for (const s of surfaces) {
  await cp(path.join(root, `src/renderer/${s}/${s}.html`), path.join(dist, 'renderer', `${s}.html`));
}
if (existsSync(path.join(root, 'resources/icons'))) {
  await cp(path.join(root, 'resources/icons'), path.join(dist, 'icons'), { recursive: true });
}
console.log('Orelle build ok →', path.relative(root, dist));
