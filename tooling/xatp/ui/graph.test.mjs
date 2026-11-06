import assert from 'node:assert/strict';
import test from 'node:test';
import { recordGraph } from './graph.mjs';

test('a shot keeps its original query after a revision and a shared source appears once', () => {
  const ref = (id, version = 1) => ({ id, version });
  const record = (kind, id, inputs = [], version = 1) => ({ ...ref(id, version), kind, inputs });
  const q1 = record('query', 'q');
  const q2 = record('query', 'q', [], 2);
  const a = record('source', 'a', [ref('q')]);
  const b = record('source', 'b', [ref('q')]);
  const s = record('shot', 's', [ref('a'), ref('b')]);
  const graph = recordGraph([q1, a, b, s, q2]);
  assert.equal(graph.latest.get('q'), q2);
  assert.deepEqual(graph.walk(s, graph.inputs, (r) => r.kind === 'query'), [q1]);
  assert.deepEqual(graph.walk(q1, graph.uses, (r) => r.kind === 'shot'), [s]);
  assert.deepEqual(graph.uses(q2), []);
});
