// A reading and its revisions use the same rule and complete premise set.
import { hypothesis, magnitudeHypothesis, RULE } from './hypothesis.js';
import { readingBatches } from './janus-calendar.js';

export function readRule(ledger, query) {
  let reading;
  try { reading = query.rule === RULE ? hypothesis(ledger, query) : magnitudeHypothesis(ledger, query); }
  catch (error) { throw Object.assign(error, { code: 'INVALID_PREMISES' }); }
  const { supporting, opposing, unknown = [], premises, ...summary } = reading;
  const evidence = new Map();
  for (const [role, facts] of Object.entries({ supporting, opposing, unknown }))
    for (const fact of facts) evidence.set(fact.id, { role, fact });
  return { evidence, premises, summary: { ...summary, premiseCount: premises.length,
    counts: { supporting: supporting.length, opposing: opposing.length, unknown: unknown.length } } };
}

export async function readingTimeline(ledger, query) {
  const { sinceKnownAt, knownAt, subject, predicate } = query;
  const records = ledger.entries().filter(f => f.subject === subject && f.predicate === predicate);
  const { batches, api, wasmSha256 } = await readingBatches(records, sinceKnownAt, knownAt);
  let previous = readRule(ledger, { ...query, knownAt: sinceKnownAt });
  const baselineState = previous.summary.state;
  const rows = previous.premises.map(id => ({ step: 0, knownAt: sinceKnownAt, kind: 'baseline',
    state: baselineState, ...previous.evidence.get(id) }));
  let changeCount = 0;
  for (const [at, batch] of batches) {
    const current = readRule(ledger, { ...query, knownAt: at });
    const previousState = previous.summary.state, state = current.summary.state;
    const step = changeCount + 1;
    for (const fact of batch) {
      const role = current.evidence.get(fact.id)?.role ?? null;
      const removedRole = previous.evidence.get(fact.supersedes)?.role ?? null;
      if (role === null && removedRole === null) continue;
      rows.push({ step, knownAt: at, kind: previousState === state ? 'evidence' : 'verdict',
        previousState, state, role, removedRole, fact });
      changeCount = step;
    }
    previous = current;
  }
  return { rows, reading: { ...previous.summary, knownAt },
    timeline: { sinceKnownAt, baselineState, changeCount, api, wasmSha256 } };
}
