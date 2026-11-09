import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBackground } from '../src/background.js';
import { replayBackground, selectBackground } from '../src/background-context.js';
import { fix, request, route } from './fixtures/device-route.js';
import { feed, fire, minute, noon } from './fixtures/gev-firms.js';
import { weatherFrame } from './fixtures/gev-weather.js';
import { collection, quake } from './fixtures/usgs.js';

test('a late fix changes the retrospective noon region and preserves the original answer and runtime receipt', async () => {
  const world = await createBackground();
  for (const frame of route()) await world.receive(frame);
  const read = override => selectBackground(world.journal(), { ...request, ...override });
  const first = await read({}), updated = await read({ knownAt: noon + 8 * minute });
  assert.deepEqual(first.items.map(i => i.distanceMeters), [85]);
  assert.match(first.items[0].subject, /^firms:/);
  assert.deepEqual(updated.items.map(i => [i.subject, i.distanceMeters]), [['usgs:synthetic1', 85]]);
  assert.deepEqual(updated.locationAnchor.facts.map(f => [f.id, f.value]), [
    ['location:stop-b:latitude', 40], ['location:stop-b:longitude', 30.1], ['location:stop-b:accuracy', 7]]);
  const lat = updated.locationAnchor.facts[0];
  assert.deepEqual([lat.source, lat.validFrom, lat.recordedAt, updated.locationAnchor.ageMs],
    ['browser:geolocation', noon - minute, noon + 7 * minute, minute]);
  assert.equal(updated.locationAnchor.calendar.assertion.id, lat.id);
  assert.equal(updated.locationAnchor.calendar.civil.schema, 'janus.calendar/1');
  assert.deepEqual(first.state.map(f => [f.source, f.predicate, f.value]), [['fixture:model-runtime', 'kv_cache_used_tokens', 128]]);
  assert.deepEqual(first.state, updated.state);
  assert.deepEqual((await read({ agent: 'agent:another-model' })).state, []);
  const then = await read({ knownAt: noon + 8 * minute, stateAt: noon - 10 * minute });
  assert.equal(then.locationAnchor.facts[0].id, 'location:stop-a:latitude');
  assert.deepEqual(then.state, []);
  assert.deepEqual((await read({ knownAt: noon - 1 })).state, []);
  const empty = await read({ worldFrom: noon, worldTo: noon + 1 });
  assert.equal(empty.eligible, 0);
  assert.deepEqual(empty.locationAnchor, first.locationAnchor);
  assert.equal((await replayBackground(world.journal(), first)).comparison, 'match');
  const limited = await read({ maxBytes: Buffer.byteLength(JSON.stringify(first)) - 100 });
  assert.deepEqual(limited.locationAnchor, first.locationAnchor);
  assert.deepEqual([limited.eligible, limited.omitted, limited.complete, limited.limitedBy], [1, 1, false, ['maxBytes']]);
  assert.ok(Buffer.byteLength(JSON.stringify(limited)) <= limited.request.maxBytes);
  const tampered = structuredClone(first);
  tampered.locationAnchor.facts[2].value++;
  assert.equal((await replayBackground(world.journal(), tampered)).comparison, 'changed');
});

test('a missing, late or stale fix cannot silently broaden a device request', async () => {
  const world = await createBackground();
  const read = (nearDevice, extra) => selectBackground(world.journal(), { ...request, nearDevice, ...extra });
  await assert.rejects(read(request.nearDevice), { code: 'LOCATION_UNAVAILABLE' });
  await world.receive(fix('one', 30, noon, noon + 10));
  await assert.rejects(read(request.nearDevice), { code: 'LOCATION_UNAVAILABLE' });
  await assert.rejects(read(request.nearDevice, { stateAt: noon - 1, knownAt: noon + 10 }), { code: 'LOCATION_UNAVAILABLE' });
  const zeroAge = { radiusMeters: 1, maxFixAgeMs: 0 };
  const exact = await read(zeroAge, { knownAt: noon + 10 });
  assert.equal(exact.locationAnchor.ageMs, 0);
  await assert.rejects(read(zeroAge, { stateAt: noon + 1, knownAt: noon + 10 }), { code: 'LOCATION_STALE' });
  await assert.rejects(read(zeroAge, { knownAt: noon + 10, maxBytes: 1024 }), /byte budget/);
  for (const bad of [undefined, null, [], {}, { radiusMeters: 3 }, { ...zeroAge, radiusMeters: -3 },
    { ...zeroAge, maxFixAgeMs: 0.5 }, { ...zeroAge, radiusMeters: NaN }, { ...zeroAge, extra: true }])
    await assert.rejects(read(bad), /nearDevice/);
  await assert.rejects(read(zeroAge, { bbox: [29,39,31,41] }), /bbox or nearDevice/);
});

test('ties resolve by receipt time then identifier, independently of append order', async () => {
  for (const ids of [['z','a'], ['a','z']]) {
    const world = await createBackground();
    await world.receive(fix('earlier', 40, noon - minute, noon - minute));
    for (const id of ids) await world.receive(fix(id, id === 'a' ? 25 : 30, noon - minute, noon));
    const result = await selectBackground(world.journal(), request);
    assert.equal(result.locationAnchor.facts[0].id, 'location:a:latitude');
    assert.equal(result.locationAnchor.facts[1].value, 25);
  }
});

test('meter-rounded distances cross the dateline, include the boundary, exclude unlocated groups and resolve moved quakes', async () => {
  const world = await createBackground();
  const event = (id, lon, updated = noon) => quake({ id, coordinates: [lon, 0, 4], time: noon - minute, updated });
  await world.receive(fix('previous', 180, noon - 4, noon - 3, 0));
  await world.receive(fix('center', 179.999, noon - 2, noon - 1, 0));
  await world.receive(weatherFrame('clouds', [noon - minute], noon, noon));
  await world.receive({ kind: 'usgs', receivedAt: noon, feed: collection(event('across', -179.999), event('remote', -170)) });
  const read = (radiusMeters, knownAt = noon) => selectBackground(world.journal(),
    { ...request, knownAt, nearDevice: { radiusMeters, maxFixAgeMs: 2 } });
  const edge = await read(222);
  assert.deepEqual(edge.items.map(i => [i.subject, i.distanceMeters]), [['usgs:across', 222]]);
  assert.deepEqual(edge.otherInstruments, { location: 1, camera: 0 });
  assert.equal((await read(221)).eligible, 0);
  await world.receive({ kind: 'usgs', receivedAt: noon + 1, feed: collection(event('across', 160, noon + 1)) });
  assert.equal((await read(222, noon + 1)).eligible, 0);
  assert.equal((await read(222)).eligible, 1);
});

test('a v6 rectangle from the merged implementation keeps its location count, payload and policy', async () => {
  const saved = JSON.parse(await readFile(new URL('./fixtures/background-v6.json', import.meta.url), 'utf8'));
  const world = await createBackground();
  await world.receive(feed([fire()]));
  const location = fix('v6', 30, noon, noon);
  location.position.coords.accuracy = 5;
  await world.receive(location);
  const replay = await replayBackground(world.journal(), saved);
  const expected = structuredClone(saved);
  expected.items[0].calendar.wasmSha256 = replay.result.items[0].calendar.wasmSha256;
  assert.deepEqual(replay.result, expected);
  assert.equal(replay.comparison, saved.items[0].calendar.wasmSha256 === expected.items[0].calendar.wasmSha256 ? 'match' : 'changed');
  await assert.rejects(replayBackground(world.journal(), { ...saved, request: { ...saved.request, nearDevice: request.nearDevice } }), /request/);
});
