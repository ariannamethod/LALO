import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackground } from '../src/background.js';
import { selectBackground, replayBackground } from '../src/background-context.js';
import { decodeJournal } from '../src/journal.js';
import { createToolHost } from '../src/tools.js';
import { createRouteSession } from '../src/route.js';
import { collection, quake, QUAKETIME as t } from './fixtures/usgs.js';

const request = (extra = {}) => ({ agent: 'agent:don-eduardo', knownAt: t + 6000, stateAt: t + 6000,
  worldFrom: t, worldTo: t + 100, ...extra });
const signal = (extra = {}) => ({ id: 'don:attention:1', subject: 'agent:don-eduardo',
  predicate: 'attention_subject', value: 'usgs:synthetic1', source: 'fixture:agent-action',
  validFrom: t + 2000, validTo: null, recordedAt: t + 3000, ...extra });
const usgs = (feed, receivedAt) => ({ kind: 'usgs', feed, receivedAt });
const signalFrame = extra => ({ kind: 'signal', fact: signal(extra) });
// Deliberately synthetic position and JPEG-framed bytes, not device observations.
const location = (id, receivedAt, timestamp = t + 50) => ({ kind: 'location', id, receivedAt,
  position: { timestamp, coords: { latitude: 12.5, longitude: -34.25, accuracy: 7 } } });
const jpeg = (size = 9000) => Buffer.concat([Buffer.from([255, 216]), Buffer.alloc(size - 4, 42), Buffer.from([255, 217])]).toString('base64');
const camera = (id, receivedAt, capturedAt = t + 60) => ({ kind: 'camera', id, receivedAt,
  image: { jpeg: jpeg(), width: 640, height: 480, capturedAt } });
const first = async () => {
  const world = await createBackground();
  await world.receive(usgs(collection(quake()), t + 2000));
  return world;
};

test('arrivals survive restart independently of selections; revisions retain both clocks and lineage', async () => {
  const world = await first();
  await world.receive(signalFrame());
  const originalWorld = world.journal(), before = await selectBackground(originalWorld, request({ knownAt: t + 3000 }));
  const restarted = await createBackground(originalWorld);
  await restarted.receive(usgs(collection(quake({ updated: t + 4000, mag: 3.4, time: t + 1 })), t + 5000));
  const after = await selectBackground(restarted.journal(), request());
  assert.equal(before.items[0].facts[0].value, 2.9);
  assert.equal(after.items[0].facts[0].value, 3.4);
  assert.equal(after.items[0].facts[0].validFrom, t + 1);
  assert.equal(after.items[0].facts[0].recordedAt, t + 5000);
  assert.equal(after.items[0].facts[0].supersedes, before.items[0].facts[0].id);
  assert.equal(decodeJournal(restarted.journal()).lineage(after.items[0].facts[0].id).length, 2);
  assert.deepEqual(await selectBackground(restarted.journal(), before.request), before);
  assert.equal((await replayBackground(originalWorld, before)).comparison, 'match');
  const changed = structuredClone(before); changed.items[0].facts[0].value = 99;
  assert.equal((await replayBackground(originalWorld, changed)).comparison, 'changed');
  for (const stale of [{ ...before, policy: 'usgs-attention-receipt/v1' }, { ...before, version: 1 }])
    await assert.rejects(replayBackground(originalWorld, stale), /policy/);
  assert.equal(world.journal(), originalWorld);
  assert.equal((await selectBackground(restarted.journal(), request({ worldTo: t + 1 }))).items.length, 0);
});

