import { FactLedger } from './ledger.js';

export const START = Date.UTC(2026, 9, 15, 10);
export const END = START + 20 * 60_000;
export const SUBJECT = 'crossing:north';
export const PREDICATE = 'open';
const script = [
  { id: 'a1', source: 'fixture:station-a', value: true },
  { id: 'b1', source: 'fixture:walker-b', value: true },
  { id: 'c1', source: 'fixture:station-c', value: false },
  { id: 'a2', source: 'fixture:station-a', value: false, supersedes: 'a1' },
  { id: 'b2', source: 'fixture:walker-b', value: false, supersedes: 'b1' },
];

export function crossingDemo({ capacity = 64 } = {}) {
  const ledger = new FactLedger({ capacity });
  let next = 0, user = 0, latest = START;
  function append(record) {
    const fact = ledger.add({ ...record, subject: SUBJECT, predicate: PREDICATE,
      validFrom: START, validTo: END, recordedAt: latest + 60_000 });
    latest = fact.recordedAt;
    return fact;
  }
  return {
    ledger,
    get latest() { return latest; },
    get remaining() { return script.length - next; },
    receive() {
      if (next === script.length) return null;
      const fact = append(script[next]);
      next++;
      return fact;
    },
    observe(value) {
      if (typeof value !== 'boolean') throw new TypeError('observation must be boolean');
      const previous = user ? `you${user}` : null;
      const fact = append({ id: `you${user + 1}`, source: 'fixture:you', value, supersedes: previous });
      user++;
      return fact;
    },
  };
}
