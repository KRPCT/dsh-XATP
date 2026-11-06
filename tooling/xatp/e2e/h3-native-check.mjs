/** One zero-submit check of a selected video node using DSH's installed native executor. */
import {mkdtemp,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {localEndpoint} from '../browser/cdp.mjs';
import {initWorkspace} from '../workspace.mjs';
import {H3_POLICY,h3Estimate} from '../updream/h3-tariff.mjs';
import {h3ModeControls} from '../updream/video-settings.mjs';

const require = createRequire(new URL('../../../packages/core/tools/package.json',import.meta.url));
const model = H3_POLICY.model;
const minimum = h3Estimate({model,seconds:H3_POLICY.minSeconds,resolution:'768P'}).credits;
const report = {scope:'dsh_native_updream_h3',status:'blocked',submitted:false};
let reason = 'initialization_failed';
function need(condition,code) {
  if (!condition) {reason=code;throw new Error(code);}
}

async function main() {
  const args=process.argv.slice(2), write=args[0]==='--write-empty';
  need(args.length===0 || (write && args.length===1),'unsupported_input');
  const endpoint=process.env.XATP_CDP_ENDPOINT, tabId=process.env.XATP_TEST_UPDREAM_DRAFT_TAB;
  need(endpoint,'endpoint_missing');
  need(!write || tabId,'write_requires_explicit_tab');
  const dshWebOrigin=process.env.XATP_DSH_ORIGIN;
  reason='invalid_loopback_origin';
  localEndpoint(endpoint);
  reason='build_native_plugin_and_dsh_first';
  const workbench=await import('../plugin/dist/host.mjs');
  const {Context}=require('@deepseek-ai/cordis');
  const {default:SystemPrompt}=require('@deepseek-ai/dsh-system-prompt');
  const {default:Tools}=require('@deepseek-ai/dsh-tools');
  const NativeExecutor=require('@deepseek-ai/dsh-tool-executor-native');
  const signal=AbortSignal.timeout(45_000), ctx=new Context();
  const directory=await mkdtemp(join(tmpdir(),'xatp-h3-check-'));
  try {
    initWorkspace(directory,'H3 pre-submission check');
    await ctx.plugin(SystemPrompt);
    await ctx.plugin(Tools);
    await ctx.plugin(NativeExecutor);
    await ctx.plugin(workbench,{directory,cdpEndpoint:endpoint,dshWebOrigin});
    let seq=0;
    async function execute(name,args={}) {
      reason=name+'_failed';
      signal.throwIfAborted();
      const {results}=await ctx.tools.execute({calls:[{type:'tool-call',id:String(++seq),name,
        arguments:JSON.stringify(args)}],signal});
      if (results[0]?.result.error?.message==='quote_unconfirmed') reason='quote_unconfirmed';
      need(results.length===1 && results[0].result.isError===false,reason);
      return JSON.parse(results[0].result.content[0].text);
    }
    const tabs=(await execute('xatp_list_tabs')).filter(tab=>tab.providerId==='updream'
      && new URL(tab.url).pathname==='/canvas' && (!tabId || tab.tabId===tabId));
    need(tabs.length===1,tabs.length?'select_one_canvas':'canvas_not_found');
    const target={tabId:tabs[0].tabId,providerId:'updream'};
    const {documentId,tools}=await execute('xatp_discover',target);
    const settings=tools.filter(t=>t.surface==='video_settings' && !t.disabled);
    const editors=tools.filter(t=>t.surface==='video' && !t.disabled && t.operations.includes('read_prompt'));
    need(settings.length===1 && editors.length===1,'select_one_h3_video_node');
    const binding=tool=>({tabId:target.tabId,documentId,toolId:tool.toolId});
    const modes=settings[0].h3Modes, known=Object.keys(h3ModeControls);
    need(known.every(mode=>modes?.available?.includes(mode)) && known.includes(modes?.selected),'h3_modes_incomplete');
    const quote=await execute('xatp_quote_h3',{binding:binding(settings[0])});
    need(quote.model===model && quote.creditsSpent===0,'unexpected_model_or_quote');
    const baseline=h3Estimate({model,seconds:quote.seconds,resolution:quote.resolution}).credits;
    need(quote.quoteMode===modes.selected,'mode_changed_during_check');
    need(['matched_no_reference_tariff','observed_only'].includes(quote.quoteStatus),'quote_unconfirmed');
    report.quote={model,seconds:quote.seconds,resolution:quote.resolution,displayedCredits:quote.displayedCredits,
      quoteStatus:quote.quoteStatus,noReferenceEstimate:baseline};
    report.modes={available:modes.available,selected:quote.quoteMode};
    const ref=binding(editors[0]);
    // This native read returns only whether the selected editor is empty.
    const before=await execute('xatp_check_h3_draft',{binding:ref});
    need(before.surface==='video' && typeof before.empty==='boolean','draft_readback_failed');
    report.draft=before.empty?'empty_editor_observed':'existing_draft_preserved';
    if (write) {
      need(quote.quoteStatus==='matched_no_reference_tariff' && quote.seconds===5 && quote.resolution==='768P' && quote.displayedCredits===minimum,'minimum_quote_required');
      need(before.empty,'existing_draft_preserved');
      const {plan,revision}=await execute('xatp_orchestration_read');
      const promptNode=plan.nodes.find(n=>n.id==='prompt-01');
      const clip=plan.nodes.find(n=>n.id==='updream-01');
      need(promptNode?.params && clip?.params?.surface==='video','check_plan_invalid');
      promptNode.params.text='XATP 零积分验收草稿｜固定机位，保留原有坐标与标注。';
      await execute('xatp_orchestration_save',{plan,revision});
      for(let i=0;i<2;i++){
        const live=await execute('xatp_orchestration_run',{targetId:clip.id,mode:'live',binding:ref});
        const receipt=live.receipts.find(r=>r.nodeId===clip.id);
        need(live.ok && receipt?.status==='verified' && receipt.prompt===promptNode.params.text
          && receipt.creditsSpent===0,'native_draft_not_verified');
      }
      report.draft='native_write_readback_and_retry_verified';
    }
    report.status=quote.quoteStatus==='observed_only'?'observed_only':'checked';
    if (report.status==='observed_only') process.exitCode=2;
  } finally {
    try {await ctx.fiber.dispose();} finally {await rm(directory,{recursive:true,force:true});}
  }
}

try {await main();} catch {report.status='blocked';report.reason=reason;process.exitCode=2;}
console.log(JSON.stringify(report));
