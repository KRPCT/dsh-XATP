import { H3_POLICY, h3Estimate } from '../updream/h3-tariff.mjs';

export const catalog = {
  prompt: { inputs: {}, outputs: { text: 'text' } },
  updream: { inputs: { prompt: 'text' }, outputs: { clip: 'clip-plan' } },
  timeline: { inputs: { clips: 'clip-plan' }, outputs: {} },
};

export function createDemoPlan() {
  return {
    id: 'storyboard', title: '记忆的线索', targetSeconds: 114,
    nodes: [
      { id:'prompt-01', type:'prompt', title:'镜头提示词', params:{text:'保持在同一块电脑屏幕，选中模型草稿，保留坐标与原文证据位置。'} },
      { id:'updream-01', type:'updream', title:'Updream 视频节点', params:{operation:'draft_prompt',surface:'video',model:'MiniMax H3',seconds:5,resolution:'768P'} },
      { id:'sequence', type:'timeline', title:'成片时间线', params:{} },
    ],
    edges: [
      {from:'prompt-01',out:'text',to:'updream-01',in:'prompt'},
      {from:'updream-01',out:'clip',to:'sequence',in:'clips'},
    ],
    timeline: [{nodeId:'updream-01',seconds:5}],
  };
}

const fields = (obj,keys) => obj !== null && typeof obj === 'object' && !Array.isArray(obj)
  && Object.keys(obj).every(key => keys.includes(key));
const shortText = text => typeof text === 'string' && text.length <= 256;
const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(id) && !Object.hasOwn(Object.prototype,id);

/** A saveable, renderable draft may be disconnected and have empty prompts. Session bindings stay outside it. */
export function isPlanDocument(plan) {
  if (!fields(plan,['id','title','targetSeconds','nodes','edges','timeline'])
      || (plan.id !== undefined && !validId(plan.id)) || (plan.title !== undefined && !shortText(plan.title))
      || (plan.targetSeconds !== undefined && !Number.isFinite(plan.targetSeconds))
      || !Array.isArray(plan.nodes) || plan.nodes.length > 256 || !Array.isArray(plan.edges) || plan.edges.length > 2048
      || !Array.isArray(plan.timeline) || plan.timeline.length > 2048) return false;
  const ids = new Set();
  for (const n of plan.nodes) {
    if (!fields(n,['id','type','title','params','position']) || !validId(n.id) || ids.has(n.id)
        || typeof n.type !== 'string' || !Object.hasOwn(catalog,n.type) || (n.title !== undefined && !shortText(n.title))
        || (n.position !== undefined && (!fields(n.position,['x','y']) || !Number.isFinite(n.position.x) || !Number.isFinite(n.position.y)))) return false;
    ids.add(n.id);
    const p = n.params;
    if (n.type === 'prompt' && (!fields(p,['text']) || typeof p.text !== 'string' || p.text.length > 12000)) return false;
    if (n.type === 'timeline' && !fields(p,[])) return false;
    if (n.type === 'updream' && (!fields(p,['operation','surface','model','seconds','resolution','referenceSeconds'])
        || ![p.operation,p.surface,p.model,p.resolution].every(shortText) || !Number.isFinite(p.seconds)
        || (p.referenceSeconds !== undefined && !Number.isFinite(p.referenceSeconds)))) return false;
  }
  return plan.edges.every(e=>fields(e,['from','out','to','in']) && [e.from,e.out,e.to,e.in].every(validId))
    && plan.timeline.every(t=>fields(t,['nodeId','seconds']) && validId(t.nodeId) && Number.isFinite(t.seconds))
    && JSON.stringify(plan).length <= 262144;
}

