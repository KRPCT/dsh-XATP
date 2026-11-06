/** Project the current revision of every dependency in append order. */
export function markRevisions(records) {
  const heads = new Map(records.map(r => [r.id, r.version])), byRef = new Map();
  return records.map(item => {
    const stale = item.version !== heads.get(item.id) || item.inputs.some(ref => byRef.get(ref.id + '@' + ref.version).stale);
    const record = {...item, stale};
    byRef.set(item.id + '@' + item.version, record);
    return record;
  });
}

/** Return only fields a prompt author can revise; an altered prompt needs fresh review. */
export function revisePrompt(records, { id, expectedVersion, text, creativeRationale }) {
  if (![text,creativeRationale].every(v => typeof v === 'string' && v.trim()) || text.length > 16000 || creativeRationale.length > 4000) throw new Error('PROMPT_TEXT_REQUIRED');
  const prior = records.findLast(r => r.id === id);
  if (prior?.kind !== 'prompt' || prior.version !== expectedVersion) throw new Error('VERSION_CONFLICT');
  if (prior.stale) throw new Error('STALE_INPUT');
  return {id, kind:'prompt', title:prior.title, inputs:prior.inputs, data:{text,creativeRationale,reviewStatus:'needs-review'}};
}
