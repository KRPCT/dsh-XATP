import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {initWorkspace} from '../workspace.mjs';
import {compilePlan,createDemoPlan,dryRun} from './core.mjs';
import {createWorkflowHost} from './host.mjs';

function timeline(seconds) {
  const plan = createDemoPlan();
  const prompt = plan.nodes[0], sink = plan.nodes[2], clips = [];
  plan.edges = [];
  plan.timeline = [];
  for (let i=0; i<seconds.length; i++) {
    const id = 'shot-'+i;
    clips.push({...plan.nodes[1],id,params:{...plan.nodes[1].params,seconds:15}});
    plan.edges.push({from:prompt.id,out:'text',to:id,in:'prompt'},{from:id,out:'clip',to:sink.id,in:'clips'});
    plan.timeline.push({nodeId:id,seconds:seconds[i]});
  }
  plan.nodes = [sink,...clips,prompt];
  return plan;
}
test('finish duration uses connected timeline placements, while partial rehearsal resolves the upstream text',()=>{
  const plan = createDemoPlan();
  const whole = compilePlan(plan);
  assert.equal(whole.durationSeconds,5);
  assert.equal(whole.durationValid,false);
  const one = dryRun(plan,{targetId:'updream-01'});
  assert.equal(one.ok,true);
  assert.deepEqual(one.order,['prompt-01','updream-01']);
  assert.equal(one.receipts.at(-1).prompt,plan.nodes[0].params.text);
  for (const [last,valid] of [[4,false],[5,true],[13,true],[14,false]]) {
    assert.equal(compilePlan(timeline([...Array(7).fill(15),last])).ok,valid);
  }
  const broken = timeline([...Array(7).fill(15),8]);
  broken.edges.pop();
  assert.equal(compilePlan(broken).durationValid,false);
});
test('invalid edges, model, unverifiable quote and project target fail compilation',()=>{
  const fails = change => {
    const plan = createDemoPlan();
    change(plan);
    assert.equal(compilePlan(plan,{targetId:'updream-01'}).ok,false);
  };
  fails(p=>p.edges[0].out='clip');
  fails(p=>p.edges.push({...p.edges[0]}));
  fails(p=>p.nodes[1].params.model='MiniMax H3 Max');
  fails(p=>p.nodes[1].params.referenceSeconds=.5);
  fails(p=>p.targetSeconds=119);
  fails(p=>p.nodes[1].params.operation='click');
});
test('lost draft response reconciles by exact readback after host restart without a second write',async t=>{
  const dir = mkdtempSync(join(tmpdir(),'xatp-draft-recover-'));
  t.after(()=>rmSync(dir,{force:true,recursive:true}));
  initWorkspace(dir,'unit');
  const plan = createDemoPlan();
  let editor = '',writes = 0;
  const getBrowser = () => ({invoke:async ({operation,prompt})=>{
    if (operation==='read_prompt') return {readback:editor,surface:'video',creditsSpent:0};
    assert.equal(operation,'prepare_prompt');
    writes++;
    editor = prompt;
    throw new Error('DISCONNECTED');
  }});
  const host = createWorkflowHost(dir,getBrowser);
  assert.equal(host.save({plan,revision:0}).revision,1);
  assert.throws(()=>host.save({plan,revision:0}),/VERSION_CONFLICT/);
  const request = {mode:'live',targetId:'updream-01',binding:{tabId:'T',documentId:'D',toolId:'E'}};
  await assert.rejects(host.run(request),/DISCONNECTED/);
  const restored = createWorkflowHost(dir,getBrowser);
  assert.equal(restored.read().receipts[0].status,'pending');
  const result = await restored.run(request);
  assert.equal(result.receipts.at(-1).status,'verified');
  assert.equal(restored.read().receipts.at(-1).creditsSpent,0);
  assert.equal(writes,1);
  editor = 'unrelated text';
  assert.deepEqual((await restored.run(request)).errors,['DRAFT_CONFLICT']);
  assert.equal(writes,1);
});
test('unknown mode, H3 Max, paid generation and budget spoof cannot reach browser',async t=>{
  const dir = mkdtempSync(join(tmpdir(),'xatp-budget-'));
  t.after(()=>rmSync(dir,{force:true,recursive:true}));
  initWorkspace(dir,'unit');
  const host = createWorkflowHost(dir,()=>assert.fail('browser contacted during refused execution'));
  const plan = createDemoPlan(), targetId = 'updream-01';
  plan.nodes[1].params.operation = 'generate_video';
  assert.throws(()=>host.save({plan:{...plan,budget:10000},revision:0}),/INVALID_WORKFLOW_PLAN/);
  host.save({plan,revision:0});
  const denied = await host.run({targetId,mode:'live'});
  assert.match(denied.errors[0],/GENERATION_BLOCKED/);
  assert.equal(denied.estimates[targetId].credits,250);
  assert.equal(denied.estimates[targetId].withinOverallLimit,false);
  await assert.rejects(host.run({targetId,mode:'force'}),/INVALID_RUN_MODE/);
  plan.nodes[1].params.model = 'MiniMax H3 Max';
  assert.equal((await host.run({targetId,mode:'live',plan})).ok,false);
});
