/** A durable submission intent precedes the provider call; recovery only queries its outcome. */
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { generationInputs, putBlob, recordRevision } from './workspace.mjs';

const sha = data => createHash('sha256').update(data).digest('hex');
const ref = r => ({ id: r.id, version: r.version });
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function journal(directory, fn) {
  const db = new DatabaseSync(join(directory, 'xatp.sqlite'), { timeout: 4000 });
  try {
    db.exec('BEGIN IMMEDIATE');
    db.exec('CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } finally { db.close(); }
}
const get = (db,id) => JSON.parse(db.prepare('SELECT payload FROM jobs WHERE id=?').get(id)?.payload ?? 'null');
const update = (db,job) => db.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify(job), job.id);
function checkProvider(provider, mode) {
  if (!provider?.id || !provider.referenceImage || provider.mode !== mode) throw new Error('PROVIDER_UNAVAILABLE');
  if (provider.cost !== 'free') throw new Error('BUDGET_REQUIRED');
}

export function getJob(directory, id) { return journal(directory, db => get(db,id)); }

/** Reuse of an intent key with different bytes, settings or a different provider is rejected. */
export async function submitGeneration(directory, { id, prompt, draft, parameters = {} }, provider) {
  if (typeof id !== 'string' || !/^[\w.-]{1,80}$/.test(id)) throw new Error('INVALID_JOB_ID');
  const inputs = generationInputs(directory, prompt, draft);
  checkProvider(provider, inputs.mode);
  const spec = { provider: provider.id, prompt: ref(inputs.prompt), draft: ref(inputs.draft), text: inputs.prompt.data.text, draftHash: inputs.draft.data.blob, mime: inputs.draft.data.mime, parameters: canonical(parameters) };
  const fingerprint = sha(JSON.stringify(spec));
  const { job, fresh } = journal(directory, db => {
    const prior = get(db,id);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new Error('INTENT_CONFLICT');
      return { job: prior, fresh: false };
    }
    const job = { id, requestId: randomUUID(), fingerprint, spec, status: 'unconfirmed' };
    db.prepare('INSERT INTO jobs VALUES (?,?)').run(id,JSON.stringify(job));
    return { job, fresh: true };
  });
  if (!fresh) return job;
  // An exception after admission cannot distinguish a rejected call from a lost receipt.
  const receipt = await provider.submit({ ...spec, requestId: job.requestId, bytes: inputs.draftBytes });
  return collect(directory, job, receipt);
}

/** A provider can return null when it cannot uniquely match a remote operation. */
export async function reconcileGeneration(directory, id, provider) {
  const job = getJob(directory, id);
  if (!job || provider.id !== job.spec.provider) throw new Error('UNKNOWN_INTENT');
  if (job.status === 'collected') return job;
  return collect(directory, job, await provider.lookup(job.requestId));
}
function collect(directory, job, receipt) {
  if (!receipt) return getJob(directory, job.id);
  if (receipt.requestId !== job.requestId || receipt.text !== job.spec.text || receipt.draftHash !== job.spec.draftHash || !receipt.remoteId || !receipt.mime || !(receipt.bytes instanceof Uint8Array) || !receipt.bytes.length) throw new Error('RECEIPT_MISMATCH');
  const outputHash = putBlob(directory, receipt.bytes);
  return journal(directory, db => {
    const latest = get(db,job.id);
    if (latest.status === 'collected') {
      if (latest.outputHash !== outputHash || latest.remoteId !== receipt.remoteId) throw new Error('RECEIPT_CONFLICT');
      return latest;
    }
    const result = { ...latest, status: 'collected', remoteId: receipt.remoteId, outputHash, outputMime:receipt.mime, model:receipt.model ?? null };
    update(db,result);
    return result;
  });
}

/** A reviewed timeline asset must refer to a concrete run revision. */
export function recordCollectedRun(directory, jobId) {
  const job = getJob(directory,jobId);
  if (job?.status !== 'collected') throw new Error('RECEIPT_REQUIRED');
  return recordRevision(directory,{ id: 'run.' + job.id, kind:'run', title:job.spec.provider + ' · ' + job.remoteId, inputs:[job.spec.prompt, job.spec.draft], data:{status:'accepted', provider:job.spec.provider, remoteId:job.remoteId, requestId:job.requestId, model:job.model, parameters:job.spec.parameters, text:job.spec.text, draftHash:job.spec.draftHash, outputHash:job.outputHash} },0);
}
