import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {isDeepStrictEqual} from 'node:util';
import {compilePlan,createDemoPlan,dryRun,isPlanDocument} from './core.mjs';

function ledger(directory,write,task) {
  const file = join(directory,'xatp.sqlite');
  if (!existsSync(file)) throw new Error('WORKSPACE_NOT_INITIALIZED');
  const db = new DatabaseSync(file,{readOnly:!write,timeout:4000});
  try {
    db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
    if (!db.prepare('SELECT title FROM project').get()) throw new Error('WORKSPACE_NOT_INITIALIZED');
    if (write) db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_plans(revision INTEGER PRIMARY KEY, plan TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workflow_runs(attempt TEXT PRIMARY KEY, revision INTEGER NOT NULL, receipt TEXT NOT NULL);
    `);
    const result = task(db);
    db.exec('COMMIT');
    return result;
  } finally { db.close(); }
}

function snapshot(db) {
  const installed = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workflow_plans'").get();
  const row = installed && db.prepare('SELECT * FROM workflow_plans ORDER BY revision DESC LIMIT 1').get();
  const revision = row?.revision || 0;
  return {
    revision,plan:row ? JSON.parse(row.plan) : createDemoPlan(),
    receipts:installed ? db.prepare('SELECT receipt FROM workflow_runs WHERE revision=? ORDER BY rowid').all(revision).map(r=>JSON.parse(r.receipt)) : [],
  };
}

function bindRequest(binding) {
  if (!binding || ['tabId','documentId','toolId'].some(k => typeof binding[k] !== 'string' || !binding[k] || binding[k].length > 256)
      || Object.keys(binding).some(k => !['tabId','documentId','toolId'].includes(k))) throw new Error('SELECT_UPDREAM_EDITOR');
  return {providerId:'updream',tabId:binding.tabId,documentId:binding.documentId,toolId:binding.toolId};
}

export function createWorkflowHost(directory,getBrowser) {
  const read = () => ledger(directory,false,snapshot);
  const save = ({plan,revision}) => {
    if (!isPlanDocument(plan)) throw new Error('INVALID_WORKFLOW_PLAN');
    return ledger(directory,true,db => {
      const previous = snapshot(db);
      if (revision !== previous.revision) throw new Error('VERSION_CONFLICT');
      db.prepare('INSERT INTO workflow_plans VALUES (?,?)').run(revision+1,JSON.stringify(plan));
      return {plan,revision:revision+1,receipts:[]};
    });
  };
  const compile = ({plan,targetId}) => compilePlan(plan || read().plan,{targetId});
  async function run({plan,targetId,mode,binding}) {
    const state = read();
    plan ??= state.plan;
    const result = dryRun(plan,{targetId});
    if (mode === 'dry-run') {
      if (result.ok && isDeepStrictEqual(plan,state.plan)) {
        ledger(directory,true,db => {
          if (snapshot(db).revision !== state.revision) throw new Error('VERSION_CONFLICT');
          const record = db.prepare('INSERT OR REPLACE INTO workflow_runs VALUES (?,?,?)');
          for (const receipt of result.receipts) record.run('dry/'+state.revision+'/'+receipt.nodeId,state.revision,JSON.stringify(receipt));
        });
      }
      return result;
    }
    if (mode !== 'live') throw new Error('INVALID_RUN_MODE');
    const reject = message => ({...result,ok:false,errors:[...result.errors,message],receipts:[]});
    if (!result.ok) return {...result,receipts:[]};
    const nodes = result.order.map(id=>plan.nodes.find(n=>n.id===id));
    const clips = nodes.filter(n=>n.type === 'updream');
    // Preflight the entire slice before making a browser connection or reserving work.
    if (clips.some(n=>n.params.operation !== 'draft_prompt')) return reject('GENERATION_BLOCKED：MiniMax H3 最低 250 积分，本次 0，总上限 100。');
    const textNode = !clips.length && nodes.length===1 && nodes[0].type==='prompt' && nodes[0].id===targetId;
    if (!textNode && clips.length !== 1) return reject('SELECT_ONE_UPDREAM_PROMPT');
    if (!state.revision || !isDeepStrictEqual(plan,state.plan)) return reject('SAVE_CURRENT_PLAN_FIRST');
    const {id,params} = textNode ? nodes[0] : clips[0];
    const surface = textNode ? 'text_node' : params.surface;
    const {prompt} = result.receipts.find(receipt=>receipt.nodeId===id);
    const ref = bindRequest(binding);
    const browser = getBrowser();
    const observed = await browser.invoke({...ref,operation:textNode ? 'read_node_text' : 'read_prompt'});
    if (observed.surface !== surface) return reject('UPDREAM_SURFACE_CHANGED');
    if (observed.readback !== '' && observed.readback !== prompt) return reject('DRAFT_CONFLICT');
    const attempt = createHash('sha256').update(JSON.stringify([state.revision,id,ref.tabId,ref.documentId,ref.toolId])).digest('hex');
    let receipt = {nodeId:id,prompt,status:'pending',detail:'等待编辑器读回'};
    const claim = ledger(directory,true,db=>{
      if (snapshot(db).revision !== state.revision) throw new Error('VERSION_CONFLICT');
      const prior = db.prepare('SELECT receipt FROM workflow_runs WHERE attempt=?').get(attempt);
      if (prior) return JSON.parse(prior.receipt);
      db.prepare('INSERT INTO workflow_runs VALUES (?,?,?)').run(attempt,state.revision,JSON.stringify(receipt));
      return null;
    });
    if (claim && observed.readback !== prompt) return reject('DRAFT_RECONCILIATION_REQUIRED');
    if (observed.readback !== prompt) {
      // On a lost acknowledgement the reservation survives. A retry may reconcile by reading, never by retyping.
      const operation = textNode ? {operation:'save_node_text',text:prompt,expectedText:''} : {operation:'prepare_prompt',prompt,expectedCurrentText:''};
      const verified = await browser.invoke({...ref,...operation});
      if (verified.surface !== surface || verified.readback !== prompt || !verified.exactMatch || verified.creditsSpent !== 0) {
        return reject('DRAFT_READBACK_MISMATCH');
      }
    }
    receipt = {nodeId:id,status:'verified',prompt,detail:'Updream 编辑器逐字读回',surface,creditsSpent:0};
    ledger(directory,true,db=>db.prepare('UPDATE workflow_runs SET receipt=? WHERE attempt=?').run(JSON.stringify(receipt),attempt));
    return {...result,receipts:nodes.map(n=>n.id===id ? receipt : n.type==='prompt'
      ? {nodeId:n.id,status:'resolved',prompt:n.params.text,detail:'提示词已解析'} : {nodeId:n.id,status:'checked',detail:'已检查成片计划'})};
  }
  function h3Settings(operation,{binding,mode}) {
    const ref = bindRequest(binding);
    return getBrowser().invoke({...ref,operation,...(mode === undefined ? {} : {mode})});
  }
  async function checkH3Draft({binding}) {
    const ref = bindRequest(binding);
    const observed = await getBrowser().invoke({...ref,operation:'read_prompt'});
    if (observed.surface !== 'video' || typeof observed.readback !== 'string') throw new Error('SELECT_H3_VIDEO_EDITOR');
    return {surface:'video',empty:observed.readback === ''};
  }
  return {read,save,compile,run,checkH3Draft,
    readNodeText:({binding})=>getBrowser().invoke({...bindRequest(binding),operation:'read_node_text'}),
    saveNodeText:({binding,text,expectedText})=>getBrowser().invoke({...bindRequest(binding),operation:'save_node_text',text,expectedText}),
    selectH3Mode:args=>h3Settings('select_h3_mode',args),
    selectH3:args=>h3Settings('select_h3',args),
    quoteH3:args=>h3Settings('inspect_h3_quote',args),
    configureH3Minimum:args=>h3Settings('configure_h3_minimum',args),
  };
}
