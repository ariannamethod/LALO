import test from 'node:test';
import assert from 'node:assert/strict';
import { FactLedger } from '../src/ledger.js';
import { encodeJournal, decodeJournal } from '../src/journal.js';
import { createToolHost } from '../src/tools.js';
import { appendLocation, locationSamples } from '../src/sources/geolocation.js';
import { requestLocation } from '../web/location-request.js';

// Deliberately synthetic position, not a device observation.
const fix = (timestamp = 1000) => ({ timestamp, coords: { latitude: 12.5, longitude: -34.25, accuracy: 7 } });
const add = (ledger, id = 'fixture1', receivedAt = 2000, position = fix(), budget = {}) =>
  appendLocation(ledger, position, { id, receivedAt, ...budget });

test('location retains both clocks and accuracy through journal and real tool boundary', () => {
  const original = new FactLedger(), next = add(original);
  assert.equal(original.size, 0);
  const restored = decodeJournal(encodeJournal(next));
  assert.deepEqual(locationSamples(restored), locationSamples(next));
  const host = createToolHost(restored);
  assert.equal(host.call('lalo_facts', { validAt: 1000, knownAt: 1999 }).data.total, 0);
  const facts = host.call('lalo_facts', { validAt: 1000, knownAt: 2000 }).data.items;
  assert.deepEqual(facts.map(f => f.value), [12.5, -34.25, 7]);
  assert.ok(facts.every(f => f.source === 'browser:geolocation' && f.recordedAt === 2000));
  assert.equal(host.call('lalo_facts', { validAt: 1001, knownAt: 2000 }).data.total, 0);
});

test('late and repeated fixes append without replacing earlier movement or receipt times', () => {
  let ledger = add(new FactLedger());
  ledger = add(ledger, 'late', 3000, fix(500));
  ledger = add(ledger, 'same-fix', 4000, fix(500));
  assert.deepEqual(locationSamples(ledger).map(s => [s.observedAt, s.receivedAt]), [[1000, 2000], [500, 3000], [500, 4000]]);
  assert.ok(ledger.entries().every(f => f.supersedes === null));
  assert.equal(ledger.asOf({ validAt: 500, knownAt: 3000 }).length, 3);
});

test('bad measurements, IDs, receipt clocks and exhausted budgets leave the source intact', () => {
  const ledger = add(new FactLedger()), before = encodeJournal(ledger);
  for (const [key, value] of [['latitude', 91], ['longitude', -181], ['accuracy', -1], ['latitude', NaN], ['accuracy', null]]) {
    const p = fix(); p.coords[key] = value;
    assert.throws(() => add(ledger, 'invalid', 3000, p));
  }
  for (const timestamp of [1.5, NaN, -1, Number.MAX_SAFE_INTEGER]) assert.throws(() => add(ledger, 'invalid', 3000, fix(timestamp)));
  assert.throws(() => add(ledger, 'fixture1', 3000), /duplicate/);
  assert.throws(() => add(ledger, 'bad:id', 3000), /id/);
  assert.throws(() => add(ledger, 'backdated', 1999), /journal order/);
  assert.throws(() => add(ledger, 'overflow', 3000, fix(), { capacity: 5 }), /capacity/);
  assert.throws(() => add(ledger, 'overflow', 3000, fix(), { maxBytes: new TextEncoder().encode(before).length }), /byte budget/);
  assert.equal(encodeJournal(ledger), before);
});

test('saved location validation rejects partial or inconsistent groups', () => {
  const all = add(new FactLedger()).entries();
  for (const records of [all.slice(0, 2), all.map((f, i) => i === 1 ? { ...f, source: 'other' } : f)]) {
    const ledger = new FactLedger(); for (const fact of records) ledger.add(fact);
    assert.throws(() => locationSamples(ledger));
  }
});

test('request is one-shot with explicit options and separate receipt clock', async () => {
  let calls = 0;
  const result = await requestLocation({ getCurrentPosition(success, failure, options) {
    calls++; assert.deepEqual(options, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }); success(fix());
  } }, { clock: () => 3000 });
  assert.equal(calls, 1); assert.deepEqual(result, { position: fix(), receivedAt: 3000 });
  for (const code of [1, 2, 3]) await assert.rejects(requestLocation({ getCurrentPosition(ok, fail) { fail({ code }); } }));
  await assert.rejects(requestLocation(undefined), /unavailable/);
});

test('unanswered permission request times out; late callback does not become a receipt', async () => {
  let late, reads = 0;
  const pending = requestLocation({ getCurrentPosition(ok) { late = ok; } }, { timeout: 5, clock: () => { reads++; return 3000; } });
  await assert.rejects(pending, /timed out/);
  late(fix());
  await assert.rejects(pending, /timed out/);
  assert.equal(reads, 0);
});
