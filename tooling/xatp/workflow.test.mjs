import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRehearsal,localRenderer} from './rehearsal.mjs';
import {submitGeneration,reconcileGeneration,getJob,recordCollectedRun} from './generation.mjs';
import {editPrompt,exportShot,readWorkspace,recordRevision} from './workspace.mjs';

test('frozen shot, uncertain receipt, capability refusal and selective revision invalidation',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'xatp-workflow-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const frozen=await createRehearsal(directory);
  assert.equal(frozen.mode,'demo');
  assert.equal(frozen.records.find(r=>r.kind==='source').data.doi,'10.1016/j.patrec.2005.10.010');
  const prompt=frozen.records.find(r=>r.kind==='prompt'),draft=frozen.records.find(r=>r.kind==='draft');
  const args={id:'take02',prompt,draft,parameters:{seconds:6}};
  let submits=0, receipt;
  const disconnected={...localRenderer,id:'alternate-free-rehearsal',
    async submit(input) { submits++; receipt=await localRenderer.submit(input); throw new Error('response lost'); },
    async lookup(requestId) { return requestId===receipt.requestId ? receipt : null; }
  };
  await assert.rejects(submitGeneration(directory,args,{...disconnected,referenceImage:false}),/PROVIDER_UNAVAILABLE/);
  await assert.rejects(submitGeneration(directory,args,{...disconnected,cost:'metered'}),/BUDGET_REQUIRED/);
  assert.equal(getJob(directory,args.id),null);
  await assert.rejects(submitGeneration(directory,args,disconnected),/response lost/);
  assert.equal((await submitGeneration(directory,args,disconnected)).status,'unconfirmed');
  assert.equal(submits,1);
  await assert.rejects(submitGeneration(directory,{...args,parameters:{seconds:12}},disconnected),/INTENT_CONFLICT/);
  await assert.rejects(reconcileGeneration(directory,args.id,{...disconnected,lookup:async()=>({...receipt,text:'changed'})}),/RECEIPT_MISMATCH/);
  assert.equal((await reconcileGeneration(directory,args.id,disconnected)).status,'collected');
  assert.equal(recordCollectedRun(directory,args.id).version,recordCollectedRun(directory,args.id).version);
  assert.equal(submits,1);
  const bare=recordRevision(directory,{id:'no-citation',kind:'prompt',title:'缺失引用',inputs:[],data:{text:'无依据',creativeRationale:'演示'}},0);
  const ungrounded=recordRevision(directory,{id:'unbound-draft',kind:'draft',title:'无依据图',inputs:[bare],data:draft.data},0);
  await assert.rejects(submitGeneration(directory,{id:'blocked',prompt:bare,draft:ungrounded},disconnected),/CLAIM_AND_RATIONALE_REQUIRED/);
  assert.equal(getJob(directory,'blocked'),null);
  const edited=editPrompt(directory,{id:prompt.id,expectedVersion:1,text:'降低阈值，逐个显示新的点。',creativeRationale:'镜头固定'});
  assert.equal(edited.version,2);
  assert.equal(edited.data.reviewStatus,'needs-review');
  assert.throws(()=>editPrompt(directory,{id:prompt.id,expectedVersion:1,text:'旧编辑',creativeRationale:'旧编辑'}),/VERSION_CONFLICT/);
  const records=readWorkspace(directory).records;
  assert.equal(records.find(r=>r.id===draft.id).stale,true);
  assert.equal(records.find(r=>r.kind==='source').stale,false);
  assert.throws(()=>exportShot(directory,frozen.shot),/CURRENT_SHOT_REQUIRED/);
  assert.equal(frozen.records.find(r=>r.kind==='prompt').version,1);
});
