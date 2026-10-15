import test from 'node:test';
import assert from 'node:assert/strict';
import { FactLedger } from '../src/ledger.js';
import { encodeJournal, decodeJournal } from '../src/journal.js';
import { ingestUSGS, validateUSGSJournal } from '../src/sources/usgs.js';
import { quakeView, quakeCatalog, quakeVersions, extendQuakeJournal, QUAKE_RULE } from '../src/quake-view.js';
import { quake, collection, QUAKETIME as T } from './fixtures/usgs.js';

function history() {
  const first = ingestUSGS(new FactLedger(), collection(quake()), { receivedAt: T + 2000 }).ledger;
  const next = ingestUSGS(first, collection(
    quake({ mag: 3.4, time: T + 100, updated: T + 3000, coordinates: [31, 41, 9], place: 'Revised synthetic place' }),
    quake({ id: 'synthetic2', mag: null, updated: T + 3000, place: 'A later event' }),
  ), { receivedAt: T + 4000 }).ledger;
  return { first, next };
}

test('magnitude projection keeps both clocks, named premises, nulls and old metadata', () => {
  const { next } = history(), subject = 'usgs:synthetic1';
  const query = { subject, validAt: T, knownAt: T + 2000 };
  const early = quakeView(next, query);
  assert.equal(early.current.rule, QUAKE_RULE);
  assert.equal(early.current.state, 'contradicted');
  assert.deepEqual(early.current.premises, [`${subject}:${T + 1000}:magnitude`]);
  assert.equal(early.current.validFrom, T); assert.equal(early.current.validTo, T + 1);
  assert.equal(early.records.length, 1); assert.equal(early.layers.length, 1); assert.deepEqual(early.corrections, []);
  const catalog = quakeCatalog(next, { knownAt: T + 2000 });
  assert.equal(catalog.length, 1); assert.equal(catalog[0].place, 'Synthetic crossing');
  assert.equal(catalog[0].latitude, 40); assert.equal(catalog[0].time, T);
  assert.deepEqual(quakeCatalog(next, { knownAt: T + 1999 }), []);
  const current = quakeView(next, { ...query, validAt: T + 100, knownAt: T + 4000 });
  assert.equal(current.current.state, 'supported'); assert.equal(current.corrections.length, 1);
  assert.deepEqual(current.records.map(r => r.state), ['superseded', 'supporting']);
  assert.equal(quakeView(next, { ...query, knownAt: T + 4000 }).current.state, 'unsettled');
  assert.equal(quakeView(next, { ...query, validAt: T + 101, knownAt: T + 4000 }).current.state, 'unsettled');
  const unknown = quakeView(next, { ...query, subject: 'usgs:synthetic2', knownAt: T + 4000 });
  assert.equal(unknown.current.state, 'unsettled'); assert.equal(unknown.current.opposing.length, 0);
  assert.equal(unknown.current.unknown.length, 1); assert.equal(unknown.records[0].state, 'unknown');
  assert.deepEqual(quakeVersions(next, { subject, knownAt: T + 4000 }).map(v => v.latitude), [40, 41]);
  assert.throws(() => quakeView(next, { ...query, threshold: NaN }), /finite/);
});

test('imports allow a complete canonical extension, never a rewritten or partial history', () => {
  const { first, next } = history(), original = encodeJournal(first);
  assert.deepEqual(extendQuakeJournal(first, encodeJournal(next)).entries(), next.entries());
  assert.deepEqual(extendQuakeJournal(first, original).entries(), first.entries());
  assert.throws(() => extendQuakeJournal(next, original), /extend this journal/);
  const changed = JSON.parse(encodeJournal(next)); changed.records[0].value = 2.8;
  assert.throws(() => extendQuakeJournal(first, JSON.stringify(changed)), /extend this journal/);
  const missing = JSON.parse(encodeJournal(next)); missing.records.pop();
  assert.throws(() => extendQuakeJournal(first, JSON.stringify(missing)), /incomplete/);
  assert.equal(encodeJournal(first), original);
});

test('USGS validation checks every companion fact, source identity and revision interval', () => {
  const { next } = history();
  for (const mutate of [
    rows => { rows[1].source = 'https://example.invalid/forged'; },
    rows => { rows[2].validFrom -= 10; },
    rows => { rows[2].value = 181; },
    rows => { rows[6].predicate = 'something_else'; },
    rows => { rows[8].supersedes = null; },
    rows => { rows[10].recordedAt += 1; },
  ]) {
    const data = JSON.parse(encodeJournal(next)); mutate(data.records);
    assert.throws(() => validateUSGSJournal(decodeJournal(JSON.stringify(data))));
  }
  assert.equal(validateUSGSJournal(next), next);
});
