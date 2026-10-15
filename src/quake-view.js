import { decodeJournal } from './journal.js';
import { validateUSGSJournal } from './sources/usgs.js';

export const QUAKE_RULE = 'magnitude-at-least/v1';
export const QUAKE_BUDGET = Object.freeze({ capacity: 1024, maxBytes: 2_000_000 });

// Imports extend the saved history exactly. Neither receipt clocks nor old rows move.
export function extendQuakeJournal(ledger, text) {
  const candidate = validateUSGSJournal(decodeJournal(text, QUAKE_BUDGET));
  const old = ledger.entries(), next = candidate.entries();
  if (next.length < old.length || old.some((f, i) => JSON.stringify(f) !== JSON.stringify(next[i])))
    throw new Error('Import must extend this journal. Export it and use --prior for the next CLI poll.');
  return candidate;
}

// A version's companion facts are selected by the same source version, not today's head.
export function quakeVersions(ledger, { knownAt, subject } = {}) {
  if (!Number.isSafeInteger(knownAt)) throw new TypeError('knownAt must be an integer timestamp');
  const facts = ledger.entries().filter(f => f.recordedAt <= knownAt);
  const byID = new Map(facts.map(f => [f.id, f]));
  return facts.filter(f => f.predicate === 'source_updated_at' && (!subject || f.subject === subject)).map(f => {
    const prefix = `${f.subject}:${f.value}:`;
    const value = predicate => byID.get(prefix + predicate)?.value;
    return { subject: f.subject, id: f.subject.slice(5), source: f.source,
      updatedAt: f.value, receivedAt: f.recordedAt, time: f.validFrom,
      magnitude: value('magnitude'), magnitudeType: value('magnitude_type'),
      place: value('place'), longitude: value('longitude'), latitude: value('latitude'),
      depth: value('depth_km'), type: value('event_type'), magnitudeID: prefix + 'magnitude' };
  });
}

export function quakeCatalog(ledger, { knownAt }) {
  const latest = new Map();
  for (const version of quakeVersions(ledger, { knownAt })) latest.set(version.subject, version);
  return [...latest.values()].sort((a, b) => a.subject.localeCompare(b.subject));
}

export function quakeView(ledger, { subject, validAt, knownAt, threshold = 3 }) {
  if (typeof threshold !== 'number' || !Number.isFinite(threshold)) throw new TypeError('threshold must be finite');
  const query = { subject, predicate: 'magnitude', validAt, knownAt };
  function reading(at) {
    const claims = ledger.asOf({ ...query, knownAt: at });
    if (claims.some(f => f.value !== null && (typeof f.value !== 'number' || !Number.isFinite(f.value))))
      throw new TypeError('magnitude-at-least requires numeric or explicit null premises');
    const supporting = claims.filter(f => f.value !== null && f.value >= threshold);
    const opposing = claims.filter(f => f.value !== null && f.value < threshold);
    const unknown = claims.filter(f => f.value === null);
    const state = supporting.length && opposing.length ? 'contested'
      : !claims.length || unknown.length ? 'unsettled' : supporting.length ? 'supported' : 'contradicted';
    return { rule: QUAKE_RULE, subject, predicate: 'magnitude', threshold, validAt, knownAt: at,
      state, supporting, opposing, unknown, premises: claims.map(f => f.id),
      validFrom: claims.length ? Math.max(...claims.map(f => f.validFrom)) : null,
      validTo: claims.reduce((end, f) => f.validTo === null ? end
        : end === null ? f.validTo : Math.min(end, f.validTo), null) };
  }
  const current = reading(knownAt);
  const history = ledger.entries().filter(f => f.subject === subject && f.predicate === 'magnitude' && f.recordedAt <= knownAt);
  const active = new Set(current.premises), replaced = new Set(history.map(f => f.supersedes));
  return { current, title: subject?.replace(/^usgs:/, '') || 'waiting for evidence',
    records: history.map((fact, i) => ({ fact, label: `M ${fact.value ?? '?'} · v${i + 1}`,
      state: active.has(fact.id) ? fact.value === null ? 'unknown' : fact.value >= threshold ? 'supporting' : 'opposing'
        : replaced.has(fact.id) ? 'superseded' : 'outside interval' })),
    layers: [...new Set(history.map(f => f.recordedAt))].map(reading),
    corrections: history.filter(f => f.supersedes).map(f => ({ from: f.supersedes, to: f.id })) };
}
