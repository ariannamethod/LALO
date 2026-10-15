import test from 'node:test';
import assert from 'node:assert/strict';
import { FactLedger } from '../src/ledger.js';
import { hypothesis, worldView, RULE } from '../src/hypothesis.js';
import { crossingDemo, START, END, SUBJECT, PREDICATE } from '../src/crossing-demo.js';
const query = knownAt => ({ subject: SUBJECT, predicate: PREDICATE, validAt: START + 300_000, knownAt });

test('independent disagreement changes the hypothesis without erasing either source', () => {
  const demo = crossingDemo();
  const states = ['supported', 'supported', 'contested', 'contested', 'contradicted'];
  for (const expected of states) {
    demo.receive();
    assert.equal(hypothesis(demo.ledger, query(demo.latest)).state, expected);
  }
  const result = hypothesis(demo.ledger, query(demo.latest));
  assert.equal(result.rule, RULE);
  assert.deepEqual(result.premises, ['c1', 'a2', 'b2']);
  assert.equal(demo.ledger.size, 5);
  assert.deepEqual(demo.ledger.lineage('a2').map(f => f.id), ['a1', 'a2']);
});

test('rewinding removes future facts, links and contours as well as future conclusions', () => {
  const demo = crossingDemo();
  demo.receive(); demo.receive();
  const earlier = query(demo.latest);
  const before = worldView(demo.ledger, earlier);
  while (demo.remaining) demo.receive();
  assert.deepEqual(worldView(demo.ledger, earlier), before);
  assert.deepEqual(before.records.map(r => r.fact.id), ['a1', 'b1']);
  assert.equal(before.corrections.length, 0);
  const after = worldView(demo.ledger, query(demo.latest));
  assert.deepEqual(after.corrections, [{ from: 'a1', to: 'a2' }, { from: 'b1', to: 'b2' }]);
  assert.equal(after.records[0].state, 'superseded');
  assert.deepEqual(after.layers.map(l => l.state), ['supported', 'supported', 'contested', 'contested', 'contradicted']);
});

test('world time remains independent of receipt time, including the open interval boundary', () => {
  const demo = crossingDemo();
  while (demo.remaining) demo.receive();
  for (const validAt of [START - 1, END]) {
    const view = worldView(demo.ledger, { ...query(demo.latest), validAt });
    assert.equal(view.current.state, 'unsettled');
    assert.deepEqual(view.current.premises, []);
    assert.ok(view.layers.every(l => l.state === 'unsettled'));
  }
  assert.equal(hypothesis(demo.ledger, { ...query(demo.latest), validAt: END - 1 }).state, 'contradicted');
});

test('derived interval is the intersection of premises, with explicit unbounded ends', () => {
  const ledger = new FactLedger();
  const base = { subject: SUBJECT, predicate: PREDICATE, value: true, source: 'fixture:test', recordedAt: START };
  ledger.add({ ...base, id: 'x', validFrom: START, validTo: null });
  ledger.add({ ...base, id: 'y', validFrom: START + 100, validTo: END });
  const result = hypothesis(ledger, query(START));
  assert.equal(result.validFrom, START + 100);
  assert.equal(result.validTo, END);
  assert.throws(() => hypothesis(ledger, { ...query(START), expected: 'true' }), /boolean/);
  ledger.add({ ...base, id: 'z', value: 1, validFrom: START, validTo: END });
  assert.throws(() => hypothesis(ledger, query(START)), /boolean premises/);
});

test('interface observations enter the journal and revise their own lineage', () => {
  const demo = crossingDemo();
  demo.receive();
  const first = demo.observe(false);
  demo.receive();
  const second = demo.observe(true);
  assert.equal(first.source, 'fixture:you');
  assert.equal(second.supersedes, first.id);
  assert.ok(second.recordedAt > first.recordedAt);
  assert.deepEqual(hypothesis(demo.ledger, query(second.recordedAt)).premises, ['a1', 'b1', 'you2']);
  assert.equal(hypothesis(demo.ledger, query(first.recordedAt)).state, 'contested');
});

test('a full visual journal rejects actions without advancing the scenario or receipt clock', () => {
  const demo = crossingDemo({ capacity: 1 });
  demo.receive();
  const time = demo.latest, remaining = demo.remaining;
  assert.throws(() => demo.receive(), /capacity/);
  assert.throws(() => demo.observe(false), /capacity/);
  assert.equal(demo.latest, time);
  assert.equal(demo.remaining, remaining);
  assert.equal(demo.ledger.size, 1);
});