export function compilePlan(plan, {targetId} = {}) {
  const result = {ok:false,errors:[],order:[],durationSeconds:0,durationValid:false, estimates:{}};
  const fail = message => result.errors.push(message);
  if (!isPlanDocument(plan)) {
    fail('无效的工作流结构或超过大小限制');
    return result;
  }
  if (plan.targetSeconds !== undefined && (!Number.isFinite(plan.targetSeconds) || plan.targetSeconds < 110 || plan.targetSeconds > 118)) {
    fail('成片目标时长应在 110–118 秒之间');
  }
  const nodes = new Map(), incoming = new Map(), outgoing = new Map();
  for (const node of plan.nodes) {
    nodes.set(node.id,node);
    incoming.set(node.id,[]);
    outgoing.set(node.id,[]);
  }
  if (!nodes.size) fail('工作流还没有节点');
  if (targetId !== undefined && !nodes.has(targetId)) fail('找不到目标节点');
  const linked = new Set();
  for (const edge of plan.edges) {
    const source = nodes.get(edge?.from), dest = nodes.get(edge?.to);
    const out = source && catalog[source.type].outputs, input = dest && catalog[dest.type].inputs;
    if (!out || !input || !Object.hasOwn(out,edge.out) || !Object.hasOwn(input,edge.in) || out[edge.out] !== input[edge.in]) {
      fail('连线的端口或类型不匹配');
      continue;
    }
    const key = [edge.from,edge.out,edge.to,edge.in].join('|');
    if (linked.has(key) || (dest.type !== 'timeline' && incoming.get(dest.id).length)) {
      fail('重复连接或单输入端口已有连线');
      continue;
    }
    linked.add(key);
    incoming.get(dest.id).push(source.id);
    outgoing.get(source.id).push(dest.id);
  }
  const sequence = [...nodes.values()].filter(node => node.type === 'timeline');
  if (sequence.length > 1) fail('工程只能有一条成片时间线');
  let complete = sequence.length === 1 && plan.timeline.length > 0;
  const shots = new Set(sequence.length ? incoming.get(sequence[0].id) : []);
  const placed = new Set();
  for (const item of plan.timeline) {
    const node = nodes.get(item?.nodeId);
    if (!node || !shots.has(node.id) || !Number.isFinite(item.seconds) || item.seconds <= 0 || item.seconds > node.params?.seconds) {
      complete = false;
      continue;
    }
    result.durationSeconds += item.seconds;
    placed.add(node.id);
  }
  complete &&= placed.size === shots.size;
  result.durationValid = complete && result.durationSeconds >= 110 && result.durationSeconds <= 118;
  const wanted = new Set();
  function include(id) {
    if (wanted.has(id)) return;
    wanted.add(id);
    for (const parent of incoming.get(id) || []) include(parent);
  }
  if (targetId === undefined) for (const id of nodes.keys()) include(id);
  else include(targetId);
  const counts = new Map([...incoming].map(([id,deps]) => [id,deps.length]));
  const ready = [...counts].filter(([,n]) => n === 0).map(([id]) => id);
  for (let index = 0; index < ready.length; index++) {
    const id = ready[index];
    if (wanted.has(id)) result.order.push(id);
    for (const child of outgoing.get(id)) {
      counts.set(child, counts.get(child) - 1);
      if (counts.get(child) === 0) ready.push(child);
    }
  }
  if (ready.length !== nodes.size) fail('工作流包含循环依赖');
  for (const id of result.order) {
    const node = nodes.get(id), p = node.params || {};
    if (node.type === 'prompt' && (typeof p.text !== 'string' || !p.text.trim() || p.text.length > 12000)) fail(id+' 提示词为空或过长');
    if (node.type !== 'updream') continue;
    if (!incoming.get(id).length) fail(id+' 缺少提示词连线');
    if (!['draft_prompt','generate_video'].includes(p.operation)) fail(id+' 未识别的操作');
    if (!['video','agent'].includes(p.surface)) fail(id+' 未识别的提示词编辑区域');
    if (p.model !== H3_POLICY.model || !Object.hasOwn(H3_POLICY.rates,p.resolution) ||
        !Number.isInteger(p.seconds) || p.seconds < H3_POLICY.minSeconds || p.seconds > H3_POLICY.maxSeconds ||
        !Number.isSafeInteger(p.referenceSeconds ?? 0) || (p.referenceSeconds ?? 0) < 0) {
      fail(id+' 只支持 MiniMax H3，时长 5–15 整秒及已核价的分辨率');
    } else {
      try {
        result.estimates[id] = h3Estimate({model:p.model,resolution:p.resolution,seconds:p.seconds,referenceSeconds:p.referenceSeconds ?? 0});
      } catch {
        fail(id+' 参考视频需要可核验的报价');
      }
    }
  }
  if ((targetId === undefined || nodes.get(targetId)?.type === 'timeline') && !result.durationValid) {
    fail('成片时间线须完整连接，播放时长应在 1:50–1:58 之间（含端点）');
  }
  result.ok = result.errors.length === 0;
  return result;
}

export function dryRun(plan, options = {}) {
  const result = compilePlan(plan,options);
  const receipts = [];
  if (result.ok) {
    const nodes = new Map(plan.nodes.map(node => [node.id,node]));
    for (const id of result.order) {
      const node = nodes.get(id);
      const prompt = node.type === 'prompt' ? node.params.text : node.type === 'updream'
        ? nodes.get(plan.edges.find(edge => edge.to === id && edge.in === 'prompt').from).params.text : undefined;
      const quote = result.estimates[id];
      const detail = node.type === 'updream' ? '仅排演。生成报价 '+quote.credits+' 积分，本次额度 0，总上限 100。' :
        node.type === 'prompt' ? '提示词已读取' : '已检查成片时间线';
      receipts.push({nodeId:id, status:'dry-run',detail, ...(prompt === undefined ? {} : {prompt})});
    }
  }
  return {...result,receipts};
}
