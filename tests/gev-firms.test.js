import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBackground } from '../src/background.js';
import { selectBackground, replayBackground } from '../src/background-context.js';
import { decodeJournal } from '../src/journal.js';
import { createToolHost } from '../src/tools.js';
import { regionBounds, containsPoint } from '../src/region.js';
import { weatherFrame } from './fixtures/gev-weather.js';
import { box, noon, minute, feed, fire } from './fixtures/gev-firms.js';
import { collection, quake } from './fixtures/usgs.js';

const query = { agent: 'agent:don-eduardo', worldFrom: noon - 24 * 60 * minute, worldTo: noon + 1, knownAt: noon, stateAt: noon };

test('FIRMS captures independent overpasses, first proxy metadata and the published UTC minute', async () => {
  const world = await createBackground(), row = fire({ acqTime: '45', frp: 0, confidence: '' });
  const rows = [row, fire({ instrument: 'MODIS', satellite: 'Aqua', confidence: 0, acqTime: 45 }), fire({ lon: 50 })];
  const frame = feed(rows); frame.feed.sources[1].ok = false; frame.feed.stale = true;
  const queued = world.receive(frame);
  row.lat = -85; frame.feed.sources[1].ok = true;
  const a = await queued;
  assert.deepEqual([a.added, a.outside, a.unavailable], [2, 1, ['VIIRS_NOAA21_NRT']]);
  const saved = world.journal(), restarted = await createBackground(saved);
  const result = await selectBackground(saved, { ...query, bbox: box });
  assert.deepEqual(result.items.map(i => i.facts[0].recordedAt), [noon, noon]);
  const viirs = result.items.find(i => i.subject.startsWith('firms:N20:')), facts = viirs.facts;
  const v = Object.fromEntries(facts.map(f => [f.predicate, f.value]));
  assert.deepEqual([v.latitude, v.longitude, v.instrument, v.confidence, v.frp_mw], [40, 30, 'VIIRS', null, null]);
  assert.deepEqual([v.proxy_fetched_at, v.proxy_stale, v.unavailable_products], [noon - minute, true, 'VIIRS_NOAA21_NRT']);
  assert.equal(result.items.find(i => i.subject.startsWith('firms:Aqua:')).facts.find(f => f.predicate === 'confidence').value, '0');
  const at = Date.UTC(2026, 9, 15, 0, 45);
  assert.deepEqual([facts[0].validFrom, facts[0].validTo], [at, at + minute]);
  const host = createToolHost(decodeJournal(saved));
  for (const [validAt, knownAt, count] of [[at, noon - 1, 0], [at + 59999, noon, 1], [at + minute, noon, 0]]) {
    const result = host.call('lalo_facts', { subject: viirs.subject, predicate: 'thermal_detection', validAt, knownAt });
    assert.equal(result.data.total, count);
  }
  const repeat = await restarted.receive(feed([fire({ acqTime: '0045', frp: 0, confidence: '' })], noon + minute));
  assert.equal(repeat.unchanged, 1); assert.equal(restarted.journal(), saved);
  const call = { name: 'lalo_history', arguments: { knownAt: noon, subject: viirs.subject } };
  await restarted.receive({ kind: 'action', agent: query.agent, id: 'read-firms', receivedAt: noon + minute,
    trace: { format: 'lalo/action', version: 1, status: 'executed', call, result: host.call(call.name, call.arguments) } });
  const focus = await selectBackground(restarted.journal(), { ...query, knownAt: noon + minute, stateAt: noon + minute, maxEvents: 1 });
  assert.equal(focus.items[0].subject, viirs.subject); assert.equal(focus.items[0].reason, 'attention_subject');
});

test('regional rewind resolves USGS corrections before filtering and leaves unlocated frames outside', async () => {
  const world = await createBackground();
  const quakeFrame = (lon, updated, receivedAt) => ({ kind: 'usgs', receivedAt,
    feed: collection(quake({ coordinates: [lon, 40, 4], updated, time: noon - minute })) });
  await world.receive(quakeFrame(30, noon - 3 * minute, noon));
  await world.receive(weatherFrame('clouds', [noon - minute], noon, noon));
  await world.receive(quakeFrame(35, noon + minute, noon + minute));
  await world.receive(feed([fire()], noon + minute));
  const saved = world.journal();
  assert.deepEqual((await selectBackground(saved, { ...query, bbox: box })).items.map(i => i.subject), ['usgs:synthetic1']);
  const now = await selectBackground(saved, { ...query, knownAt: noon + minute, bbox: box });
  assert.equal(now.items.length, 1); assert.match(now.items[0].subject, /^firms:/);
});

