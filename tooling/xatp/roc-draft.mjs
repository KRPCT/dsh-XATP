/** Append a reproducible teaching draft. The renderer and its input scores are archived as exact bytes. */
import { readFileSync } from 'node:fs';
import { putBlob,readWorkspace,recordRevision } from './workspace.mjs';
import { renderDraft } from './roc-renderer.mjs';

const source = readFileSync(new URL('./roc-renderer.mjs',import.meta.url));

export function recordRocDraft(directory, {id,expectedVersion,promptId,promptVersion,dataClass,rows}) {
  if (dataClass !== 'simulated') throw new Error('SIMULATED_DATA_ONLY');
  if (rows === undefined) throw new Error('INVALID_SIMULATED_ROWS');
  const svg = renderDraft(rows);
  const { records } = readWorkspace(directory);
  const prompt = records.find(r => r.id === promptId && r.version === promptVersion);
  if (prompt?.kind !== 'prompt') throw new Error('PROMPT_REQUIRED');
  if (prompt.stale) throw new Error('STALE_INPUT');
  const head = records.findLast(r => r.id === id);
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(id)) throw new Error('INVALID_RECORD');
  if ((head?.version ?? 0) !== expectedVersion) throw new Error('VERSION_CONFLICT');
  if (head && head.kind !== 'draft') throw new Error('KIND_CHANGED');
  return recordRevision(directory, {id,kind:'draft',title:'阈值扫描 · 可复算草稿',
    inputs:[{id:promptId,version:promptVersion}],
    data:{mime:'image/svg+xml',blob:putBlob(directory,svg),dataClass,
      dataBasis:rows.length + ' 个模拟样本，仅用于二元分类教学示意。',samples:rows,
      samplesHash:putBlob(directory,JSON.stringify(rows)),renderer:'roc-renderer.mjs#renderDraft',
      rendererHash:putBlob(directory,source)},
  },expectedVersion);
}
