import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackground } from '../src/background.js';
import { selectBackground, replayBackground } from '../src/background-context.js';
import { decodeJournal } from '../src/journal.js';
import { collection, quake, QUAKETIME as t } from './fixtures/usgs.js';

const request = (extra = {}) => ({ agent: 'agent:don-eduardo', knownAt: t + 6000, stateAt: t + 6000,
  worldFrom: t, worldTo: t + 100, ...extra });
const signal = (extra = {}) => ({ id: 'don:attention:1', subject: 'agent:don-eduardo',
  predicate: 'attention_subject', value: 'usgs:synthetic1', source: 'fixture:agent-action',
  validFrom: t + 2000, validTo: null, recordedAt: t + 3000, ...extra });
const first = () => {
  const world = createBackground();
  world.ingest(collection(quake()), { receivedAt: t + 2000 });
  return world;
};

test('arrivals survive restart independently of selections; revisions retain both clocks and lineage', () => {
  const world = first();
  world.signal(signal());
  const originalWorld = world.journal(), before = selectBackground(originalWorld, request({ knownAt: t + 3000 }));
  const restarted = createBackground(originalWorld);
  restarted.ingest(collection(quake({ updated: t + 4000, mag: 3.4, time: t + 1 })), { receivedAt: t + 5000 });
  const after = selectBackground(restarted.journal(), request());
  assert.equal(before.items[0].facts[0].value, 2.9);
  assert.equal(after.items[0].facts[0].value, 3.4);
  assert.equal(after.items[0].facts[0].validFrom, t + 1);
  assert.equal(after.items[0].facts[0].recordedAt, t + 5000);
  assert.equal(after.items[0].facts[0].supersedes, before.items[0].facts[0].id);
  assert.equal(decodeJournal(restarted.journal()).lineage(after.items[0].facts[0].id).length, 2);
  assert.deepEqual(selectBackground(restarted.journal(), before.request), before);
  assert.equal(replayBackground(originalWorld, before).comparison, 'match');
  const changed = structuredClone(before); changed.items[0].facts[0].value = 99;
  assert.equal(replayBackground(originalWorld, changed).comparison, 'changed');
  assert.throws(() => replayBackground(originalWorld, { ...before, policy: 'future/v2' }), /policy/);
  assert.equal(world.journal(), originalWorld);
  assert.equal(selectBackground(restarted.journal(), request({ worldTo: t + 1 })).items.length, 0);
});

test('agent is a journal subject; explicit state affects ranking at both clocks without inferred state', () => {
  const world = first();
  world.ingest(collection(quake({ id: 'synthetic2', mag: null })), { receivedAt: t + 2500 });
  const noState = selectBackground(world.journal(), request({ maxEvents: 1 }));
  assert.equal(noState.items[0].subject, 'usgs:synthetic2');
  assert.deepEqual(noState.state, []);
  world.signal(signal({ validFrom: t + 4000 }));
  assert.equal(selectBackground(world.journal(), request({ maxEvents: 1 })).items[0].subject, 'usgs:synthetic1');
  assert.equal(selectBackground(world.journal(), request({ maxEvents: 1, knownAt: t + 2800 })).items[0].subject, 'usgs:synthetic2');
  assert.equal(selectBackground(world.journal(), request({ maxEvents: 1, stateAt: t + 3500 })).items[0].subject, 'usgs:synthetic2');
  assert.equal(selectBackground(world.journal(), request({ agent: 'agent:other', maxEvents: 1 })).items[0].subject, 'usgs:synthetic2');
  world.signal(signal({ id: 'don:attention:2', value: null, recordedAt: t + 5000, supersedes: 'don:attention:1' }));
  const cleared = selectBackground(world.journal(), request({ maxEvents: 1 }));
  assert.equal(cleared.items[0].subject, 'usgs:synthetic2');
  assert.equal(cleared.items[0].facts[0].value, null);
  assert.equal(cleared.state[0].value, null);
  assert.equal(cleared.state[0].supersedes, 'don:attention:1');
  // Unknown future signal kinds are explicit sourced observations, preserved as evidence.
  world.signal(signal({ id: 'don:mode:1', predicate: 'task_mode', value: 'observe', recordedAt: t + 5500 }));
  const saved = world.journal();
  assert.equal(selectBackground(saved, request()).state.length, 2);
  assert.equal(world.journal(), saved);
});

