// Source changes between two AML-addressed magnitude encounters.
import { decodeJournal, encodeJournal } from './journal.js';
import { sameToolResult } from './tools.js';
const fail = message => Object.assign(new Error(message), { code: 'MODEL_COMPARISON' });
const hex = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const copy = v => JSON.parse(JSON.stringify(v));

export const comparisonReferences = context => Object.fromEntries(['before', 'after'].map(key =>
  [key, { sequence: context[key].sequence, head: context[key].head }]));

// Reconstruct each original snapshot as a prefix, and verify the AML SHA-256.
// replayEncounter is injected to keep this module independent of generation.
export async function validateModelComparison(journal, input, agent, identity, replayEncounter) {
  if (!input || new TextEncoder().encode(JSON.stringify(input)).length > 65_536)
    throw fail('Comparison context must fit 65536 UTF-8 bytes');
  const context = copy(input), world = decodeJournal(journal), rows = world.entries();
  if (Object.keys(context).sort().join(',') !== 'after,before') throw fail('Supply before and after AML encounters');
  for (const key of ['before', 'after']) {
    const c = context[key], e = c?.action?.result, s = c?.snapshot;
    if (!Number.isSafeInteger(c?.sequence) || c.sequence < 1 || !hex(c.head)
      || !hex(s?.sha256) || !Number.isSafeInteger(s.records) || s.records < 0 || s.records > rows.length
      || !Number.isSafeInteger(s.bytes) || s.bytes < 1
      || c.action?.status !== 'executed' || e?.format !== 'lalo/model-encounter'
      || ![1, 2].includes(e.version) || e.version === 2 && e.activity !== 'magnitude'
      || e.agent !== agent || e.identity?.sha256 !== identity.sha256)
      throw fail('Select completed magnitude encounters of this agent and weight identity');
    const prefix = encodeJournal(decodeJournal(JSON.stringify({ format: 'lalo/journal', version: 1,
      records: rows.slice(0, s.records) })));
    const bytes = new TextEncoder().encode(prefix);
    const sha = Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)),
      v => v.toString(16).padStart(2, '0')).join('');
    if (sha !== s.sha256 || bytes.length !== s.bytes) throw fail('Current world diverges from a saved encounter snapshot');
    const replay = await replayEncounter(prefix, c.action);
    if (replay.comparison !== 'match') throw fail('Saved model evidence does not reproduce');
  }
  const b = context.before.action.result, a = context.after.action.result;
  if (context.before.sequence >= context.after.sequence || context.before.snapshot.records >= context.after.snapshot.records
    || b.id === a.id || b.scope.subject !== a.scope.subject || b.scope.validAt !== a.scope.validAt
    || b.scope.knownAt > a.scope.knownAt || b.answer.observedAt > a.startedAt)
    throw fail('Compare chronological encounters for the same event and world instant');
  return context;
}

export function compareModelSources(context, read) {
  if (read?.status !== 'executed' || read.call?.name !== 'lalo_history' || !read.result?.ok || !read.result.data?.complete)
    throw fail('Comparison needs a complete source history');
  const before = context.before.action.result, after = context.after.action.result;
  const history = read.result.data.items, byId = new Map(history.map(f => [f.id, f]));
  const old = before.read.result.data.items, now = after.read.result.data.items;
  if (read.call.arguments.subject !== after.scope.subject || read.call.arguments.knownAt !== after.scope.knownAt
    || read.call.arguments.predicate !== 'magnitude'
    || [...old, ...now].some(f => !sameToolResult(f, byId.get(f.id))))
    throw fail('History must contain the original source rows at the later encounter cutoff');
  const oldIds = new Set(old.map(f => f.id)), newIds = new Set(now.map(f => f.id));
  const added = now.filter(f => !oldIds.has(f.id)), removed = old.filter(f => !newIds.has(f.id));
  const revisions = [];
  for (const row of added) {
    const path = [row.id]; let next = row;
    while (next.supersedes !== null) {
      next = byId.get(next.supersedes);
      if (!next || path.includes(next.id)) throw fail('Source history has an unresolved predecessor');
      path.unshift(next.id);
      if (oldIds.has(next.id)) {
        revisions.push({ before: next.id, after: row.id, path, from: next.value, to: row.value });
        break;
      }
    }
  }
  return { format: 'lalo/model-source-comparison', version: 1, references: comparisonReferences(context),
    subject: after.scope.subject, validAt: after.scope.validAt,
    before: { encounter: before.id, answerReceipt: `model:${before.id}:answer:utterance`,
      answer: before.answer.output.text, knownAt: before.scope.knownAt, premises: old.map(f => f.id) },
    after: { encounter: after.id, answerReceipt: `model:${after.id}:answer:utterance`,
      answer: after.answer.output.text, knownAt: after.scope.knownAt, premises: now.map(f => f.id) },
    answersChanged: before.answer.output.text !== after.answer.output.text,
    evidenceChanged: !sameToolResult(old, now), added: added.map(f => f.id), removed: removed.map(f => f.id),
    independentAdditions: added.filter(f => f.supersedes === null).map(f => f.id),
    unmatchedRevisions: added.filter(f => f.supersedes !== null && !revisions.some(r => r.after === f.id)).map(f => f.id), revisions };
}

export function modelChangePrompt(question, comparison, read, version = 2) {
  if (![1, 2].includes(version)) throw fail('Unsupported comparison presentation');
  if (comparison?.format !== 'lalo/model-source-comparison' || comparison.version !== 1)
    throw fail('Answer generation requires a source comparison');
  if (version === 2 && comparison.evidenceChanged === false) {
    const finding = comparison.answersChanged
      ? 'the answer text changed; the source did not change.'
      : 'no change in either the answer or the source.';
    const task = comparison.answersChanged ? 'Summarize this result in one sentence.'
      : 'State that both the answer and the source stayed the same.';
    return `Comparison result: ${finding}\nEarlier answer: ${JSON.stringify(comparison.before.answer)}\nLater answer: ${JSON.stringify(comparison.after.answer)}\n${task}`;
  }
  const revisions = comparison.revisions;
  if (revisions.length && comparison.added.length === revisions.length
    && comparison.removed.length === new Set(revisions.map(r => r.before)).size) {
    const source = revisions.map(r => ({ earlierMagnitude: r.from, revisedMagnitude: r.to }));
    return `Verified source revision: ${JSON.stringify(source)}\nEarlier answer: ${JSON.stringify(comparison.before.answer)}\nLater answer: ${JSON.stringify(comparison.after.answer)}\nState the old and revised magnitudes in one sentence.`;
  }
  const byId = new Map(read.result.data.items.map(f => [f.id, f]));
  const values = side => comparison[side].premises.map(id => byId.get(id).value);
  const evidence = { earlierAnswer: comparison.before.answer, laterAnswer: comparison.after.answer,
    earlierMagnitudes: values('before'), laterMagnitudes: values('after'),
    sourceRevisions: comparison.revisions.map(r => ({ from: r.from, to: r.to })),
    newIndependentMagnitudes: comparison.independentAdditions.map(id => byId.get(id).value),
    newlyApplicableRevisedMagnitudes: comparison.unmatchedRevisions.map(id => byId.get(id).value),
    answersChanged: comparison.answersChanged, evidenceChanged: comparison.evidenceChanged };
  return `Question: ${question}\nDon compared your saved answers and their source receipts:\n${JSON.stringify(evidence)}\nExplain the change using these records in one short sentence.`;
}
