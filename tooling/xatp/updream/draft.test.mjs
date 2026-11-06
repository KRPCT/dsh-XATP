/** Browser contract tests. Every URL is intercepted locally and the browser has a disposable profile. */
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createBrowserAdapter} from '../browser/index.mjs';

const {chromium} = createRequire(new URL('../../../apps/web/package.json',import.meta.url))('playwright');
const fixture = `<!doctype html><meta charset=utf-8><main>
<div class="chatComposer_abcd"><div contenteditable=true></div><button disabled>发送</button></div>
<div class="canvas-node canvas-node-video selected" data-node-id="local-private-selected-id"></div>
<div data-video-prompt-panel class=prompt-editor-wrap><div class=ProseMirror contenteditable=true></div>
  <button data-testid=video-panel-type-ref2v aria-pressed=true>参考生视频</button>
  <button data-testid=video-panel-type-i2v aria-pressed=false>图生视频</button>
  <button data-testid=video-panel-type-firstlast aria-pressed=false disabled>首尾帧</button>
  <button data-testid=video-panel-type-t2v aria-pressed=false>文生视频</button>
  <button data-testid=video-panel-type-other aria-pressed=false>视频编辑</button>
</div>
<button role=combobox aria-label="节点类型">视频生成</button>
<button role=combobox aria-label="模型" aria-controls="model-list" aria-expanded=false id=model>MiniMax H3 Max</button>
<div role=listbox id=model-list hidden>
  <button role=option id=max data-testid=video-panel-model-option-hailuo-h3-max><span class=modelOptionLabel>MiniMax H3 Max</span></button>
  <button role=option id=h3 data-testid=video-panel-model-option-hailuo-h3><span class=modelOptionLabel>MiniMax H3</span> 多参数控制，参考生视频，性价比高</button>
</div>
<button id=options>16:9 / 5S / 2K</button>
<section hidden><input type=number data-testid=video-options-duration-input aria-label=时长 min=5 max=15 value=5>
<button data-testid=video-options-opt-resolution-768P id=quality>768P</button></section>
<div><span class=creditHint_abc>425</span><button title=生成 data-testid=video-panel-generate id=generate>生成</button></div>
<textarea>feedback</textarea><input value="project"><script>
window.sent = 0; window.edited = 0;
for (const button of document.querySelectorAll('button[aria-pressed]')) {
  button.onclick = () => {
    if (button.dataset.testid.endsWith('other')) window.sent++;
    for (const el of document.querySelectorAll('button[aria-pressed]')) el.setAttribute('aria-pressed',String(el === button));
  };
}
const byId=id=>document.getElementById(id);
byId('model').onclick=()=>{byId('model-list').hidden=false;byId('model').setAttribute('aria-expanded','true')};
byId('h3').onclick=()=>{byId('model').innerText='MiniMax H3';byId('model-list').hidden=true;byId('model').setAttribute('aria-expanded','false')};
byId('max').onclick=()=>{window.sent++};
byId('options').onclick=()=>document.querySelector('section').hidden=false;
const duration=document.querySelector('input[type=number]');
const sync=()=>{const low=byId('quality').className.includes('vopTabItemActive');
  byId('options').innerText='16:9 / '+duration.value+'S / '+(low?'768P':'2K');
  document.querySelector('span[class*=creditHint]').innerText=String((low?50:85)*Number(duration.value))};
byId('quality').onclick=()=>{byId('quality').className='vopTabItemActive';sync()};
duration.oninput=sync;
document.addEventListener('keydown',e=>{if(e.key==='Enter')window.sent++});
document.querySelector('.chatComposer_abcd').oninput = () => document.querySelector('button').disabled = false;
document.querySelector('.prompt-editor-wrap').oninput = () => window.edited++;
document.querySelector('button').onclick = document.querySelector('#generate').onclick = () => window.sent++;
</script></main>`;