test('strict source provenance and complete versions are checked on restart and selection', () => {
  const text = first().journal();
  for (const damage of [
    data => { data.records[0].source = 'fixture:forged'; },
    data => { data.records.pop(); },
    data => { data.records[0].subject = 'other:synthetic1'; },
  ]) {
    const data = JSON.parse(text); damage(data);
    assert.throws(() => createBackground(JSON.stringify(data)));
    assert.throws(() => selectBackground(JSON.stringify(data), request()));
  }
});

test('failed batches and signals leave the whole world unchanged; duplicates and stale polls are explicit', () => {
  const world = first(), before = world.journal();
  assert.equal(world.ingest(collection(quake()), { receivedAt: t + 3000 }).unchanged, 1);
  assert.equal(world.ingest(collection(quake({ updated: t })), { receivedAt: t + 3000 }).stale, 1);
  for (const feed of [collection(quake(), quake()), collection(quake({ id: 'synthetic2' }), quake({ mag: NaN })),
    collection(quake({ mag: 9 }))]) assert.throws(() => world.ingest(feed, { receivedAt: t + 3000 }));
  assert.throws(() => world.ingest(collection(quake()), { receivedAt: t + 1000 }), /precedes/);
  assert.throws(() => world.signal(signal({ source: undefined })), /source/);
  assert.throws(() => world.signal(signal({ value: 'invented' })), /attention_subject/);
  assert.equal(world.journal(), before);
  const small = createBackground(before, { capacity: 15 });
  assert.throws(() => small.ingest(collection(quake({ updated: t + 4000 })), { receivedAt: t + 5000 }), /capacity/);
  assert.equal(small.journal(), before);
  const byteLimited = createBackground(before, { maxBytes: new TextEncoder().encode(before).length });
  assert.throws(() => byteLimited.signal(signal()), /byte budget/);
  assert.equal(byteLimited.journal(), before);
  const countLimited = createBackground(before, { maxEvents: 1 });
  assert.throws(() => countLimited.ingest(collection(quake(), quake({ id: 'synthetic2' })), { receivedAt: t + 3000 }), /event budget/);
});

test('selection is deterministic, bounded in complete UTF-8 bytes, and visibly reports omitted events', () => {
  const world = createBackground();
  world.ingest(collection(quake({ id: 'z', place: 'Синтетика 🌳' }), quake({ id: 'a' })), { receivedAt: t + 2000 });
  const one = selectBackground(world.journal(), request({ maxEvents: 1 }));
  assert.equal(one.items[0].subject, 'usgs:a');
  assert.equal(one.eligible, 2); assert.equal(one.omitted, 1);
  assert.equal(one.complete, false); assert.equal(one.limitedBy, 'maxEvents');
  const tiny = selectBackground(world.journal(), request({ maxBytes: 1024 }));
  assert.equal(tiny.items.length, 0); assert.equal(tiny.omitted, 2); assert.equal(tiny.limitedBy, 'maxBytes');
  for (const maxBytes of [1024, 3000, 5000, 8000]) {
    const result = selectBackground(world.journal(), request({ maxBytes }));
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= maxBytes);
    assert.ok(result.items.every(item => item.facts.length === 8));
  }
  const only = selectBackground(world.journal(), request({ subject: 'usgs:z' }));
  assert.equal(only.items.length, 1); assert.equal(only.complete, true);
  assert.deepEqual(selectBackground(world.journal(), request()), selectBackground(world.journal(), request()));
  const empty = selectBackground(world.journal(), request({ knownAt: t }));
  assert.deepEqual(empty.items, []); assert.equal(empty.complete, true);
  world.signal(signal({ predicate: 'external_note', value: 'я'.repeat(2000) }));
  assert.throws(() => selectBackground(world.journal(), request({ maxBytes: 1024 })), /state.*budget/);
  for (const extra of [{ knownAt: undefined }, { stateAt: 0.5 }, { maxEvents: 0 }, { maxBytes: 999 },
    { worldTo: t }, { agent: 'usgs:a' }, { hiddenState: true }])
    assert.throws(() => selectBackground(world.journal(), request(extra)));
});
