/** Drive the packaged plugin through Cordis, DSH's registry and real native tool executor. */
import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRehearsal } from '../rehearsal.mjs';
import { readBlob } from '../workspace.mjs';
import * as workbench from '@xatp/workbench';

const require = createRequire(new URL('../../../packages/core/tools/package.json',import.meta.url));
const { Context } = require('@deepseek-ai/cordis');
const { default: SystemPrompt } = require('@deepseek-ai/dsh-system-prompt');
const { default: Tools } = require('@deepseek-ai/dsh-tools');
const NativeExecutor = require('@deepseek-ai/dsh-tool-executor-native');

test('native tools share versioned project state and reject stale revisions', {timeout:30_000}, async t => {
  const directory = await mkdtemp(join(tmpdir(),'xatp-native-'));
  const ctx = new Context();
  t.after(async () => { try { await ctx.fiber.dispose(); } finally { await rm(directory,{recursive:true,force:true}); } });
  const manifest = await createRehearsal(directory);
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(Tools);
  await ctx.plugin(NativeExecutor);
  await ctx.plugin(workbench,{directory});
  let seq = 0;
  async function execute(name,args = {}) {
    const batch = await ctx.tools.execute({calls:[{type:'tool-call',id:String(++seq),name,arguments:JSON.stringify(args)}], signal:t.signal});
    const { result } = batch.results[0];
    assert.equal(result.isError, false, JSON.stringify(result.content));
    return JSON.parse(result.content[0].text);
  }
  assert.deepEqual(ctx.tools.schemas().map(s => s.name).sort(),[
    'xatp_configure_h3_minimum','xatp_discover','xatp_edit_prompt','xatp_export_shot','xatp_inspect','xatp_list_tabs',
    'xatp_orchestration_compile','xatp_orchestration_read','xatp_orchestration_run','xatp_orchestration_save',
    'xatp_quote_h3','xatp_read_workspace','xatp_render_roc_draft','xatp_select_h3','xatp_select_h3_mode',
  ]);
  const workflow = await execute('xatp_orchestration_read');
  const saved = await execute('xatp_orchestration_save',{plan:workflow.plan,revision:workflow.revision});
  assert.equal(saved.revision,workflow.revision+1);
  const slice = await execute('xatp_orchestration_run',{targetId:'updream-01',mode:'dry-run'});
  assert.equal(slice.estimates['updream-01'].credits,250);
  assert.equal(slice.receipts.at(-1).prompt,workflow.plan.nodes[0].params.text);
  await assert.rejects(execute('xatp_orchestration_save',{plan:workflow.plan,revision:workflow.revision}),/VERSION_CONFLICT/);
  const state = await execute('xatp_read_workspace');
  const prompt = state.records.find(r => r.kind === 'prompt');
  const shot = await execute('xatp_export_shot',manifest.shot);
  assert.deepEqual(shot,manifest);
  const render = overrides => execute('xatp_render_roc_draft',{id:'d.native',expectedVersion:0,promptId:prompt.id,
    promptVersion:prompt.version,dataClass:'simulated',rows:[[.1,0],[.9,1]],...overrides});
  const first = await render({});
  const rows = [[.3,1],[.3,0],[.9,1]];
  const second = await render({expectedVersion:1,rows});
  assert.equal(second.version,2);
  assert.deepEqual(second.inputs,[{id:prompt.id,version:prompt.version}]);
  assert.notEqual(first.data.blob,second.data.blob);
  assert.notEqual(first.data.samplesHash,second.data.samplesHash);
  assert.equal(first.data.rendererHash,second.data.rendererHash);
  const svg = readBlob(directory,second.data.blob).toString();
  assert.match(svg,/3 个模拟样本/);
  assert.match(svg,/2 个阳性 · 1 个阴性/);
  assert.deepEqual(JSON.parse(readBlob(directory,second.data.samplesHash)),rows);
  assert.deepEqual(readBlob(directory,second.data.rendererHash),await readFile(new URL('../roc-renderer.mjs',import.meta.url)));
  await assert.rejects(render({expectedVersion:2,rows:[[1,0],[2,0]]}),/BOTH_CLASSES_REQUIRED/);
  await assert.rejects(render({expectedVersion:2,rows:[[.2,0],[null,1]]}),/INVALID_SIMULATED_ROWS/);
  await assert.rejects(render({expectedVersion:2,dataClass:'clinical'}),/SIMULATED_DATA_ONLY/);
  await assert.rejects(render({}),/VERSION_CONFLICT/);
  const revision = await execute('xatp_edit_prompt',{id:prompt.id, expectedVersion:prompt.version,text:prompt.data.text + '!',creativeRationale:prompt.data.creativeRationale});
  assert.equal(revision.version,prompt.version+1);
  await assert.rejects(render({expectedVersion:2}),/STALE_INPUT/);
  const changed = await execute('xatp_read_workspace');
  assert.ok(changed.records.find(r => r.kind === 'shot').stale);
  await assert.rejects(execute('xatp_export_shot',manifest.shot),/CURRENT_SHOT_REQUIRED/);
  // Opt in with a consciously selected, empty video node on an authenticated canvas.
  // Check the exact minimum live quote before any draft edit. No model/quote/target identifiers enter logs.
  if (process.env.XATP_TEST_UPDREAM_DRAFT_TAB) {
    const tabId = process.env.XATP_TEST_UPDREAM_DRAFT_TAB;
    assert.ok((await execute('xatp_list_tabs')).some(tab=>tab.providerId==='updream' && tab.tabId===tabId),'Selected canvas is unavailable');
    const {documentId,tools} = await execute('xatp_discover',{tabId,providerId:'updream'});
    function bind(surface,operation) {
      const matches = tools.filter(tool=>tool.surface===surface && tool.operations.includes(operation));
      assert.equal(matches.length,1,'Require a unique discovered '+surface+' control');
      return {tabId,documentId,toolId:matches[0].toolId};
    }
    const quote = await execute('xatp_quote_h3',{binding:bind('video_settings','inspect_h3_quote')});
    assert.equal(quote.model,'MiniMax H3');
    assert.equal(quote.resolution,'768P');
    assert.equal(quote.seconds,5);
    assert.equal(quote.displayedCredits,250);
    const settings = tools.find(t=>t.surface==='video_settings' && t.operations.includes('select_h3_mode'));
    assert.ok(settings?.h3Modes.available.includes(settings?.h3Modes.selected),'Require a verified active H3 mode');
    // Read back the current mode through the native tool without changing the project's setting.
    const mode = await execute('xatp_select_h3_mode',{binding:bind('video_settings','select_h3_mode'),mode:settings.h3Modes.selected});
    assert.equal(mode.model,quote.model);
    assert.equal(mode.mode,settings.h3Modes.selected);
    assert.equal(mode.creditsSpent,0);
    const request = {targetId:'updream-01',mode:'live',binding:bind('video','prepare_prompt')};
    for (let check = 0; check < 2; check++) {
      const live = await execute('xatp_orchestration_run',request);
      assert.equal(live.ok,true,live.errors.join(' '));
      const receipt = live.receipts.find(r=>r.nodeId===request.targetId);
      assert.equal(receipt.status,'verified');
      assert.equal(receipt.prompt,saved.plan.nodes[0].params.text);
      assert.equal(receipt.creditsSpent,0);
    }
    t.diagnostic('Authenticated MiniMax H3 video editor verified exact draft readback and retry; minimum quote 250; no generation.');
  }
  if (process.env.XATP_TEST_PUBLIC_PROVIDER) {
    const providerId = process.env.XATP_TEST_PUBLIC_PROVIDER;
    const tab = (await execute('xatp_list_tabs')).find(row => row.providerId === providerId);
    assert.ok(tab,'Open an enrolled provider page before running the live smoke.');
    const {documentId,tools} = await execute('xatp_discover',{tabId:tab.tabId,providerId});
    const target = tools.find(tool => tool.role === 'button' && tool.operations.includes('inspect'));
    assert.ok(target,'Expected a discoverable, read-only control.');
    const details = await execute('xatp_inspect',{tabId:tab.tabId,providerId,documentId,toolId:target.toolId,operation:'inspect'});
    assert.deepEqual(details,target);
    const evidence = {providerId,url:tab.url,controlsOnPage:tools.length,inspected:target.name,role:target.role};
    if (process.env.XATP_TEST_PUBLIC_PREVIEW === '1') {
      const inventory = await execute('xatp_inspect',{tabId:tab.tabId,providerId,documentId,toolId:'page',operation:'collect_assets'});
      const video = inventory.media.find(m => m.kind === 'video');
      evidence.publicPreview = video ? {hostname:video.hostname,duration:video.duration,width:video.width,height:video.height,readyState:video.readyState} : null;
      evidence.exportableLinks = inventory.items.length;
    }
    t.diagnostic(JSON.stringify(evidence));
  }
});
