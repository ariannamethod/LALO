import test from 'node:test';
import assert from 'node:assert/strict';
import { FactLedger } from '../src/ledger.js';

const fact = (overrides = {}) => ({
  id: 'a', subject: 'quake-1', predicate: 'magnitude', value: 2.9,
  source: 'fixture:sensor-a', validFrom: 100, validTo: 200, recordedAt: 120,
  ...overrides,
});
const values = rows => rows.map(row => row.value);

test('late corrections change current knowledge without rewriting the earlier view', () => {
  const ledger = new FactLedger();
  ledger.add(fact());
  ledger.add(fact({ id: 'b', value: 3.4, recordedAt: 300, supersedes: 'a' }));
  assert.deepEqual(ledger.asOf({ validAt: 150, knownAt: 119 }), []);
  assert.deepEqual(values(ledger.asOf({ validAt: 150, knownAt: 120 })), [2.9]);
  assert.deepEqual(values(ledger.asOf({ validAt: 150, knownAt: 299 })), [2.9]);
  assert.deepEqual(values(ledger.asOf({ validAt: 150, knownAt: 300 })), [3.4]);
  assert.deepEqual(ledger.lineage('b').map(f => f.id), ['a', 'b']);
  assert.equal(ledger.entries()[0].value, 2.9);
});

test('a third revision preserves every historical knowledge boundary', () => {
  const ledger = new FactLedger();
  ledger.add(fact());
  ledger.add(fact({ id: 'b', value: 3.4, recordedAt: 300, supersedes: 'a' }));
  ledger.add(fact({ id: 'c', value: 3.2, recordedAt: 400, supersedes: 'b' }));
  for (const [knownAt, expected] of [[200, 2.9], [350, 3.4], [400, 3.2]])
    assert.deepEqual(values(ledger.asOf({ validAt: 150, knownAt })), [expected]);
  assert.deepEqual(ledger.lineage('c').map(f => f.id), ['a', 'b', 'c']);
});

test('world intervals are half open and corrected intervals do not resurrect old claims', () => {
  const ledger = new FactLedger();
  ledger.add(fact());
  assert.equal(ledger.asOf({ validAt: 100, knownAt: 120 }).length, 1);
  assert.equal(ledger.asOf({ validAt: 200, knownAt: 120 }).length, 0);
  ledger.add(fact({ id: 'b', validFrom: 140, validTo: 160, recordedAt: 300, supersedes: 'a' }));
  assert.equal(ledger.asOf({ validAt: 110, knownAt: 300 }).length, 0);
  assert.equal(ledger.asOf({ validAt: 150, knownAt: 300 }).length, 1);
});

test('independent disagreeing sources remain visible and can be filtered', () => {
  const ledger = new FactLedger();
  ledger.add(fact());
  ledger.add(fact({ id: 'b', value: 4.1, source: 'fixture:sensor-b' }));
  ledger.add(fact({ id: 'c', subject: 'quake-2' }));
  ledger.add(fact({ id: 'd', predicate: 'depth_km', value: 8 }));
  assert.deepEqual(values(ledger.asOf({ validAt: 150, knownAt: 120,
    subject: 'quake-1', predicate: 'magnitude' })), [2.9, 4.1]);
});

test('input, output and export ownership cannot mutate history', () => {
  const ledger = new FactLedger();
  const input = fact();
  const stored = ledger.add(input);
  input.value = 9;
  assert.throws(() => { stored.value = 9; }, TypeError);
  const exported = ledger.entries();
  exported.length = 0;
  assert.equal(ledger.size, 1);
  assert.equal(ledger.entries()[0].value, 2.9);
});

test('capacity never silently evicts evidence or partly appends a correction', () => {
  const ledger = new FactLedger({ capacity: 1 });
  ledger.add(fact());
  assert.throws(() => ledger.add(fact({ id: 'b', recordedAt: 300, supersedes: 'a' })), /capacity/);
  assert.deepEqual(values(ledger.asOf({ validAt: 150, knownAt: 400 })), [2.9]);
});

test('invalid records leave the journal and its clock untouched', () => {
  const ledger = new FactLedger();
  ledger.add(fact());
  for (const bad of [
    null, fact(), fact({ id: 'b', value: NaN }), fact({ id: 'b', value: {} }),
    fact({ id: 'b', validTo: 100 }), fact({ id: 'b', recordedAt: 119 }),
    fact({ id: 'b', recordedAt: 300, supersedes: 'missing' }),
    fact({ id: 'b', recordedAt: 300, subject: 'other', supersedes: 'a' }),
    fact({ id: 'b', recordedAt: 120, supersedes: 'a' }),
    fact({ id: 'b', validFrom: Number.MAX_SAFE_INTEGER + 1 }),
    fact({ id: 'b', source: ' ' }), fact({ id: 'b', value: 'x'.repeat(4097) }),
  ]) {
    assert.throws(() => ledger.add(bad));
    assert.equal(ledger.size, 1);
  }
  ledger.add(fact({ id: 'b', recordedAt: 121 }));
  assert.equal(ledger.size, 2);
});

test('revision forks are explicit independent claims, never accidental replacement', () => {
  const ledger = new FactLedger();
  ledger.add(fact());
  ledger.add(fact({ id: 'b', recordedAt: 300, supersedes: 'a' }));
  assert.throws(() => ledger.add(fact({ id: 'c', recordedAt: 400, supersedes: 'a' })), /latest revision/);
  assert.throws(() => ledger.lineage('missing'), /unknown fact/);
});

test('export can replay the complete journal with the same two-clock answers', () => {
  const ledger = new FactLedger();
  ledger.add(fact({ validTo: null }));
  ledger.add(fact({ id: 'b', validTo: null, value: 3.4, recordedAt: 300, supersedes: 'a' }));
  const restored = new FactLedger();
  for (const row of JSON.parse(JSON.stringify(ledger.entries()))) restored.add(row);
  for (const knownAt of [119, 120, 299, 300, 1000])
    assert.deepEqual(restored.asOf({ validAt: 500, knownAt }), ledger.asOf({ validAt: 500, knownAt }));
});

test('query clocks and storage budgets are explicit', () => {
  for (const capacity of [0, -1, 1.5, Infinity])
    assert.throws(() => new FactLedger({ capacity }), RangeError);
  const ledger = new FactLedger();
  assert.throws(() => ledger.asOf({ validAt: 100 }), TypeError);
  assert.throws(() => ledger.asOf({ validAt: NaN, knownAt: 120 }), TypeError);
});
