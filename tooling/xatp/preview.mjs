/** Produce a portable, offline review of the actual panel and a rehearsal workspace. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readWorkspace, readBlob } from './workspace.mjs';

export function writePreview(directory, filename) {
  const project = readWorkspace(directory);
  if (project.mode !== 'demo') throw new Error('ONLY_REHEARSALS_CAN_BE_EMBEDDED');
  const safe = v => JSON.stringify(v).replaceAll('<','\\u003c');
  const assets = {};
  const {buildSync} = createRequire(new URL('../../packages/boot/hmr/package.json',import.meta.url))('esbuild');
  const build = (entry) => buildSync({
    entryPoints:[fileURLToPath(new URL(entry,import.meta.url))],
    bundle:true, write:false, platform:'browser', format:'iife', target:'es2022', minify:true,
  }).outputFiles[0].text;
  for (const r of project.records.filter(r => ['draft','asset'].includes(r.kind) && r.data.blob)) {
    assets[r.data.blob] = { mime:r.data.mime, bytes:readBlob(directory,r.data.blob).toString('base64') };
  }
  const css = build('./ui/workbench.css');
  const code = build('./preview-client.mjs').replace(/<\/script/gi,'<\\/script');
  const observation = JSON.parse(readFileSync(new URL('./browser/observations.json',import.meta.url),'utf8'));
  const projectKey = createHash('sha256').update(JSON.stringify(project)).digest('hex').slice(0,18);
  const payload = safe({project,projectKey,assets,observation});
  writeFileSync(filename,`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>XATP · 制作工作台</title><style>html{color-scheme:light dark}body{margin:0;background:Canvas}main{height:100dvh;min-width:0;display:grid}${css}</style><main></main><script type="application/json" id="snapshot">${payload}</script><script>${code}</script></html>`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2] || !process.argv[3]) throw new Error('Use: node preview.mjs <rehearsal directory> <output.html>');
  writePreview(process.argv[2],process.argv[3]);
}
