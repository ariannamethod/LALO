import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackground } from '../src/background.js';
import { selectBackground, replayBackground } from '../src/background-context.js';
import { decodeJournal } from '../src/journal.js';
import { createToolHost } from '../src/tools.js';
import { manifestUrl } from '../src/sources/gev-weather.js';
import { weatherFrame, simulationOrigin } from './fixtures/gev-weather.js';

const don = 'agent:don-eduardo';
const request = { agent: don, stateAt: 1000, knownAt: 1000, worldFrom: 0, worldTo: 500 };
const radar = () => weatherFrame('radar', [100, 200], 300, 400);

test('all GEV product frames keep the source, observation, cache and first receipt on restart', async () => {
  const world = await createBackground();
  for (const product of ['radar', 'lightning', 'clouds', 'clouds-regional']) {
    const arrival = await world.receive(weatherFrame(product, [100, 200], 300, 400, true));
    assert.equal(arrival.added, 2); assert.equal(arrival.receipts, 6);
  }
  const before = world.journal(), restarted = await createBackground(before);
  assert.equal((await restarted.receive(weatherFrame('radar', [200], 450, 500))).unchanged, 1);
  assert.equal(restarted.journal(), before);
  const select = args => selectBackground(before, { ...request, ...args });
  assert.equal((await select({ knownAt: 399 })).eligible, 0);
  assert.equal((await select({ worldFrom: 200, worldTo: 201 })).eligible, 4);
  const { items, eligible, omitted } = await select({ subject: 'nowcoast:radar', maxEvents: 1 });
  assert.equal(eligible, 2); assert.equal(omitted, 1);
  const facts = items[0].facts;
  assert.deepEqual(facts.map(f => f.value), [true, 300, true]);
  assert.ok(facts.every(f => f.validFrom === 200 && f.validTo === 201 && f.recordedAt === 400
    && f.source === manifestUrl(simulationOrigin, 'radar')));
  assert.equal(items[0].calendar.assertion.id, facts[0].id);
  const next = await restarted.receive({ ...radar(), origin: 'https://other-simulation.invalid', receivedAt: 600 });
  assert.equal(next.added, 2);
});

test('invalid, unavailable and oversized manifests leave every accepted receipt intact', async () => {
  const world = await createBackground(); await world.receive(radar());
  const before = world.journal();
  for (const patch of [
    { unavailable: true }, { source: 'other' }, { product: 'rainfall' }, { schemaVersion: 2 }, { stale: 'true' },
    { times: [] }, { times: Array(14).fill('x') }, { times: ['2026-02-30T00:00:00.000Z'] },
    { fetchedAt: null }, { times: radar().manifest.times.toReversed() }, { latest: null },
    { times: [radar().manifest.latest, radar().manifest.latest] },
  ]) {
    const frame = radar(); Object.assign(frame.manifest, patch);
    await assert.rejects(world.receive(frame));
    assert.equal(world.journal(), before);
  }
  for (const origin of ['file:///tmp/feed', 'https://login:pw@example.com', 'https://example.com/extra'])
    await assert.rejects(world.receive({ ...radar(), origin }));
  for (const options of [{ capacity: 5 }, { maxEvents: 1 }, { maxBytes: 600 }]) {
    const small = await createBackground(undefined, options), empty = small.journal();
    await assert.rejects(small.receive(radar())); assert.equal(small.journal(), empty);
  }
  for (const change of [rows => rows.pop(), rows => { rows[1].value = '300'; },
    rows => { rows[0].source = simulationOrigin; }, rows => { rows[2].recordedAt--; },
    rows => { rows[1].validTo++; }, rows => { rows[0].id += '-forged'; }]) {
    const data = JSON.parse(before); change(data.records);
    await assert.rejects(createBackground(JSON.stringify(data)));
  }
});

test('weather reads can direct attention and reproduce without changing earlier policy output', async () => {
  const world = await createBackground();
  const legacy = { ...await selectBackground(world.journal(), request), version: 4, policy: 'usgs-attention-janus/v4' };
  await world.receive(radar());
  await world.receive(weatherFrame('clouds', [100], 450, 500));
  assert.equal((await replayBackground(world.journal(), legacy)).comparison, 'match');
  const call = { name: 'lalo_history', arguments: { subject: 'nowcoast:radar', knownAt: 550 } };
  const result = createToolHost(decodeJournal(world.journal())).call(call.name, call.arguments);
  await world.receive({ kind: 'action', agent: don, id: 'read-radar', receivedAt: 600,
    trace: { format: 'lalo/action', version: 1, status: 'executed', call, result } });
  const saved = await selectBackground(world.journal(), { ...request, maxEvents: 1 });
  assert.equal(saved.items[0].subject, 'nowcoast:radar');
  assert.equal(saved.items[0].reason, 'attention_subject');
  assert.equal(saved.state[0].id, 'read-radar');
  assert.equal((await replayBackground(world.journal(), saved)).comparison, 'match');
});
