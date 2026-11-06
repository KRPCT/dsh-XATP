/** Render simulated binary scores as a threshold-swept ROC curve. No external inputs. */
export const sample = [[.92,1],[.87,1],[.79,0],[.75,1],[.62,0],[.57,1],[.43,0],[.21,0]];
export function renderDraft(rows = sample, step = rows?.length) {
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > 512 || !rows.every(row =>
    Array.isArray(row) && row.length === 2 && Number.isFinite(row[0]) && (row[1] === 0 || row[1] === 1))) {
    throw new Error('INVALID_SIMULATED_ROWS');
  }
  const pos = rows.filter(r => r[1] === 1).length, neg = rows.length - pos;
  if (!pos || !neg) throw new Error('BOTH_CLASSES_REQUIRED');
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
  return '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="320" viewBox="0 0 720 320"><rect width="720" height="320" fill="#13262c"/><g font-family="sans-serif" fill="#edf4ef"><text x="44" y="33" font-size="15">阈值如何改变分类结果</text><text x="74" y="274" font-size="11">0</text><text x="440" y="274" font-size="11">1</text><text x="42" y="62" font-size="11">1</text><text x="181" y="295" font-size="13">假阳性率 FPR →</text><text x="75" y="51" font-size="11">真阳性率 TPR ↑</text><text x="490" y="115" font-size="32">ROC</text><text x="490" y="148" font-size="16">'+rows.length+' 个模拟样本</text><text x="490" y="177" font-size="13">'+pos+' 个阳性 · '+neg+' 个阴性</text><text x="490" y="240" font-size="12" fill="#9fb8b5">教学示意 · 无临床数据</text></g><g fill="none" stroke="#365057">'+grid+'</g><path d="M74 250L449 57" stroke="#809695" stroke-dasharray="4 7"/><path d="'+line+'" fill="none" stroke="#87dfc6" stroke-width="4"/><g fill="#b7f4df">'+dots+'</g></svg>';
}
