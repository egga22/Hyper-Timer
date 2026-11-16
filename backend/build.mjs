import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('dist-backend', { recursive: true });
await build({ entryPoints: ['backend/index.mjs'], outfile: 'dist-backend/index.mjs', bundle: true, platform: 'node', target: 'node24', format: 'esm', banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } });
await writeFile('dist-backend/package.json', '{"type":"module"}');
