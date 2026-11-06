/** Package both native entries offline using the compiler already locked by DSH. */
import { copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { build } = createRequire(new URL('../../../packages/boot/hmr/package.json',import.meta.url))('esbuild');
const directory = fileURLToPath(new URL('.',import.meta.url));
await build({absWorkingDir:directory,entryPoints:['index.mjs'],outfile:'dist/host.mjs',platform:'node',target:'node24',format:'esm',bundle:true,external:['./roc-renderer.mjs']});
await copyFile(new URL('../roc-renderer.mjs',import.meta.url),new URL('./dist/roc-renderer.mjs',import.meta.url));
await build({absWorkingDir:directory,entryPoints:['client.mjs'],outfile:'dist/client.js',platform:'browser',format:'iife',bundle:true,
  loader:{'.css':'text'},logLevel:'warning'});
