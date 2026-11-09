// Reproducible synthetic field session. --frames emits the same inputs for the durable receiver.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBackground } from '../src/background.js';
import { selectBackground } from '../src/background-context.js';
import { decodeJournal } from '../src/journal.js';
import { createToolHost } from '../src/tools.js';
import { createRouteSession } from '../src/route.js';
import { createNativeRouter } from '../scripts/native-router.mjs';
import { actionMemory } from '../scripts/action-memory.mjs';
import { collection, quake, QUAKETIME as noon } from '../tests/fixtures/usgs.js';
import { weatherFrame } from '../tests/fixtures/gev-weather.js';

const minute = 60_000, radarTime = noon - 2 * minute, baseline = noon + minute, later = noon + 8 * minute;
const clouds = weatherFrame('clouds', [noon - 10 * minute], noon, baseline);
const radar = weatherFrame('radar', [radarTime], noon + 2 * minute, later, true);
const frames = [
  { kind: 'usgs', receivedAt: baseline, feed: collection(quake()) },
  clouds, radar,
  { ...radar, receivedAt: later + minute },
  { kind: 'usgs', receivedAt: later + minute, feed: collection(quake({ mag: 3.4, updated: later })) },
];
if (process.argv[2] === '--frames') {
  for (const f of frames) console.log(JSON.stringify(f));
  process.exit(0);
}
const world = await createBackground();
for (const frame of frames.slice(0, 2)) await world.receive(frame);
const memoryPath = await mkdtemp(join(tmpdir(), 'lalo-weather-sim-'));
try {
  const router = await createNativeRouter();
  let trace;
  try {
    const session = createRouteSession(createToolHost(decodeJournal(world.journal())), router);
    trace = await session.call({ text: 'read hypothesis', arguments: { rule: 'unanimous-boolean/v1',
      subject: 'nowcoast:radar', predicate: 'frame_listed', expected: true, validAt: radarTime, knownAt: baseline } });
  } finally { await router.close(); }
  assert.equal(trace.result?.data?.reading?.state, 'unsettled');
  const ack = await (await actionMemory(memoryPath)).append(trace, world.journal());
  const arrivals = [];
  for (const frame of frames.slice(2)) arrivals.push(await world.receive(frame));
  assert.equal(arrivals[1].receipts, 0);

  const reopened = await actionMemory(memoryPath);
  const host = createToolHost(decodeJournal(world.journal()), { recall: query => reopened.recall(query) });
  const knownAt = frames.at(-1).receivedAt;
  const comparison = await host.call('lalo_compare_reading', { sequence: ack.sequence, head: ack.head, knownAt });
  assert.equal(comparison.data?.savedReading.state, 'unsettled');
  assert.equal(comparison.data?.reading.state, 'supported');
  assert.equal(comparison.data.comparison.verdictChanges, 1);
  const radarReceipt = comparison.data.items[0].fact;
  const quakeReceipt = decodeJournal(world.journal()).entries().find(f => f.predicate === 'magnitude');
  const janus = await host.call('lalo_calendar', { id: radarReceipt.id, compareToId: quakeReceipt.id, knownAt });
  const { occurrence, receipt } = janus.data.calendar.comparison;
  assert.deepEqual([occurrence.order, receipt.order], [-1, 1]);

  const context = await selectBackground(world.journal(), { agent: 'agent:don-eduardo', knownAt, stateAt: knownAt,
    worldFrom: noon - 10 * minute, worldTo: noon + 1 });
  const quakeNow = context.items.find(item => item.subject === quakeReceipt.subject);
  assert.equal(quakeNow.facts[0].value, 3.4);
  console.log(JSON.stringify({ synthetic: true, subjects: context.items.map(i => i.subject),
    radar: { observedAt: new Date(radarTime).toISOString(), knownAt: new Date(radarReceipt.recordedAt).toISOString(),
      source: radarReceipt.source, before: comparison.data.savedReading.state, after: comparison.data.reading.state,
      repeatedReceipts: arrivals[1].receipts }, quakeMagnitude: [quakeReceipt.value, quakeNow.facts[0].value],
    janusRadarVsQuake: { occurrenceOrder: occurrence.order, receiptOrder: receipt.order } }, null, 2));
} finally { await rm(memoryPath, { recursive: true, force: true }); }