test('prepares only bound Updream drafts, rejects stale projects and preserves unrelated fields', {timeout:22000}, async () => {
  const dir = await mkdtemp(join(tmpdir(),'xatp-draft-test-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(dir,{executablePath:process.env.CHROMIUM_BIN,
      args:['--remote-debugging-port=0','--disable-background-networking'],serviceWorkers:'block',timeout:7000});
    const port = (await readFile(join(dir,'DevToolsActivePort'),'utf8')).split('\n')[0];
    const adapter = createBrowserAdapter({endpoint:'http://127.0.0.1:'+port});
    const page = context.pages()[0];
    let routed = 0;
    await context.route('**/*',route => {
      routed++;
      return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fixture});
    });
    await page.goto('https://www.updream.cn/canvas?project=fixture');
    const [tab] = await adapter.listTabs();
    assert.equal(tab.url,'https://www.updream.cn/canvas');
    const directory = await adapter.discover(tab);
    assert.doesNotMatch(JSON.stringify(directory),/local-private-selected-id/);
    const agent = directory.tools.find(t => t.surface === 'agent');
    assert.ok(agent);
    assert.ok(!directory.tools.some(t => t.surface === 'video'));
    const invoke = (tool,operation,extra={}) => adapter.invoke({...tab,documentId:directory.documentId,toolId:tool.toolId,operation,...extra});
    const prompt = '本地夹具：镜头一\n镜头二 <保留标点>';
    assert.deepEqual(await invoke(agent,'prepare_prompt',{prompt}),{surface:'agent',readback:prompt,exactMatch:true,creditsSpent:0});
    assert.equal(await page.getByText('发送',{exact:true}).isEnabled(),true);
    await assert.rejects(()=>invoke(agent,'prepare_prompt',{prompt:'覆盖'}),{code:'draft_conflict'});
    assert.equal((await invoke(agent,'prepare_prompt',{prompt:'已修改',expectedCurrentText:prompt})).readback,'已修改');
    await assert.rejects(()=>invoke(agent,'send'),{code:'operation_blocked'});
    await assert.rejects(()=>invoke(agent,'generate_video'),{code:'operation_blocked'});
    const settings = directory.tools.find(t=>t.surface==='video_settings');
    assert.ok(settings);
    assert.equal(settings.h3Modes,undefined);
    assert.ok(!settings.operations.includes('select_h3_mode'));
    await assert.rejects(()=>invoke(settings,'inspect_h3_quote'),{code:'h3_not_selected'});
    assert.deepEqual(await invoke(settings,'select_h3'),{surface:'video_settings',model:'MiniMax H3',creditsSpent:0});
    const h3 = (await adapter.discover(tab)).tools.find(t=>t.surface==='video_settings');
    assert.deepEqual(h3.h3Modes,{available:['参考生视频','图生视频','文生视频'],selected:'参考生视频'});
    assert.ok(h3.operations.includes('select_h3_mode'));
    for (const mode of ['首尾帧','视频编辑','全能参考']) {
      await assert.rejects(()=>invoke(h3,'select_h3_mode',{mode}),{code:'h3_mode_unavailable'});
    }
    const raw=await invoke(h3,'inspect_h3_quote');
    assert.deepEqual([raw.quoteMode,raw.quoteStatus,raw.displayedCredits],['参考生视频','observed_only',425]);
    await assert.rejects(()=>invoke(h3,'configure_h3_minimum'),{code:'h3_text_mode_required'});
    assert.deepEqual(await invoke(h3,'select_h3_mode',{mode:'文生视频'}),{surface:'video_settings',model:'MiniMax H3',mode:'文生视频',creditsSpent:0});
    assert.equal((await adapter.discover(tab)).tools.find(t=>t.surface==='video_settings').h3Modes.selected,'文生视频');
    const base = {surface:'video_settings',model:'MiniMax H3',creditsSpent:0,seconds:5,quoteMode:'文生视频',quoteStatus:'matched_no_reference_tariff'};
    assert.deepEqual(await invoke(settings,'inspect_h3_quote'),{...base,resolution:'2K',displayedCredits:425});
    // Exercise duration entry as well as quality. The test UI recomputes its displayed quote on real input.
    await page.getByRole('button',{name:'16:9 / 5S / 2K'}).click();
    await page.getByLabel('时长').fill('10');
    assert.deepEqual(await invoke(settings,'configure_h3_minimum'),{...base,resolution:'768P',displayedCredits:250});
    const price = page.locator('.creditHint_abc');
    await price.evaluate(el=>{el.textContent='230';setTimeout(()=>{el.textContent='250';},150);});
    assert.deepEqual(await invoke(settings,'inspect_h3_quote'),{...base,resolution:'768P',displayedCredits:250});
    await price.evaluate(el=>{el.textContent='230';});
    await assert.rejects(()=>invoke(settings,'inspect_h3_quote'),{code:'quote_unconfirmed'});
    await price.evaluate(el=>{el.textContent='250';});
    const video = (await adapter.discover(tab)).tools.find(t=>t.surface==='video');
    assert.ok(video);
    assert.equal((await invoke(video,'prepare_prompt',{prompt})).readback,prompt);
    const counts = await page.evaluate(()=>({sent:window.sent,edited:window.edited > 0,feedback:document.querySelector('textarea').value,
      title:document.querySelector('input:not([type=number])').value,agent:document.querySelector('[class*=chatComposer] [contenteditable]').innerText}));
    assert.deepEqual(counts,{sent:0,edited:true,feedback:'feedback',title:'project',agent:'已修改'});
    assert.equal(routed,1);
    // The floating panel is reused when a different graph node is selected.
    await price.evaluate(el=>{el.textContent='230';});
    const stale=assert.rejects(()=>invoke(settings,'inspect_h3_quote'),{code:'stale_tool'});
    await page.evaluate(()=>setTimeout(()=>{document.querySelector('[data-node-id]').dataset.nodeId='local-reused-node';},80));
    await stale;
    await assert.rejects(()=>invoke(settings,'configure_h3_minimum'),{code:'stale_tool'});
    await assert.rejects(()=>invoke(video,'prepare_prompt',{prompt:'wrong node',expectedCurrentText:prompt}),{code:'stale_tool'});
    const rebound = (await adapter.discover(tab)).tools.find(t=>t.surface==='video');
    await page.evaluate(()=>document.querySelector('[data-node-id]').replaceWith(document.querySelector('[data-node-id]').cloneNode(true)));
    await assert.rejects(()=>invoke(rebound,'read_prompt'),{code:'stale_tool'});
    await assert.rejects(()=>invoke(video,'read_prompt'),{code:'stale_tool'});
    await page.evaluate(()=>history.replaceState(null,'','/canvas?project=other'));
    await assert.rejects(()=>invoke(agent,'read_prompt'),{code:'stale_document'});
    await page.goto('https://www.updream.cn/login');
    assert.ok(!(await adapter.discover(tab)).tools.some(t=>t.operations.includes('prepare_prompt')));
  } finally {
    await context?.close();
    await rm(dir,{recursive:true,force:true,maxRetries:3});
  }
});
