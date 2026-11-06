/** Offline host for the same panel mounted by DSH. Never opens platform pages or submits work. */
import {mountWorkbench} from './ui/workbench.mjs';
import {markRevisions, revisePrompt} from './authoring.mjs';
import {compilePlan, createDemoPlan, dryRun, isPlanDocument} from './orchestration/core.mjs';

const {project, projectKey, assets, observation} = JSON.parse(document.getElementById('snapshot').textContent);
const images = new Map(Object.entries(assets).map(([hash, asset]) => {
  const bytes = Uint8Array.from(atob(asset.bytes), c => c.charCodeAt(0));
  return [hash, URL.createObjectURL(new Blob([bytes], {type:asset.mime}))];
}));
const key = 'xatp.workflow.v2.' + projectKey;
const initial = {revision:0, plan:createDemoPlan(), receipts:[]};
let inMemory = initial;
let storage;
try {storage = window.localStorage;} catch { /* File URLs may have no storage. */ }

function readPlan() {
  const stored = storage?.getItem(key);
  return structuredClone(stored === null || stored === undefined ? inMemory : JSON.parse(stored));
}

function replacePlan(next) {
  if (storage) storage.setItem(key, JSON.stringify(next));
  inMemory = structuredClone(next);
  return structuredClone(next);
}

const workflow = {
  read:async () => readPlan(),
  save:async (plan, expectedVersion) => {
    const prior = readPlan();
    if (!isPlanDocument(plan)) throw new Error('INVALID_WORKFLOW_PLAN');
    if (expectedVersion !== prior.revision) throw new Error('VERSION_CONFLICT');
    return replacePlan({plan,revision:prior.revision+1,receipts:[]});
  },
  compile:async (plan,targetId) => compilePlan(plan,{targetId}),
  run:async (plan,targetId,mode = 'dry-run') => {
    if (mode !== 'dry-run') throw new Error('OFFLINE_PREVIEW');
    const result = await dryRun(plan,{targetId});
    const current = readPlan();
    if (result.ok && JSON.stringify(current.plan) === JSON.stringify(plan)) {
      const receipts = new Map([...current.receipts,...result.receipts].map(r=>[r.nodeId,r]));
      replacePlan({...current,receipts:[...receipts.values()]});
    }
    return result;
  },
};
const editPrompt = async args => {
  const record = {...revisePrompt(project.records,args),version:args.expectedVersion+1,recordedAt:new Date().toISOString()};
  project.records = markRevisions([...project.records,record]);
  return {id:record.id,version:record.version};
};
mountWorkbench(document.querySelector('body > main'), {
  locale:'zh-CN',read:async()=>project,previewURL:hash=>images.get(hash),
  editPrompt,editScope:'session',workflow,observation,offline:true,
});
window.addEventListener('pagehide', e => {
  if (!e.persisted) images.forEach(url=>URL.revokeObjectURL(url));
});
