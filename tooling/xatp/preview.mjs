/** Produce a portable, offline review of the actual panel and a rehearsal workspace. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readWorkspace, readBlob } from './workspace.mjs';

export function writePreview(directory, filename) {
  const project = readWorkspace(directory);
  if (project.mode !== 'demo') throw new Error('ONLY_REHEARSALS_CAN_BE_EMBEDDED');
  const safe = v => JSON.stringify(v).replaceAll('<','\\u003c');
  const ui = new URL('./ui/', import.meta.url), imports = {}, assets = {};
  imports['xatp/authoring'] = 'data:text/javascript;base64,'+readFileSync(new URL('./authoring.mjs',import.meta.url)).toString('base64');
  for (const file of readdirSync(ui).filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))) {
    const src = readFileSync(new URL(file,ui),'utf8').replace(/from '([.][/][^']+[.]mjs)'/g,(_,s) => "from 'xatp/" + basename(s) + "'");
    imports['xatp/'+file] = 'data:text/javascript;base64,'+Buffer.from(src).toString('base64');
  }
  for (const r of project.records.filter(r => ['draft','asset'].includes(r.kind) && r.data.blob)) {
    assets[r.data.blob] = { mime:r.data.mime, bytes:readBlob(directory,r.data.blob).toString('base64') };
  }
  const css = readFileSync(new URL('workbench.css',ui),'utf8');
  const observation = JSON.parse(readFileSync(new URL('./browser/observations.json',import.meta.url),'utf8'));
  const code = `import {mountWorkbench} from 'xatp/workbench.mjs';
import {markRevisions,revisePrompt} from 'xatp/authoring';
const data = JSON.parse(document.querySelector('#snapshot').textContent);
const images = new Map(Object.entries(data.assets).map(([hash,v]) => [hash,URL.createObjectURL(new Blob([Uint8Array.from(atob(v.bytes), c => c.charCodeAt(0))],{type:v.mime}))]));
const editPrompt = async args => {
  const record = {...revisePrompt(data.project.records,args),version:args.expectedVersion+1,recordedAt:new Date().toISOString()};
  data.project.records = markRevisions([...data.project.records,record]);
  return {id:record.id,version:record.version};
};
mountWorkbench(document.querySelector('main'), {locale:'zh-CN',read:async()=>data.project,previewURL:h=>images.get(h),editPrompt,editScope:'session',observation:data.observation});
window.addEventListener('pagehide',()=>images.forEach(url=>URL.revokeObjectURL(url)),{once:true});`;
  writeFileSync(filename,'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>XATP · 镜头工作台</title><style>html{color-scheme:light dark}body{margin:0;background:Canvas}main{min-height:100dvh;display:grid}'+css+'</style><script type="importmap">'+safe({imports})+'</script><main></main><script type="application/json" id="snapshot">'+safe({project,assets,observation})+'</script><script type="module">'+code+'</script></html>');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2] || !process.argv[3]) throw new Error('Use: node preview.mjs <rehearsal directory> <output.html>');
  writePreview(process.argv[2],process.argv[3]);
}
