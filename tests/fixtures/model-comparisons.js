// Synthetic original utterances for controlled comparison tests. These are
// fixtures, not observations attributed to a live model or an AML memory.
import { compareModelSources } from '../../src/model-comparison.js';
export function unchangedSourceCase(changedSpeech = false) {
  const fact = { id: 'fixture:magnitude', subject: 'usgs:fixture', predicate: 'magnitude', value: 2.9,
    source: 'fixture:source', validFrom: 0, validTo: 1, recordedAt: 1, supersedes: null };
  const encounter = (id, knownAt, text) => ({ id, scope: { subject: fact.subject, validAt: 0, knownAt },
    answer: { output: { text } }, read: { result: { data: { items: [fact] } } } });
  const context = {
    before: { sequence: 1, head: '1'.repeat(64), action: { result: encounter('before', 1, 'The magnitude is 2.9.') } },
    after: { sequence: 2, head: '2'.repeat(64), action: { result: encounter('after', 2,
      changedSpeech ? 'The magnitude is 3.4.' : 'The magnitude is 2.9.') } },
  };
  const read = { status: 'executed', call: { name: 'lalo_history', arguments: {
    subject: fact.subject, predicate: 'magnitude', knownAt: 2 } },
    result: { ok: true, data: { complete: true, items: [fact] } } };
  return { comparison: compareModelSources(context, read), read };
}
