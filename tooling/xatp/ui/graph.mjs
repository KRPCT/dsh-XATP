/** Preserve exact version edges alongside the latest revision of each record. */
export function recordGraph(records) {
  const keyOf = ({ id, version }) => JSON.stringify([id, version]);
  const byVersion = new Map();
  const latest = new Map();
  const revisions = new Map();
  const users = new Map();
  for (const record of records) {
    byVersion.set(keyOf(record), record);
    if (!latest.has(record.id) || latest.get(record.id).version < record.version) latest.set(record.id, record);
    if (!revisions.has(record.id)) revisions.set(record.id, []);
    revisions.get(record.id).push(record);
    for (const ref of record.inputs) {
      const key = keyOf(ref);
      if (!users.has(key)) users.set(key, []);
      users.get(key).push(record);
    }
  }
  function inputs(record) { return record.inputs.map((r) => byVersion.get(keyOf(r)) ?? r); }
  function uses(record) { return users.get(keyOf(record)) ?? []; }
  function walk(record, neighbors, match, first = false) {
    const found = [];
    const seen = new Set([keyOf(record)]);
    const pending = neighbors(record).slice();
    for (let i = 0; i < pending.length; i++) {
      const next = pending[i];
      const key = keyOf(next);
      if (!next.kind || seen.has(key)) continue;
      seen.add(key);
      if (match(next)) {
        found.push(next);
        if (first) return found;
      }
      pending.push(...neighbors(next));
    }
    return found;
  }
  return { keyOf, byVersion, latest, revisions, inputs, uses, walk };
}
