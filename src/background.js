// One bounded world, independent of model calls. No ambient clocks or I/O.
import { FactLedger } from './ledger.js';
import { encodeJournal, decodeJournal } from './journal.js';
import { ingestUSGS, validateUSGSJournal } from './sources/usgs.js';

export const BACKGROUND_BUDGET = Object.freeze({ capacity: 1024, maxBytes: 2_000_000, maxEvents: 64 });
export const isAgent = value => typeof value === 'string' && /^agent:[a-zA-Z0-9_-]{1,100}$/.test(value);
export const isQuake = value => typeof value === 'string' && /^usgs:[a-zA-Z0-9_-]{1,100}$/.test(value);

function signal(fact) {
  if (!isAgent(fact.subject)) throw new TypeError('signal subject must be agent:<identifier>');
  if (fact.predicate === 'attention_subject' && fact.value !== null && !isQuake(fact.value))
    throw new TypeError('attention_subject must name a USGS subject or explicit null');
}

// Existing source validation operates on its own ordered projection. Signals and
// source observations still share one receipt order and one storage budget.
export function readBackground(journal, budget = BACKGROUND_BUDGET) {
  const world = decodeJournal(journal, budget), quakes = new FactLedger({ capacity: budget.capacity });
  for (const fact of world.entries()) {
    if (isQuake(fact.subject)) quakes.add(fact);
    else signal(fact);
  }
  validateUSGSJournal(quakes);
  return { world, quakes };
}

export function createBackground(journal = encodeJournal(new FactLedger()), options = {}) {
  const budget = { ...BACKGROUND_BUDGET, ...options };
  for (const [key, value] of Object.entries(budget)) {
    if (!Object.hasOwn(BACKGROUND_BUDGET, key) || !Number.isSafeInteger(value)
      || value < 1 || value > BACKGROUND_BUDGET[key]) throw new RangeError(`invalid background budget: ${key}`);
  }
  let { world } = readBackground(journal, budget);
  const commit = candidate => {
    // Validate complete candidate and UTF-8 bytes before replacing the world.
    const text = encodeJournal(candidate, budget);
    readBackground(text, budget);
    world = candidate;
  };
  return Object.freeze({
    journal: () => encodeJournal(world, budget),
    ingest(feed, { receivedAt } = {}) {
      if (!Number.isSafeInteger(receivedAt)) throw new TypeError('receipt time must be an integer timestamp');
      if (world.entries().at(-1)?.recordedAt > receivedAt) throw new RangeError('receipt time precedes the world journal');
      const { quakes } = readBackground(encodeJournal(world, budget), budget);
      const next = ingestUSGS(quakes, feed, { receivedAt, ...budget });
      const candidate = decodeJournal(encodeJournal(world, budget), budget);
      for (const fact of next.ledger.entries().slice(quakes.size)) candidate.add(fact);
      commit(candidate);
      return { ...next.summary, records: world.size };
    },
    // Host-supplied observation: source, both clocks and optional predecessor
    // are mandatory parts of the ordinary fact contract. No state is inferred.
    signal(fact) {
      signal(fact);
      const candidate = decodeJournal(encodeJournal(world, budget), budget);
      const added = candidate.add(fact);
      commit(candidate);
      return added;
    },
  });
}
