/** Reproducible no-account example. Local echo receipts cannot enter a real project. */
import { pathToFileURL } from 'node:url';
import { initWorkspace, putBlob, recordRevision, exportShot } from './workspace.mjs';
import { recordRocDraft } from './roc-draft.mjs';
import { sample } from './roc-renderer.mjs';
import { submitGeneration, recordCollectedRun } from './generation.mjs';

export { renderDraft, sample } from './roc-renderer.mjs';

export const localRenderer = {
  id:'local-draft-echo', mode:'demo', referenceImage:true, cost:'free',
  async submit({requestId,text,draftHash,bytes,mime}) { return {requestId,text,draftHash,bytes,mime,remoteId:'local-'+requestId.slice(0,8),model:null}; },
  async lookup() { return null; }
};

export async function createRehearsal(directory, renderer = localRenderer) {
  initWorkspace(directory,'记忆的线索 · 模型可视化','demo');
  const add = (id,kind,title,inputs,data) => recordRevision(directory,{id,kind,title,inputs,data},0);
  const query = add('q.roc','query','如何解释分类阈值？',[],{provider:'rehearsal',question:'阈值怎样改变真假阳性率？',observedAt:new Date().toISOString(),blob:putBlob(directory,'本地排演。未执行 LeapSpace 查询。')});
  const source = add('s.fawcett','source','An introduction to ROC analysis',[query],{citation:'T. Fawcett. Pattern Recognition Letters, 27 (2006), 861–874.',doi:'10.1016/j.patrec.2005.10.010',locator:'ROC curves, Fig. 3',reviewedBy:'公开论文比对；平台查询待验',url:'https://doi.org/10.1016/j.patrec.2005.10.010'});
  const claim = add('c.threshold','claim','阈值决定 ROC 平面上的工作点',[source],{statement:'改变同一组分数的分类阈值，每个阈值给出一对假阳性率与真阳性率。',scope:'用于解释二元分类。示例不报告任何疾病预测模型的性能。'});
  const concept = add('k.frame','concept','固定坐标，逐个放宽阈值',[],{rationale:'让观众比较同一组样本的分类变化。'});
  const prompt = add('p.plot','prompt','锁定坐标轴与阈值顺序',[claim,concept],{text:'保留草稿中的两根坐标轴、阶梯路径和点位。镜头停留六秒。画面注明八个样本为模拟值。',creativeRationale:'用同一坐标系展示变化，让观众能沿每个折点核查。'});
  const draft = recordRocDraft(directory,{id:'d.plot',expectedVersion:0,promptId:prompt.id,promptVersion:prompt.version,dataClass:'simulated',rows:sample});
  const job = await submitGeneration(directory,{id:'shot01',prompt,draft,parameters:{seconds:6}},renderer);
  const run = recordCollectedRun(directory,job.id);
  const film = job.outputMime === 'video/webm';
  const asset = add('a.frame','asset',film ? '阈值扫描 · 六秒排演' : '阈值扫描 · 审阅帧',[run],{blob:job.outputHash,mime:job.outputMime,rights:'项目原创教学示意',reviewedBy:film ? '本地渲染排演' : '本地逐字节比对',method:film ? '用同一组演示分数和草稿逐帧编码；本地生成，不调用 AI 视频模型。' : '本地回显草稿，无远端视频生成'});
  const shot = add('shot.01','shot','阈值怎样改变分类结果？',[asset],{startMs:0,endMs:6000,description:'固定坐标后逐步放宽阈值。观众可沿审阅帧回到样本、提示词与方法出处。'});
  return exportShot(directory,shot);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Use: node rehearsal.mjs <empty project directory>');
  const out = await createRehearsal(process.argv[2]);
  console.log(JSON.stringify({ mode:out.mode,shot:out.shot,records:out.records.length }));
}
