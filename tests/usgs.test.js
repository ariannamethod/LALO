import test from 'node:test';
import assert from 'node:assert/strict';
import { FactLedger } from '../src/ledger.js';
import { ingestUSGS } from '../src/sources/usgs.js';
import { encodeJournal, decodeJournal } from '../src/journal.js';
// Synthetic fixtures; no live HTTP in the gate.
const feature = (overrides = {}) => ({ type: 'Feature', id: 'synthetic1',
  properties: { mag: 2.9, magType: 'ml', time: 1000, updated: 2000, place: 'Synthetic crossing', type: 'earthquake', ...overrides },
  geometry: { type: 'Point', coordinates: [30, 40, 8] } });
const feed = (...features) => ({ type: 'FeatureCollection', features });
const poll = (ledger, features, receivedAt = 3000, options = {}) => ingestUSGS(ledger, feed(...features), { receivedAt, ...options });

test('USGS keeps source version, event instant and receipt time separate across replay', () => {
  const initial = new FactLedger();
  const first = poll(initial, [feature()]);
  assert.equal(initial.size, 0); assert.equal(first.ledger.size, 8);
  const repeated = poll(decodeJournal(encodeJournal(first.ledger)), [feature()], 4000);
  assert.equal(repeated.ledger.size, 8); assert.equal(repeated.summary.unchanged, 1);
  const revised = poll(repeated.ledger, [feature({ mag: 3.4, updated: 5000, time: 1100 })], 6000);
  assert.equal(revised.ledger.size, 16); assert.equal(revised.summary.revised, 1);
  const q = { subject: 'usgs:synthetic1', predicate: 'magnitude' };
  assert.equal(revised.ledger.asOf({ ...q, validAt: 1000, knownAt: 4000 })[0].value, 2.9);
  assert.equal(revised.ledger.asOf({ ...q, validAt: 1100, knownAt: 6000 })[0].value, 3.4);
  assert.equal(revised.ledger.asOf({ ...q, validAt: 1000, knownAt: 6000 }).length, 0);
  assert.equal(revised.ledger.asOf({ ...q, validAt: 1101, knownAt: 6000 }).length, 0);
  assert.equal(revised.ledger.lineage('usgs:synthetic1:5000:magnitude').length, 2);
  const stale = poll(revised.ledger, [feature()], 7000);
  assert.equal(stale.summary.stale, 1); assert.equal(stale.ledger.size, 16);
});

test('one malformed or over-budget event rejects the complete poll without partial append', () => {
  const ledger = new FactLedger();
  const second = feature(); second.id = 'synthetic2';
  for (const features of [[feature(), feature()], [feature(), { ...second, geometry: null }], [feature({ mag: NaN })]]) {
    assert.throws(() => poll(ledger, features)); assert.equal(ledger.size, 0);
  }
  assert.throws(() => poll(ledger, [feature(), second], 3000, { capacity: 15 }), /capacity/);
  assert.equal(ledger.size, 0);
  assert.throws(() => poll(ledger, [feature(), second], 3000, { maxEvents: 1 }), /event budget/);
});

test('same-version content changes and backdated corrections fail explicitly', () => {
  const { ledger } = poll(new FactLedger(), [feature()]);
  assert.throws(() => poll(ledger, [feature({ mag: 4 })], 4000), /without changing/);
  assert.throws(() => poll(ledger, [feature({ updated: 5000 })], 3000), /after its predecessor/);
  assert.throws(() => poll(ledger, [feature()], NaN), /receipt time/);
  assert.equal(ledger.size, 8);
});

test('an unknown magnitude stays explicit null and absent fields fail validation', () => {
  const { ledger } = poll(new FactLedger(), [feature({ mag: null, magType: null, place: null })]);
  assert.equal(ledger.entries()[0].value, null);
  assert.throws(() => poll(new FactLedger(), [feature({ mag: undefined })]), /magnitude/);
});