test('agent is a journal subject; explicit state affects ranking at both clocks without inferred state', async () => {
  const world = await first();
  await world.receive(usgs(collection(quake({ id: 'synthetic2', mag: null })), t + 2500));
  const select = async extra => (await selectBackground(world.journal(), request({ maxEvents: 1, ...extra }))).items[0].subject;
  const noState = await selectBackground(world.journal(), request({ maxEvents: 1 }));
  assert.equal(noState.items[0].subject, 'usgs:synthetic2');
  assert.deepEqual(noState.state, []);
  await world.receive(signalFrame({ validFrom: t + 4000 }));
  assert.equal(await select(), 'usgs:synthetic1');
  assert.equal(await select({ knownAt: t + 2800 }), 'usgs:synthetic2');
  assert.equal(await select({ stateAt: t + 3500 }), 'usgs:synthetic2');
  assert.equal(await select({ agent: 'agent:other' }), 'usgs:synthetic2');
  assert.equal(await select({ maxSignals: 0 }), 'usgs:synthetic2');
  await world.receive(signalFrame({ id: 'don:attention:2', value: null, recordedAt: t + 5000, supersedes: 'don:attention:1' }));
  const cleared = await selectBackground(world.journal(), request({ maxEvents: 1 }));
  assert.equal(cleared.items[0].subject, 'usgs:synthetic2');
  assert.equal(cleared.items[0].facts[0].value, null);
  assert.equal(cleared.state[0].value, null);
  assert.equal(cleared.state[0].supersedes, 'don:attention:1');
  // Unknown future signal kinds are explicit sourced observations, preserved as evidence.
  await world.receive(signalFrame({ id: 'don:mode:1', predicate: 'task_mode', value: 'observe', recordedAt: t + 5500 }));
  const saved = world.journal();
  assert.equal((await selectBackground(saved, request())).state.length, 2);
  assert.equal(world.journal(), saved);
});

test('strict source provenance and complete versions are checked on restart and selection', async () => {
  const text = (await first()).journal();
  for (const damage of [
    data => { data.records[0].source = 'fixture:forged'; },
    data => { data.records.pop(); },
    data => { data.records[0].subject = 'other:synthetic1'; },
  ]) {
    const data = JSON.parse(text); damage(data);
    await assert.rejects(createBackground(JSON.stringify(data)));
    await assert.rejects(selectBackground(JSON.stringify(data), request()));
  }
});

test('failed batches and signals leave the whole world unchanged; duplicates and stale polls are explicit', async () => {
  const world = await first(), before = world.journal();
  assert.equal((await world.receive(usgs(collection(quake()), t + 3000))).unchanged, 1);
  assert.equal((await world.receive(usgs(collection(quake({ updated: t })), t + 3000))).stale, 1);
  for (const feed of [collection(quake(), quake()), collection(quake({ id: 'synthetic2' }), quake({ mag: NaN })),
    collection(quake({ mag: 9 }))]) await assert.rejects(world.receive(usgs(feed, t + 3000)));
  await assert.rejects(world.receive(usgs(collection(quake()), t + 1000)), /precedes/);
  await assert.rejects(world.receive(signalFrame({ source: undefined })), /source/);
  await assert.rejects(world.receive(signalFrame({ value: 'invented' })), /attention_subject/);
  await assert.rejects(world.receive({ kind: 'mood', receivedAt: t + 3000 }), /unknown instrument/);
  assert.equal(world.journal(), before);
  const small = await createBackground(before, { capacity: 15 });
  await assert.rejects(small.receive(usgs(collection(quake({ updated: t + 4000 })), t + 5000)), /capacity/);
  assert.equal(small.journal(), before);
  const byteLimited = await createBackground(before, { maxBytes: new TextEncoder().encode(before).length });
  await assert.rejects(byteLimited.receive(signalFrame()), /byte budget/);
  assert.equal(byteLimited.journal(), before);
  const countLimited = await createBackground(before, { maxEvents: 1 });
  await assert.rejects(countLimited.receive(usgs(collection(quake(), quake({ id: 'synthetic2' })), t + 3000)), /event budget/);
});

