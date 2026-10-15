import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeJournal, decodeJournal } from '../src/journal.js';
import { crossingDemo } from '../src/crossing-demo.js';

test('a restored crossing continues both script and user lineage without reusing IDs', () => {
  const original = crossingDemo(); original.receive(); original.observe(false); original.receive();
  const saved = encodeJournal(original.ledger);
  const restored = crossingDemo({ records: decodeJournal(saved).entries() });
  assert.equal(restored.latest, original.latest);
  assert.equal(restored.remaining, original.remaining);
  assert.deepEqual(restored.receive(), original.receive());
  assert.deepEqual(restored.observe(true), original.observe(true));
  assert.equal(encodeJournal(restored.ledger), encodeJournal(original.ledger));
});

test('unsupported, damaged and over-budget snapshots never become an empty successful restore', () => {
  const demo = crossingDemo(); demo.receive(); demo.receive();
  const text = encodeJournal(demo.ledger);
  for (const invalid of ['{', 'null', text.replace('"version":1', '"version":2'), text.replace('"a1"', '"missing"')])
    assert.throws(() => crossingDemo({ records: decodeJournal(invalid).entries() }));
  assert.throws(() => decodeJournal(text, { capacity: 1 }), /record budget/);
  assert.throws(() => decodeJournal(text, { maxBytes: 10 }), /byte budget/);
  assert.throws(() => encodeJournal(demo.ledger, { maxBytes: 10 }), /byte budget/);
  const rows = JSON.parse(text).records; rows[0].value = false;
  assert.throws(() => crossingDemo({ records: rows }), /does not match/);
  assert.equal(demo.ledger.size, 2);
});
