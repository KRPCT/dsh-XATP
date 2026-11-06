import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createBrowserAdapter} from '../browser/index.mjs';
import {initWorkspace} from '../workspace.mjs';
import * as workbench from '../plugin/dist/host.mjs';

const require=createRequire(new URL('../../../packages/core/tools/package.json',import.meta.url));
const {Context}=require('@deepseek-ai/cordis');
const {default:SystemPrompt}=require('@deepseek-ai/dsh-system-prompt');
const {default:Tools}=require('@deepseek-ai/dsh-tools');
const NativeExecutor=require('@deepseek-ai/dsh-tool-executor-native');

const {chromium}=createRequire(new URL('../../../apps/web/package.json',import.meta.url))('playwright');
const fixture=`<meta charset=utf-8><div class="canvas-node canvas-node-text selected" data-node-id="test-node">
  <div data-text-node-scroll=true data-testid=node-text-test-node><div>双击编辑文本...</div></div>
</div><button id=generate>生成</button><script>
window.saves=0;window.paid=0;
generate.onclick=()=>window.paid++;
document.addEventListener('dblclick',e=>{
  const wrap=e.target.closest('[data-testid="node-text-test-node"]');
  if(!wrap || document.querySelector('[data-testid=text-edit-modal]')) return;
  const modal=document.createElement('section');
  modal.dataset.testid='text-edit-modal';
  modal.innerHTML='<div class="tiptap ProseMirror" role=textbox contenteditable=true></div><button data-testid=text-edit-modal-save type=button>保存</button>';
  const editor=modal.firstElementChild;
  editor.innerHTML=wrap.querySelector('[data-text-preview-content]')?.innerHTML || '<p><br></p>';
  document.body.append(modal);
  modal.lastElementChild.onclick=()=>{
    const body=document.createElement('div');body.dataset.textPreviewContent='true';
    body.innerHTML=editor.innerHTML;
    wrap.removeAttribute('data-text-node-scroll');
    wrap.className='_markdownPreview_sample';
    wrap.replaceChildren(body);
    wrap.parentElement.replaceWith(wrap.parentElement.cloneNode(true));
    modal.remove();window.saves++;
  };
});
</script>`;

test('native canvas text saves are conditional on the selected node and its unformatted body', {timeout:20000},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'xatp-text-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const context=await chromium.launchPersistentContext(dir,{executablePath:process.env.CHROMIUM_BIN,timeout:7000,
    args:['--remote-debugging-port=0','--disable-background-networking'],serviceWorkers:'block'});
  t.after(()=>context.close());
  await context.route('**/*',route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fixture}));
  const page=context.pages()[0];
  await page.goto('https://www.updream.cn/canvas?project=fixture');
  const port=(await readFile(join(dir,'DevToolsActivePort'),'utf8')).split('\n')[0];
  const endpoint='http://127.0.0.1:'+port;
  const adapter=createBrowserAdapter({endpoint});
  const project=join(dir,'production');
  initWorkspace(project,'test text');
  const ctx=new Context();
  t.after(()=>ctx.fiber.dispose());
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(Tools);
  await ctx.plugin(NativeExecutor);
  await ctx.plugin(workbench,{directory:project,cdpEndpoint:endpoint});
  let seq=0;
  async function execute(name,args={}) {
    const batch=await ctx.tools.execute({calls:[{type:'tool-call',id:String(++seq),name,arguments:JSON.stringify(args)}],signal:t.signal});
    const result=batch.results[0].result;
    assert.equal(result.isError,false,JSON.stringify(result.content));
    return JSON.parse(result.content[0].text);
  }
  const [tab]=await adapter.listTabs();
  const catalog=()=>adapter.discover(tab);
  const target=async()=>{
    const {tools,documentId}=await catalog();
    const node=tools.find(t=>t.surface==='text_node');
    assert.ok(node);
    return {...tab,toolId:node.toolId,documentId};
  };
  const call=(ref,operation,extra={})=>adapter.invoke({...ref,operation,...extra});
  let ref=await target();
  const nativeBinding=async()=> {
    const {tools,documentId}=await execute('xatp_discover',{providerId:'updream',tabId:tab.tabId});
    return {documentId,tabId:tab.tabId,toolId:tools.find(t=>t.surface==='text_node').toolId};
  };
  const binding=await nativeBinding();
  assert.equal((await execute('xatp_read_node_text',{binding})).readback,'');
  const text='保留坐标 <draft>\n回读标注。';
  const {plan,revision}=await execute('xatp_orchestration_read');
  const local=plan.nodes.find(n=>n.type==='prompt');
  local.params.text=text;
  await execute('xatp_orchestration_save',{plan,revision});
  const live=await execute('xatp_orchestration_run',{mode:'live',targetId:local.id,binding});
  assert.equal(live.ok,true,JSON.stringify(live.errors));
  assert.deepEqual(live.receipts[0],{nodeId:local.id,status:'verified',prompt:text,detail:'Updream 编辑器逐字读回',surface:'text_node',creditsSpent:0});
  assert.deepEqual((await execute('xatp_orchestration_read')).receipts,live.receipts);
  await assert.rejects(call(ref,'read_node_text'),{code:'stale_tool'}); // simulated React remount
  ref=await target();
  await assert.rejects(call(ref,'save_node_text',{expectedText:'',text:'覆盖他人修改'}),{code:'draft_conflict'});
  assert.equal((await execute('xatp_save_node_text',{binding:await nativeBinding(),expectedText:text,text})).exactMatch,true);
  await page.locator('[data-text-preview-content]').evaluate(el=>{el.innerHTML='<p><strong>已排版</strong></p>'});
  assert.equal((await call(ref,'read_node_text')).readback,'已排版');
  await assert.rejects(call(ref,'save_node_text',{expectedText:'已排版',text:'改写'}),{code:'operation_blocked'});
  await page.locator('[data-text-preview-content]').dblclick();
  assert.ok(!(await catalog()).tools.some(t=>t.surface==='text_node')); // a human is editing
  assert.deepEqual(await page.evaluate(()=>[window.saves,window.paid]),[1,0]);
});