test('the v5 weather projection from 50f215b replays even with a same-cutoff FIRMS receipt', async () => {
  const world = await createBackground();
  await world.receive(weatherFrame('clouds', [noon - minute], noon, noon));
  const v5 = JSON.parse(await readFile(new URL('./fixtures/background-v5.json', import.meta.url), 'utf8'));
  await world.receive(feed([fire()], noon));
  const saved = world.journal(), replay = await replayBackground(saved, v5);
  const expected = structuredClone(v5);
  expected.items[0].calendar.wasmSha256 = replay.result.items[0].calendar.wasmSha256;
  assert.deepEqual(replay.result, expected);
  assert.equal(replay.comparison, expected.items[0].calendar.wasmSha256 === v5.items[0].calendar.wasmSha256 ? 'match' : 'changed');
  await assert.rejects(replayBackground(saved, { ...v5, request: { ...query, bbox: box } }), /request/);
  assert.equal((await selectBackground(saved, query)).eligible, 2);
});

test('wrapped regions include both sides of the dateline and apply the same bounds at ingest and read', async () => {
  const bbox = [170, -10, -170, 10], world = await createBackground();
  const frame = feed([180,-180,170,-170,0].map(lon => fire({ lon, lat: 10 })));
  const result = await world.receive({ ...frame, bbox });
  assert.deepEqual([result.added, result.unchanged, result.outside], [3, 1, 1]);
  const selected = await selectBackground(world.journal(), { ...query, bbox: [175, 0, -175, 10] });
  assert.equal(selected.eligible, 1);
  assert.equal(containsPoint([160, 0, 180, 10], -180, 0), true);
  for (const bad of [[0,0,0,3], [180,0,-180,2], [2,15,3,10], [2,-91,3,10], [2,3,4,'5'], [2,3,4,Infinity]])
    assert.throws(() => regionBounds(bad));
});

test('a world feed larger than the journal is scoped before applying the regional event budget', async () => {
  const world = await createBackground(undefined, { maxEvents: 1 });
  const rows = Array(131_072).fill(fire({ lon: 50 }));
  rows.push(fire());
  const result = await world.receive(feed(rows));
  assert.deepEqual([result.total, result.outside, result.added, result.records], [131_073, 131_072, 1, 10]);
});

test('ambiguous changes, invalid rows, forged groups and exhausted budgets preserve accepted history', async () => {
  const world = await createBackground(); await world.receive(feed([fire()]));
  const before = world.journal();
  for (const patch of [{ acqDate: '2026-02-30' }, { acqTime: '2400' }, { acqTime: ['1142'] },
    { lat: null }, { lon: 190 }, { frp: -2 }, { confidence: false }, { instrument: '' }, { frp: 9 }]) {
    await assert.rejects(world.receive(feed([fire({ lon: 30.2 }), fire(patch)], noon + minute)));
    assert.equal(world.journal(), before);
  }
  for (const patch of [{ count: 2 }, { stale: 0 }, { fetchedAt: null }, { sources: [] },
    { sources: [{ source: 'MODIS_NRT', count: 0, ok: true }] },
    { sources: [{ source: 'MODIS_NRT', count: 0, ok: false }] }])
    await assert.rejects(world.receive(feed([fire()], noon + minute, patch)));
  for (const options of [{ capacity: 19 }, { maxEvents: 1 }, { maxBytes: 800 }]) {
    const limited = await createBackground(undefined, options), empty = limited.journal();
    await assert.rejects(limited.receive(feed([fire(), fire({ lon: 30.5 })]))); assert.equal(limited.journal(), empty);
  }
  for (const damage of [r => r.pop(), r => { r[2].value = 20; }, r => { r[0].source += '/forged'; },
    r => { r[2].validTo++; }, r => { r[7].value = true; }, r => { r[0].id += 'x'; }]) {
    const journal = JSON.parse(before); damage(journal.records);
    await assert.rejects(createBackground(JSON.stringify(journal)));
  }
  assert.equal(world.journal(), before);
});
