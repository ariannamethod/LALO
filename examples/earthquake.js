import { FactLedger } from '../src/ledger.js';

// Synthetic observations: demonstrates a source correcting an earlier value.
const ledger = new FactLedger();
const occurred = Date.parse('2026-10-15T10:00:00Z');
const firstReceipt = occurred + 60_000;
const correctionReceipt = occurred + 180_000;
const observation = {
  id: 'quake-1/magnitude/1', subject: 'quake-1', predicate: 'magnitude',
  value: 2.9, source: 'fixture:seismometer',
  validFrom: occurred, validTo: occurred + 1, recordedAt: firstReceipt,
};
ledger.add(observation);
ledger.add({
  ...observation, id: 'quake-1/magnitude/2', value: 3.4,
  recordedAt: correctionReceipt, supersedes: observation.id,
});

for (const knownAt of [firstReceipt, correctionReceipt]) {
  const [fact] = ledger.asOf({ validAt: occurred, knownAt });
  console.log(`${new Date(knownAt).toISOString()} — magnitude ${fact.value} (${fact.id})`);
}
console.log('Lineage:', ledger.lineage('quake-1/magnitude/2').map(f => f.id).join(' → '));
