/** Reproducible no-account example. Local echo receipts cannot enter a real project. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { initWorkspace, putBlob, recordRevision, exportShot } from './workspace.mjs';
import { submitGeneration, recordCollectedRun } from './generation.mjs';

export const sample = [[.92,1],[.87,1],[.79,0],[.75,1],[.62,0],[.57,1],[.43,0],[.21,0]];
export function renderDraft(rows = sample, step = rows.length) {
  const pos = rows.filter(r => r[1] === 1).length, neg = rows.length - pos;
  const thresholds = [...new Set(rows.map(r => r[0]))].sort((a,b) => b-a);
  const points = [[0,0], ...thresholds.map(t => [
    rows.filter(([s,y]) => s >= t && y === 0).length / neg,
    rows.filter(([s,y]) => s >= t && y === 1).length / pos,
  ])];
  const x = v => 74 + 375*v, y = v => 250 - 193*v;
  const visible = points.slice(0, step + 1);
  const line = visible.map(([f,t],i) => (i?'L':'M')+x(f)+' '+y(t)).join(' ');
  const grid = [0,.25,.5,.75,1].map(v => '<path d="M74 '+y(v)+'H449 M'+x(v)+' 57V250"/>').join('');
  const dots = visible.map(([f,t]) => '<circle cx="'+x(f)+'" cy="'+y(t)+'" r="3.7"/>').join('');
  return '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="320" viewBox="0 0 720 320"><rect width="720" height="320" fill="#13262c"/><g font-family="sans-serif" fill="#edf4ef"><text x="44" y="33" font-size="15">阈值如何改变分类结果</text><text x="74" y="274" font-size="11">0</text><text x="440" y="274" font-size="11">1</text><text x="42" y="62" font-size="11">1</text><text x="181" y="295" font-size="13">假阳性率 FPR →</text><text x="75" y="51" font-size="11">真阳性率 TPR ↑</text><text x="490" y="115" font-size="32">ROC</text><text x="490" y="148" font-size="16">八个模拟样本</text><text x="490" y="177" font-size="13">4 个阳性 · 4 个阴性</text><text x="490" y="240" font-size="12" fill="#9fb8b5">教学示意 · 无临床数据</text></g><g fill="none" stroke="#365057">'+grid+'</g><path d="M74 250L449 57" stroke="#809695" stroke-dasharray="4 7"/><path d="'+line+'" fill="none" stroke="#87dfc6" stroke-width="4"/><g fill="#b7f4df">'+dots+'</g></svg>';
}

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
  const draft = add('d.plot','draft','阈值扫描 · 可复算草稿',[prompt],{mime:'image/svg+xml',blob:putBlob(directory,renderDraft()),dataBasis:'8 个自造分数，四阳性四阴性。仅作示意。',samples:sample,renderer:'tooling/xatp/rehearsal.mjs#renderDraft',rendererHash:putBlob(directory,readFileSync(new URL(import.meta.url)))});
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
