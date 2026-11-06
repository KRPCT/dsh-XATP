import { elements } from './dom.mjs';
import { boardSketch, icon } from './canvas-art.mjs';
import { catalog, createDemoPlan, dryRun } from '../orchestration/core.mjs';
import { H3_POLICY, h3Estimate } from '../updream/h3-tariff.mjs';

const defaults = createDemoPlan();
const names = {prompt:'文本',updream:'视频',timeline:'预演台'};
const typeIcons = {prompt:'text',updream:'video',timeline:'film'};
const initial = {prompt:[15,120],updream:[302,64],timeline:[688,300]};
const clock = seconds => Math.floor(seconds/60) + ':' + String(seconds%60).padStart(2,'0');
const copy = value => structuredClone(value);

export function mountCanvas(root, api, mountRecords) {
  const doc = root.ownerDocument, win = doc.defaultView;
  const {el} = elements(doc);
  const frame = el('section','xc-board');
  frame.setAttribute('aria-label','XATP 制作画布');
  frame.tabIndex = -1;
  frame.innerHTML = `<div class="xc-viewport" role="region" data-design-role="canvas-viewport" aria-label="节点画布"><div class="xc-world"><svg class="xc-wires" aria-hidden="true"></svg></div></div>
    <header class="xc-title"><span class="xc-mark" aria-label="XATP">X</span><span class="xc-title-copy"><small>DSH <i>/</i> XATP</small><strong></strong></span><button class="xc-saved" type="button" aria-label="保存工作流"></button></header>
    <nav class="xc-rail" aria-label="项目工具"></nav><nav class="xc-tools" data-design-role="toolbar" aria-label="画布工具"></nav>
    <aside class="xc-panel" data-design-role="sidebar" aria-label="编排助手"><header class="xc-panel-head"></header><div class="xc-feed" aria-live="polite"></div><div class="xc-compose"></div></aside>
    <button type="button" class="xc-reopen" aria-label="打开编排助手" hidden></button><div class="xc-toast" role="status" hidden></div>`;
  root.replaceChildren(frame);
  const $ = sel => frame.querySelector(sel);
  const viewport=$('.xc-viewport'),world=$('.xc-world'),wires=$('.xc-wires'),rail=$('.xc-rail'),tools=$('.xc-tools'),panel=$('.xc-panel'),feed=$('.xc-feed'),composer=$('.xc-compose');
  let plan, revision, receipts=[], selected, dirty=false, busy=false, disposed=false, loadToken=0, initialFit=true;
  let offset={x:0,y:0}, zoom=1, hand=false, wiring=true, pending, gesture, popup, records, binding;
  let history=[], future=[], report, message, showReceipts=false, changedSinceReport=false, timer, quoteBinding, siteQuote, composeText='';
  const nodeById = id => plan?.nodes.find(n=>n.id===id);
  const active = () => nodeById(selected);
  const targetSurface = node => node?.type==='prompt' ? 'text_node' : node?.params.surface;
  function promptOf(node) {
    return node?.type==='prompt' ? node : nodeById(plan?.edges.find(e=>e.to===node?.id && e.in==='prompt')?.from);
  }
  function position(node) {
    if(Number.isFinite(node.position?.x) && Number.isFinite(node.position?.y)) return node.position;
    const rank=plan.nodes.filter(n=>n.type===node.type).findIndex(n=>n.id===node.id);
    const [x,y]=initial[node.type] || [0,0];
    return {x:x+rank*32,y:y+rank*370};
  }
  function button(label,name,fn,cls='xc-icon',withLabel=false) {
    const b=el('button',cls);b.type='button';b.title=label;b.setAttribute('aria-label',label);
    if(name)b.append(icon(doc,name));if(withLabel)b.append(doc.createTextNode(label));b.addEventListener('click',fn);return b;
  }
  function tell(value) {
    const toast=$('.xc-toast');toast.textContent=value;toast.hidden=false;
    win.clearTimeout(timer);timer=win.setTimeout(()=>toast.hidden=true,3500);
  }
  function markDirty() {
    dirty=true;changedSinceReport=true;syncControls();
  }
  function checkpoint() {
    history.push(copy(plan));if(history.length>40)history.shift();future=[];
  }
  function mutate(fn) { if(!plan||busy)return;checkpoint();fn();markDirty();render(); }
  function restore(undo) {
    const from=undo?history:future,to=undo?future:history;
    if(!from.length||busy)return;
    to.push(copy(plan));plan=from.pop();selected=active()?.id || plan.nodes[0]?.id;pending=null;markDirty();render();
  }
  function syncControls() {
    const saved=$('.xc-saved');saved.textContent=busy?'处理中…':dirty?'保存修改':api.workflow&&revision>0?'已保存':'工作草稿';
    saved.disabled=(!dirty&&revision!==0)||busy||!api.workflow||!plan;
    $('.xc-undo').disabled=!history.length||busy;$('.xc-redo').disabled=!future.length||busy;
    $('.xc-zoom').textContent=Math.round(zoom*100)+'%';
    $('.xc-pointer').setAttribute('aria-pressed',String(!hand));$('.xc-hand').setAttribute('aria-pressed',String(hand));
    $('.xc-link').setAttribute('aria-pressed',String(wiring));frame.classList.toggle('xc-panning',hand);
  }
  function updateTransform() {
    world.style.transform='translate('+offset.x+'px,'+offset.y+'px) scale('+zoom+')';
    viewport.style.backgroundPosition=offset.x+'px '+offset.y+'px';viewport.style.backgroundSize=24*zoom+'px '+24*zoom+'px';syncControls();
  }
  function zoomAt(value, x=viewport.clientWidth/2, y=viewport.clientHeight/2) {
    const next=Math.min(2.4,Math.max(.35,value));offset={x:x-(x-offset.x)*next/zoom,y:y-(y-offset.y)*next/zoom};zoom=next;initialFit=false;updateTransform();
  }
  function setPanel(choice) {
    panel.hidden=!choice;$('.xc-reopen').hidden=choice;frame.dataset.panel=choice?'open':'closed';
  }
  function fit(all=true) {
    if(!plan?.nodes.length)return;
    const small=frame.clientWidth<850;
    const panelWidth=panel.hidden||small?0:panel.offsetWidth+30;
    const left=small?20:82,top=small?75:96;
    const width=Math.max(120,frame.clientWidth-left-panelWidth-22),height=Math.max(160,frame.clientHeight-top-82);
    const nodes=all?plan.nodes:[active()].filter(Boolean);
    const rects=nodes.map(n=>{const p=position(n),v=nodeElement(n.id);return {x:p.x,y:p.y,w:v?.offsetWidth||250,h:v?.offsetHeight||180};});
    if(!rects.length)return;
    const minX=Math.min(...rects.map(r=>r.x)),minY=Math.min(...rects.map(r=>r.y));
    const w=Math.max(...rects.map(r=>r.x+r.w))-minX,h=Math.max(...rects.map(r=>r.y+r.h))-minY;
    zoom=Math.max(.24,Math.min(width/w,height/h,all?1.07:1.13));
    offset={x:left+(width-w*zoom)/2-minX*zoom,y:top+(height-h*zoom)/2-minY*zoom};updateTransform();
  }
  function nodeElement(id) {return world.querySelector('[data-node-id="'+CSS.escape(id)+'"]');}
  function redrawWires() {
    wires.replaceChildren();if(!wiring||!plan)return;
    function point(id,side) {
      const card=nodeElement(id),p=card?.querySelector('.xc-port[data-side="'+side+'"]');
      return p&&{x:card.offsetLeft+p.offsetLeft+p.offsetWidth/2,y:card.offsetTop+p.offsetTop+p.offsetHeight/2};
    }
    function curve(a,b,color) {
      if(!a||!b)return;
      const path=doc.createElementNS('http://www.w3.org/2000/svg','path'),d=Math.max(50,Math.abs(b.x-a.x)*.48);
      path.setAttribute('d',`M${a.x},${a.y} C${a.x+d},${a.y} ${b.x-d},${b.y} ${b.x},${b.y}`);path.setAttribute('class',color);wires.append(path);
    }
    for(const e of plan.edges)curve(point(e.from,'out'),point(e.to,'in'),e.out==='text'?'xc-wire-text':'xc-wire-clip');
    if(pending?.end)curve(point(pending.id,'out'),pending.end,'xc-wire-new');
  }
  function worldPoint(e) {
    const r=viewport.getBoundingClientRect();return {x:(e.clientX-r.left-offset.x)/zoom,y:(e.clientY-r.top-offset.y)/zoom};
  }
  function connect(from,to) {
    pending=null;
    const src=nodeById(from),dest=nodeById(to);
    if(!src||!dest)return;
    const out=Object.keys(catalog[src.type].outputs)[0],input=Object.keys(catalog[dest.type].inputs)[0];
    if(!out||!input||catalog[src.type].outputs[out]!==catalog[dest.type].inputs[input]) {tell('端口类型不匹配');render();return;}
    if(plan.edges.some(e=>e.from===from&&e.to===to)){tell('这两个节点已连接');render();return;}
    mutate(()=>{
      if(dest.type!=='timeline')plan.edges=plan.edges.filter(e=>e.to!==to||e.in!==input);
      plan.edges.push({from,out,to,in:input});
      if(dest.type==='timeline')plan.timeline.push({nodeId:from,seconds:src.params.seconds});
    });tell('已连接 '+src.title+' → '+dest.title);
  }
  function disconnect(edge) {
    mutate(()=>{plan.edges=plan.edges.filter(e=>e!==edge);if(edge.in==='clips')plan.timeline=plan.timeline.filter(t=>t.nodeId!==edge.from);});
  }
  function port(n,side) {
    const entry=Object.keys(side==='in'?catalog[n.type].inputs:catalog[n.type].outputs)[0];if(!entry)return;
    const b=button((side==='in'?'输入':'输出')+'端口 '+entry,null,()=>{
      if(busy)return;
      if(side==='out'){pending={id:n.id};wiring=true;tell('选择目标节点的输入端口');redrawWires();}
      else if(pending)connect(pending.id,n.id);else tell('先选择上游节点的输出端口');
    },'xc-port');b.dataset.side=side;b.dataset.port=entry;b.dataset.kind=['text','prompt'].includes(entry)?'text':'clip';return b;
  }
  function selectControl(label,values,value,cb) {
    const control=el('select','xc-select');control.setAttribute('aria-label',label);
    for(const v of values){const [key,text]=Array.isArray(v)?v:[v,v];const o=el('option','',text);o.value=key;o.selected=String(key)===String(value);control.append(o);}
    control.addEventListener('change',()=>cb(control.value));return control;
  }
  function editPrompt(n,cls='xc-prompt') {
    const source=promptOf(n),field=el('textarea',cls);field.setAttribute('aria-label','镜头提示词');field.maxLength=12000;
    field.value=source?.params.text||'';field.placeholder=source?'输入镜头提示词…':'先连接文本节点';field.disabled=!source;let recorded=false;
    field.addEventListener('focus',()=>{recorded=false;select(n.id);});
    field.addEventListener('input',()=>{
      if(!source||busy)return;if(!recorded){checkpoint();recorded=true;}source.params.text=field.value;markDirty();
      for(const other of world.querySelectorAll('textarea'))if(other!==field&&other.dataset.source===source.id)other.value=field.value;
      frame.querySelectorAll('.xc-snippet').forEach(s=>{if(s.dataset.source===source.id)s.textContent=source.params.text;});
    });field.dataset.source=source?.id||'';return field;
  }
  function renderCard(n,index) {
    const card=el('article','xc-node xc-'+n.type);card.dataset.nodeId=n.id;card.dataset.nodeType=n.type;card.dataset.designRole='canvas-object';card.tabIndex=0;card.setAttribute('aria-label',n.title);
    const p=position(n);card.style.left=p.x+'px';card.style.top=p.y+'px';
    const head=el('header','xc-node-head');head.dataset.drag='node';const token=el('span','xc-type-icon');token.append(icon(doc,typeIcons[n.type],16));
    head.append(token,el('strong','',n.title || names[n.type]),el('small','xc-id',String(index+1).padStart(2,'0')));card.append(head);
    if(n.type==='prompt'){
      card.append(el('div','xc-kind','PROMPT'),editPrompt(n,'xc-text-area'));
      card.append(el('footer','xc-port-label','文本输出'));
    } else if(n.type==='updream') {
      const media=el('div','xc-image');
      if(plan.id==='storyboard'&&n.id==='updream-01') {media.innerHTML=boardSketch;media.append(el('small','xc-frame-badge','示例分镜 · 01'));}
      else {media.classList.add('xc-blank');media.append(icon(doc,'video',24),el('span','','镜头草稿'));}
      card.append(media);
      const editor=el('div','xc-node-editor');const strip=el('div','xc-mode');
      strip.append(icon(doc,n.params.surface==='agent'?'assistant':'video',14),selectControl('编辑目标',[['video','视频节点'],['agent','Agent 对话']],n.params.surface,v=>mutate(()=>n.params.surface=v)),el('span','xc-dot','·'),el('span','','提示词'));
      editor.append(strip,editPrompt(n));
      const row=el('div','xc-options');
      row.append(el('span','xc-model',n.params.model),selectControl('单镜头时长',Array.from({length:11},(_,i)=>[i+5,(i+5)+'s']),n.params.seconds,v=>mutate(()=>{
        n.params.seconds=Number(v);for(const item of plan.timeline)if(item.nodeId===n.id)item.seconds=Number(v);
      })),selectControl('单镜头分辨率',['768P','2K'],n.params.resolution,v=>mutate(()=>n.params.resolution=v)));
      editor.append(row);
      const act=el('div','xc-node-act');act.append(el('span','xc-local','本次 0 积分'),button('排演节点','play',()=>run(n.id),'xc-run',true));editor.append(act);card.append(editor);
    } else {
      const total=plan.timeline.reduce((s,x)=>s+x.seconds,0);
      const timeline=el('div','xc-timeline');timeline.append(el('div','xc-kind','SEQUENCE'),el('strong','xc-time',clock(total)),el('small','','已编排 / 计划 '+clock(plan.targetSeconds||114)));
      const ruler=el('div','xc-ruler');const fill=el('span');fill.style.width=Math.min(100,total/(plan.targetSeconds||114)*100)+'%';ruler.append(fill);timeline.append(ruler,el('small','','整片范围 1:50–1:58'));card.append(timeline);
    }
    for(const side of ['in','out']){const p=port(n,side);if(p)card.append(p);}
    card.addEventListener('focusin',()=>select(n.id));card.addEventListener('click',()=>select(n.id));
    card.addEventListener('keydown',e=>{if(e.target===card&&e.key==='Enter'){select(n.id);card.querySelector('textarea,select,button')?.focus();}});
    return card;
  }
  function select(id) {
    if(selected===id)return;selected=id;message=null;showReceipts=false;selectStyle();renderPanel();
  }
  function selectStyle() {
    for(const n of world.querySelectorAll('[data-node-id]')){const yes=n.dataset.nodeId===selected;n.dataset.selected=String(yes);}
  }
  function stat(container,label,value) {const row=el('div','xc-stat');row.append(el('span','',label),el('strong','',value));container.append(row);}
  function renderPanel() {
    feed.replaceChildren();composer.replaceChildren();if(!plan)return;const n=active();if(!n)return;
    const stamp=el('div','xc-stamp');stamp.append(el('i'),doc.createTextNode(binding?'已绑定编辑器':'本地编排'));
    const head=el('div','xc-focus');head.append(stamp,el('h2','',n.title || names[n.type]));feed.append(head);
    const pills=el('div','xc-panel-tabs');
    for (const [log,label] of [[false,'节点'],[true,'运行记录']]){const b=button(label,null,()=>{showReceipts=log;renderPanel();},'xc-tab',true);b.setAttribute('aria-pressed',String(log===showReceipts));pills.append(b);}feed.append(pills);
    if(showReceipts){
      if(!receipts.length)feed.append(el('p','xc-subtle','尚无运行记录。'));
      for(const r of receipts.slice(-24).reverse()){
        const item=el('div','xc-receipt');
        const status={'dry-run':'已排演',verified:'已回读',resolved:'已解析',pending:'待回读',checked:'已检查'}[r.status] || r.status;
        item.append(icon(doc,'history',15),el('strong','',nodeById(r.nodeId)?.title || r.nodeId),el('small','',status),el('p','',r.detail||''));
        if(r.prompt && nodeById(r.nodeId)?.type==='updream'){
          const payload=el('details','xc-used-prompt');
          payload.append(el('summary','','查看本次提示词'),el('p','',r.prompt));
          item.append(payload);
        }
        feed.append(item);
      }
    }else{
      if(n.type==='updream'){
        const cfg=el('section','xc-group');cfg.append(el('h3','','调用设置'));
        const action=selectControl('节点操作',[['draft_prompt','写入提示词草稿'],['generate_video','生成视频（仅排演）']],n.params.operation,v=>mutate(()=>n.params.operation=v));const actionRow=el('div','xc-stat');actionRow.append(el('span','','操作'),action);cfg.append(actionRow);
        stat(cfg,'模型',n.params.model);stat(cfg,'镜头',n.params.seconds+' 秒 · '+n.params.resolution);feed.append(cfg);
        const cost=el('section','xc-group xc-cost');cost.append(el('h3','','生成试算'));
        let quote;try{quote=h3Estimate(n.params).credits;}catch{}
        const price=el('div','xc-price');price.append(el('strong','',quote??'—'),el('small','','积分'),el('span','xc-alert',quote>H3_POLICY.totalLimit?'超出总上限':'待复核'));cost.append(price);
        stat(cost,'本次额度 / 总上限',H3_POLICY.spendNow+' / '+H3_POLICY.totalLimit+' 积分');
        if(siteQuote && siteQuote.nodeId===n.id){
          stat(cost,'站内读数',siteQuote.displayedCredits+' 积分 · '+siteQuote.seconds+'s / '+siteQuote.resolution+(siteQuote.quoteStatus==='observed_only'?' · 未核价':''));
        }
        cost.append(el('small','xc-footnote','11 月 6 日核价 · '+(n.params.referenceSeconds ? '含 '+n.params.referenceSeconds+'s 参考视频' : '无参考视频')));feed.append(cost);
      }else if(n.type==='timeline'){
        const g=el('section','xc-group');g.append(el('h3','','时间线'));stat(g,'整片目标',clock(plan.targetSeconds||114));stat(g,'允许范围','1:50–1:58');
        for(const [i,s] of plan.timeline.entries())stat(g,String(i+1).padStart(2,'0')+' '+(nodeById(s.nodeId)?.title || s.nodeId),s.seconds+'s');feed.append(g);
        feed.append(button('检查整片时长','clock',()=>run(n.id),'xc-action',true));
      }else{
        const g=el('section','xc-group');g.append(el('h3','','文本内容'));const text=el('p','xc-snippet',n.params.text);text.dataset.source=n.id;g.append(text);feed.append(g);
      }
      const links=plan.edges.filter(e=>e.to===n.id||e.from===n.id),g=el('section','xc-group');g.append(el('h3','','节点连线'));
      for(const e of links){const incoming=e.to===n.id,other=incoming?e.from:e.to,row=el('div','xc-edge-row');row.append(button((incoming?'输入 · ':'输出 · ')+(nodeById(other)?.title||other),'wire',()=>{select(other);if(frame.clientWidth<850)fit(false);},'xc-edge',true),button('断开这条连线','close',()=>disconnect(e),'xc-remove'));g.append(row);}
      if(!links.length)g.append(el('small','xc-subtle','尚未连接'));feed.append(g);
      if(n.type==='updream'&&n.params.operation==='draft_prompt' || n.type==='prompt'&&api.workflow?.readNodeText){
        const connected=el('section','xc-group');connected.append(el('h3','','目标浏览器'));
        connected.append(button(binding?'重新选择编辑器':'选择 Updream 编辑器','browser',()=>openRecords('browser'),'xc-action',true));
        if(quoteBinding && quoteBinding.nodeId===n.id && api.workflow?.quoteH3) connected.append(button('读取站内报价','browser',()=>readQuote(n.id),'xc-action',true));
        if(binding?.nodeId===n.id&&binding.surface===targetSurface(n))connected.append(button('写入并读回草稿','arrow',()=>run(n.id,'live'),'xc-action',true));feed.append(connected);
      }
    }
    if(report&&!showReceipts){
      const msg=el('div','xc-feedback');msg.dataset.status=report.ok?'ok':'error';
      msg.append(icon(doc,report.ok?'done':'history',15),el('span','',changedSinceReport?'工作流已修改，请重新排演':report.ok?(message||'排演完成'):report.errors.join(' · ')));feed.append(msg);
    }
    const field=el('textarea','xc-composer-input');field.rows=2;field.maxLength=12000;field.setAttribute('aria-label','助手提示词草稿');field.placeholder=promptOf(n)?'为此镜头写一段提示词…':'选择文本或视频节点以编辑提示词';field.value=composeText;field.disabled=!promptOf(n);
    const send=button('应用到节点提示词','arrow',()=>{const source=promptOf(active());if(!source||!field.value.trim())return;const value=field.value.trim();composeText='';mutate(()=>source.params.text=value);tell('提示词已应用到节点');},'xc-send');
    send.disabled=!field.value.trim()||!promptOf(n);
    field.addEventListener('input',()=>{composeText=field.value;send.disabled=!field.value.trim();});field.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter')send.click();});
    const foot=el('div','xc-compose-foot');foot.append(el('span','','节点指令'),send);composer.append(field,foot);
  }
  async function readQuote(nodeId) {
    if(busy||!quoteBinding)return;
    setBusy(true);
    try{
      const result=await api.workflow.quoteH3(quoteBinding);
      if(disposed)return;siteQuote={...result,nodeId};tell('站内报价 '+result.displayedCredits+' 积分'+(result.quoteStatus==='observed_only'?' · 未核价':''));
    }catch(e){if(!disposed){siteQuote=quoteBinding=null;tell(e.message||String(e));}}
    finally{if(!disposed){setBusy(false);renderPanel();}}
  }
  function closePopup() {popup?.remove();popup=null;}
  function closeRecords() {if(!records)return;records.handle?.destroy();records.layer.remove();records=null;frame.focus();}
  function openRecords(view) {
    closePopup();closeRecords();const layer=el('div','xc-drawer');const bar=el('div','xc-drawer-head');
    bar.append(button('返回画布','back',closeRecords,'xc-action',true),el('span','','项目资料'));const body=el('div','xc-drawer-content');layer.append(bar,body);frame.append(layer);
    records={layer};records.handle=mountRecords(body,{...api,theme:'dark',onSiteQuote(value,ref){if(active()?.type==='updream'){quoteBinding={...ref,nodeId:selected};siteQuote={...value,nodeId:selected};renderPanel();}},bindEditor(value){
      if(!['prompt','updream'].includes(active()?.type))return tell('先选择文本或视频节点');
      if(value.surface!==targetSurface(active()))return tell('编辑器与节点的目标区域不同');
      binding={...value,nodeId:selected};closeRecords();renderPanel();tell('已绑定 Updream 编辑器');
    }},view);bar.querySelector('button').focus();
  }
  function addNode(type,surface='video') {
    closePopup();if(busy||!plan)return;
    if(type==='timeline'&&plan.nodes.some(n=>n.type==='timeline')){select(plan.nodes.find(n=>n.type==='timeline').id);fit(false);return;}
    const template=defaults.nodes.find(n=>n.type===type);if(!template)return;
    let serial=1,id;do{id=type+'-'+String(++serial).padStart(2,'0');}while(nodeById(id));
    const n=copy(template);n.id=id;n.title=(surface==='agent'?'Agent':names[type])+' '+String(serial).padStart(2,'0');
    if(type==='prompt')n.params.text='';if(type==='updream')n.params.surface=surface;
    mutate(()=>{plan.nodes.push(n);selected=id;});fit(false);initialFit=false;nodeElement(id)?.focus();
  }
  function addMenu() {
    if(popup){closePopup();return;}popup=el('div','xc-popup');popup.append(el('h3','','添加节点'));
    for(const [label,type,name,surface] of [['文本','prompt','text'],['图片',null,'media'],['视频','updream','video'],['音频',null,'audio'],['Agent','updream','assistant','agent'],['预演台','timeline','film'],['上传',null,'upload']]){
      const b=button(label,name,()=>addNode(type,surface),'xc-menu-item',true);if(!type){b.disabled=true;b.append(el('small','','仅站内'));}popup.append(b);
    }frame.append(popup);popup.querySelector('button')?.focus();
  }
  function drawRail() {
    for(const [label,name,cb] of [['添加节点','add',addMenu],['素材与来源','folder',()=>openRecords('assets')],['浏览器工具','browser',()=>openRecords('browser')],['运行历史','history',()=>{showReceipts=true;setPanel(true);renderPanel();}],['镜头与剪辑','cut',()=>openRecords('shots')]]){
      rail.append(button(label,name,cb,'xc-icon'+(name==='add'?' xc-plus':'')));
    }
  }
  function setHand(value) {hand=value;pending=null;syncControls();redrawWires();}
  function drawTools() {
    for(const [name,label,cb,cls] of [
      ['cursor','选择',()=>setHand(false),'xc-pointer'],['hand','平移',()=>setHand(true),'xc-hand'],[null,null],['minus','缩小',()=>zoomAt(zoom/1.15)],['','缩放比例',()=>{initialFit=true;fit(frame.clientWidth>=850);},'xc-zoom'],['add','放大',()=>zoomAt(zoom*1.15)],[null,null],['fit','适配全部节点',()=>{fit(true);initialFit=false;}],['wire','显示连线',()=>{wiring=!wiring;redrawWires();syncControls();},'xc-link'],['sun','切换画布亮度',()=>frame.classList.toggle('xc-bright')],[null,null],['undo','撤销',()=>restore(true),'xc-undo'],['redo','重做',()=>restore(false),'xc-redo']]){
      tools.append(label?button(label,name,cb,'xc-icon '+(cls||'')):el('i','xc-separator'));
    }
  }
  function render() {
    world.querySelectorAll('[data-node-id]').forEach(n=>n.remove());if(!plan)return;
    for(const [i,n] of plan.nodes.entries())world.append(renderCard(n,i));
    $('.xc-title strong').textContent=plan.title;selectStyle();syncControls();redrawWires();renderPanel();
  }
  function setBusy(value) {
    busy=value;for(const e of [world,rail,feed,composer])e.inert=value;
    syncControls();
  }
  async function save() {
    if(!api.workflow||!plan||busy)return;
    setBusy(true);
    try{const res=await api.workflow.save(copy(plan),revision);if(disposed)return;revision=res.revision;dirty=false;tell('工作流已保存');}
    catch(e){if(!disposed)tell(e.message || String(e));}finally{if(!disposed)setBusy(false);}
  }
  async function run(id,mode='dry-run') {
    if(!plan||busy)return;
    select(id);setBusy(true);
    try{
      if(mode==='live'){
        if(!api.workflow||binding?.nodeId!==id||binding.surface!==targetSurface(nodeById(id)))throw Error('请绑定当前节点的编辑器');
        if(dirty||revision===0){const saved=await api.workflow.save(copy(plan),revision);if(disposed)return;revision=saved.revision;dirty=false;}
      }
      const result=api.workflow?await api.workflow.run(copy(plan),id,mode,...(mode==='live'?[binding]:[])):dryRun(plan,{targetId:id});
      if(disposed)return;
      report=result;receipts.push(...(result.receipts||[]));receipts=receipts.slice(-100);message=mode==='live'?'已写入并读回站内草稿':'完成 '+result.order.length+' 个节点的排演 · 0 积分';changedSinceReport=false;
      tell(result.ok?message:result.errors.join(' · '));
    }catch(e){if(disposed)return;report={ok:false,errors:[e.message||String(e)]};changedSinceReport=false;tell(report.errors[0]);if(mode==='live')binding=null;}
    finally{if(!disposed){setBusy(false);renderPanel();}}
  }
  async function refresh() {
    if(disposed||busy||dirty)return;
    const token=++loadToken;
    try{
      const result=api.workflow?await api.workflow.read():{plan:createDemoPlan(),receipts:[]};
      if(token!==loadToken||disposed||dirty)return;plan=copy(result.plan);revision=result.revision;receipts=copy(result.receipts||[]);
      selected=nodeById(selected)?.id || plan.nodes.find(n=>n.type==='updream')?.id || plan.nodes[0]?.id;render();
      if(initialFit)fit(frame.clientWidth>=850);
    }catch(e){if(!disposed){$('.xc-title strong').textContent='工作流未载入';tell(e.message||String(e));}}
  }
  function onDown(e) {
    if(busy||!plan||e.button>1)return;
    const header=e.target.closest('[data-drag]'),p=e.target.closest('.xc-port[data-side="out"]'),card=e.target.closest('[data-node-id]');
    if(p&&card&&!hand){
      pending={id:card.dataset.nodeId,end:worldPoint(e)};gesture={type:'wire',startX:e.clientX,startY:e.clientY};wiring=true;
    }else if((!card||hand||e.button===1)&&!e.target.closest('textarea,button,select')) {
      gesture={type:'pan',startX:e.clientX,startY:e.clientY,x:offset.x,y:offset.y};closePopup();
    }else if(header){
      const n=nodeById(card.dataset.nodeId);select(n.id);const pos=position(n);gesture={type:'node',card,n,startX:e.clientX,startY:e.clientY,x:pos.x,y:pos.y};
    }else return;
    if(gesture.type!=='wire') {e.preventDefault();viewport.setPointerCapture(e.pointerId);}
  }
  function onMove(e) {
    if(!gesture){if(pending){pending.end=worldPoint(e);redrawWires();}return;}
    const g=gesture,dx=e.clientX-g.startX,dy=e.clientY-g.startY;
    if(!g.moved && Math.hypot(dx,dy)<3)return;
    if(g.type==='node'&&!g.moved)checkpoint();g.moved=true;
    if(g.type==='pan'){initialFit=false;offset={x:g.x+dx,y:g.y+dy};updateTransform();}
    if(g.type==='node'){initialFit=false;const pos={x:g.x+dx/zoom,y:g.y+dy/zoom};g.n.position=pos;g.card.style.left=pos.x+'px';g.card.style.top=pos.y+'px';redrawWires();markDirty();}
    if(g.type==='wire'&&pending){pending.end=worldPoint(e);redrawWires();}
  }
  function onUp(e) {
    const g=gesture;gesture=null;
    if(g?.type==='wire'&&g.moved){
      const hit=frame.getRootNode().elementFromPoint?.(e.clientX,e.clientY)?.closest('.xc-port[data-side="in"]');
      if(hit&&pending)connect(pending.id,hit.closest('[data-node-id]').dataset.nodeId);
      else{pending=null;redrawWires();}
    }
  }
  function key(e) {
    if(e.key==='Escape'){closePopup();closeRecords();pending=null;redrawWires();return;}
    if(e.target.closest('input,textarea,select,[contenteditable=true],.xc-drawer'))return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();restore(!e.shiftKey);}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();void save();}
    if(e.key==='Delete'&&active()&&!busy)mutate(()=>{
      plan.nodes=plan.nodes.filter(n=>n.id!==selected);plan.edges=plan.edges.filter(e=>e.from!==selected&&e.to!==selected);
      plan.timeline=plan.timeline.filter(t=>t.nodeId!==selected);if(!plan.nodes.some(n=>n.type==='timeline'))plan.timeline=[];
      selected=plan.nodes[0]?.id;
    });
  }
  const panelHead=$('.xc-panel-head');panelHead.append(icon(doc,'assistant',19),el('strong','','编排助手'),button('收起助手','panel',()=>{setPanel(false);if(initialFit)fit(frame.clientWidth>=850);}));
  const reopen=$('.xc-reopen');reopen.append(icon(doc,'assistant'));reopen.addEventListener('click',()=>{setPanel(true);if(initialFit)fit(frame.clientWidth>=850);});
  $('.xc-saved').addEventListener('click',save);
  drawRail();drawTools();setPanel(frame.clientWidth>=850);let lastWide=frame.clientWidth>=850;
  viewport.addEventListener('pointerdown',onDown);win.addEventListener('pointermove',onMove);win.addEventListener('pointerup',onUp);
  viewport.addEventListener('pointercancel',()=>{gesture=pending=null;redrawWires();});
  viewport.addEventListener('wheel',e=>{e.preventDefault();const r=viewport.getBoundingClientRect();if(e.ctrlKey||e.metaKey)zoomAt(zoom*Math.exp(-e.deltaY*.012),e.clientX-r.left,e.clientY-r.top);else{initialFit=false;offset={x:offset.x-e.deltaX,y:offset.y-e.deltaY};updateTransform();}},{passive:false});
  frame.addEventListener('keydown',key);frame.addEventListener('pointerdown',e=>{if(popup&&!popup.contains(e.target)&&!e.target.closest('.xc-plus'))closePopup();});
  const ro=new win.ResizeObserver(()=>{const wide=frame.clientWidth>=850;if(wide!==lastWide){setPanel(wide);lastWide=wide;}if(initialFit)fit(wide);redrawWires();});ro.observe(frame);
  void refresh();
  return {refresh,destroy(){disposed=true;loadToken++;closeRecords();ro.disconnect();win.clearTimeout(timer);win.removeEventListener('pointermove',onMove);win.removeEventListener('pointerup',onUp);frame.remove();}};
}