test('selection is deterministic, bounded in complete UTF-8 bytes, and visibly reports omitted events', async () => {
  const world = await createBackground();
  await world.receive(usgs(collection(quake({ id: 'z', place: 'Синтетика 🌳' }), quake({ id: 'a' })), t + 2000));
  const one = await selectBackground(world.journal(), request({ maxEvents: 1 }));
  assert.equal(one.items[0].subject, 'usgs:a');
  assert.equal(one.eligible, 2); assert.equal(one.omitted, 1);
  assert.equal(one.complete, false); assert.deepEqual(one.limitedBy, ['maxEvents']);
  const tiny = await selectBackground(world.journal(), request({ maxBytes: 1024 }));
  assert.equal(tiny.items.length, 0); assert.equal(tiny.omitted, 2); assert.deepEqual(tiny.limitedBy, ['maxBytes']);
  for (const maxBytes of [1024, 3000, 5000, 8000]) {
    const result = await selectBackground(world.journal(), request({ maxBytes }));
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= maxBytes);
    assert.ok(result.items.every(item => item.facts.length === 8));
  }
  const only = await selectBackground(world.journal(), request({ subject: 'usgs:z' }));
  assert.equal(only.items.length, 1); assert.equal(only.complete, true);
  assert.deepEqual(await selectBackground(world.journal(), request()), await selectBackground(world.journal(), request()));
  const empty = await selectBackground(world.journal(), request({ knownAt: t }));
  assert.deepEqual(empty.items, []); assert.equal(empty.complete, true);
  // State that cannot fit is omitted and counted; the background stays readable.
  await world.receive(signalFrame({ predicate: 'external_note', value: 'я'.repeat(2000) }));
  const crowded = await selectBackground(world.journal(), request({ maxBytes: 1024 }));
  assert.deepEqual(crowded.state, []); assert.equal(crowded.stateOmitted, 1);
  assert.equal(crowded.complete, false); assert.deepEqual(crowded.limitedBy, ['maxBytes']);
  for (const extra of [{ knownAt: undefined }, { stateAt: 0.5 }, { maxEvents: 0 }, { maxBytes: 999 },
    { maxSignals: -1 }, { maxSignals: 65 }, { worldTo: t }, { agent: 'usgs:a' }, { hiddenState: true }])
    await assert.rejects(selectBackground(world.journal(), request(extra)));
});

test('location and camera receipts arrive through the same door and stay outside this policy, counted', async () => {
  const world = await first();
  await world.receive(location('fix1', t + 2100));
  await world.receive(camera('frame1', t + 2200));
  await world.receive(signalFrame());
  await world.receive(location('late', t + 4000, t - 500));
  const journal = world.journal(), restarted = await createBackground(journal);
  assert.equal(restarted.journal(), journal);
  assert.equal(decodeJournal(journal).size, 8 + 3 + (3 + 3) + 1 + 3);
  const context = await selectBackground(journal, request());
  assert.deepEqual(context.otherInstruments, { location: 1, camera: 1 });
  assert.equal(context.items[0].reason, 'attention_subject');
  assert.ok(context.items.every(item => item.subject.startsWith('usgs:')));
  assert.deepEqual((await selectBackground(journal, request({ knownAt: t + 2150 }))).otherInstruments, { location: 1, camera: 0 });
  assert.deepEqual((await selectBackground(journal, request({ worldFrom: t - 1000 }))).otherInstruments, { location: 2, camera: 1 });
  // The full image stays in the world for the existing tools; context carries none of it.
  const rows = createToolHost(decodeJournal(journal)).call('lalo_history', { knownAt: t + 6000, source: 'browser:camera', limit: 64 });
  assert.equal(rows.data.items.filter(f => f.predicate.startsWith('camera.jpeg.')).map(f => f.value).join(''), jpeg());
  assert.ok(!JSON.stringify(context).includes('camera.jpeg'));
  for (const damage of [
    data => { data.records.find(f => f.predicate === 'accuracy').value = -1; },
    data => { data.records.find(f => f.predicate === 'camera.sha256').value = '0'.repeat(64); },
    data => { data.records.find(f => f.predicate === 'latitude').source = 'browser:camera'; },
    data => { data.records.find(f => f.predicate === 'latitude').subject = 'agent:don-eduardo'; },
  ]) {
    const data = JSON.parse(journal); damage(data);
    await assert.rejects(createBackground(JSON.stringify(data)));
    await assert.rejects(selectBackground(JSON.stringify(data), request()));
  }
  await assert.rejects(world.receive(location('fix1', t + 5000)), /duplicate/);
  await assert.rejects(world.receive(location('early', t + 3500)), /precedes/);
  await assert.rejects(world.receive({ ...camera('broken', t + 5000), image: { ...camera().image, jpeg: 'AAAA' } }), /JPEG/);
  assert.equal(world.journal(), journal);
});

test('open agent signals cannot crowd the context: a bounded newest prefix carries the reasons', async () => {
  const world = await first();
  await world.receive(usgs(collection(quake({ id: 'synthetic2' })), t + 2500));
  await world.receive(signalFrame({ value: 'usgs:synthetic1', recordedAt: t + 3000 }));
  for (let n = 0; n < 200; n++)
    await world.receive(signalFrame({ id: `don:note:${n}`, predicate: 'note', value: `n${n}`, recordedAt: t + 3001 + n }));
  const context = await selectBackground(world.journal(), request({ knownAt: t + 10_000, stateAt: t + 5000 }));
  assert.equal(context.stateEligible, 201); assert.equal(context.state.length, 8); assert.equal(context.stateOmitted, 193);
  assert.deepEqual(context.state.map(f => f.id), [199, 198, 197, 196, 195, 194, 193, 192].map(n => `don:note:${n}`));
  assert.ok(context.limitedBy.includes('maxSignals'));
  assert.ok(Buffer.byteLength(JSON.stringify(context)) <= context.request.maxBytes);
  // The older attention receipt is outside the carried state, so it cannot rank.
  assert.deepEqual(context.items.map(i => [i.subject, i.reason]), [['usgs:synthetic2', 'receipt_order'], ['usgs:synthetic1', 'receipt_order']]);
  const wide = await selectBackground(world.journal(), request({ knownAt: t + 10_000, stateAt: t + 5000, maxSignals: 64, maxBytes: 65_536 }));
  assert.equal(wide.state.length, 64);
  const early = await selectBackground(world.journal(), request({ knownAt: t + 3000, stateAt: t + 5000 }));
  assert.equal(early.items[0].reason, 'attention_subject'); assert.equal(early.complete, true);
});

test('the agent participates: its executed reads become attention receipts that move the next context', async () => {
  const world = await first();
  await world.receive(usgs(collection(quake({ id: 'synthetic2' })), t + 2500));
  const decision = name => ({ status: 'call', calls: [{ name, arguments: {} }],
    confidence: 0.9, reasoning: { mode: 'neural', winner: name, arguments: [] } });
  const act = async (subject, status = 'call') => createRouteSession(createToolHost(decodeJournal(world.journal())),
    { route: async () => status === 'call' ? decision('lalo_facts') : { ...decision('lalo_facts'), status, calls: [] } })
    .call({ text: 'read this event', arguments: { subject, knownAt: t + 2500, validAt: t } });
  const frame = (id, receivedAt, trace) => ({ kind: 'action', agent: 'agent:don-eduardo', id, receivedAt, trace });
  const firstRead = await act('usgs:synthetic1');
  assert.equal(firstRead.status, 'executed');
  const one = await world.receive(frame('don:act:1', t + 3000, firstRead));
  assert.equal(one.kind, 'action'); assert.equal(one.receipts, 1); assert.equal(one.signal, 'don:act:1');
  const top = async knownAt => (await selectBackground(world.journal(), request({ knownAt, stateAt: knownAt, maxEvents: 1 }))).items[0];
  assert.equal((await top(t + 2500)).subject, 'usgs:synthetic2');
  assert.deepEqual([(await top(t + 3000)).subject, (await top(t + 3000)).reason], ['usgs:synthetic1', 'attention_subject']);
  await world.receive(frame('don:act:2', t + 4000, await act('usgs:synthetic2')));
  const facts = decodeJournal(world.journal()).lineage('don:act:2');
  assert.deepEqual(facts.map(f => [f.id, f.value, f.source]),
    [['don:act:1', 'usgs:synthetic1', 'lalo:action/lalo_facts'], ['don:act:2', 'usgs:synthetic2', 'lalo:action/lalo_facts']]);
  assert.equal((await top(t + 4000)).subject, 'usgs:synthetic2');
  assert.equal((await top(t + 3500)).subject, 'usgs:synthetic1');
  // An abstention or a read outside the source names no attention; nothing is appended.
  const before = world.journal();
  for (const trace of [await act('usgs:synthetic1', 'no_call'), await act('device:this-browser')])
    assert.deepEqual(await world.receive(frame('don:act:3', t + 5000, trace)), { kind: 'action', receipts: 0, signal: null, records: 18 });
  await assert.rejects(world.receive(frame('don:act:3', t + 5000, { format: 'other' })), /trace/);
  assert.equal(world.journal(), before);
});

test('overlapping arrivals are serialized; a failed arrival between them leaves both neighbours committed', async () => {
  const world = await createBackground();
  const results = await Promise.allSettled([
    world.receive(usgs(collection(quake()), t + 2000)),
    world.receive(signalFrame({ value: 'invented' })),
    world.receive(location('fix1', t + 2100)),
    world.receive(signalFrame({ recordedAt: t + 2200 })),
  ]);
  assert.deepEqual(results.map(r => r.status), ['fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
  assert.deepEqual(results.filter(r => r.value).map(r => r.value.records), [8, 11, 12]);
  assert.equal(decodeJournal(world.journal()).size, 12);
});
