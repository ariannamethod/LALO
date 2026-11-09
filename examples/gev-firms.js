// Which point observations from before noon had reached Don by the time he answered?
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBackground } from '../src/background.js';
import { selectBackground, replayBackground } from '../src/background-context.js';
import { createToolHost } from '../src/tools.js';
import { decodeJournal } from '../src/journal.js';
import { actionMemory } from '../scripts/action-memory.mjs';
import { collection, quake } from '../tests/fixtures/usgs.js';
import { box, noon, minute, fire, feed } from '../tests/fixtures/gev-firms.js';

const later = noon + 7 * minute;
const request = { agent: 'agent:don-eduardo', bbox: box, worldFrom: noon - 30 * minute, worldTo: noon,
  stateAt: noon, knownAt: noon };
const first = fire(), outside = fire({ lon: 35 }), late = fire({ satellite: 'N21', acqTime: '1140' });
const earthquake = { kind: 'usgs', receivedAt: noon - 3 * minute,
  feed: collection(quake({ time: noon - 10 * minute, updated: noon - 5 * minute })) };
const frames = [feed([first, outside], noon - 5 * minute), earthquake, feed([first, outside, late], later)];
if (process.argv[2] === '--frames') {
  for (const frame of frames) console.log(JSON.stringify(frame));
  process.exit(0);
}
const world = await createBackground();
await world.receive(frames[0]); await world.receive(frames[1]);
const earlier = await selectBackground(world.journal(), request);
const dir = await mkdtemp(join(tmpdir(), 'lalo-firms-region-'));
try {
  const ack = await (await actionMemory(dir)).append({ format: 'lalo/action', version: 1, status: 'executed',
    request: { kind: 'background-context', arguments: earlier.request }, route: null, call: null, result: earlier }, world.journal());
  const arrival = await world.receive(frames[2]);
  assert.deepEqual([arrival.added, arrival.unchanged, arrival.outside], [1, 1, 1]);
  const current = await selectBackground(world.journal(), { ...request, knownAt: later, stateAt: later });
  const saved = await (await actionMemory(dir)).recall({ sequence: ack.sequence, head: ack.head, snapshot: true });
  const replay = await replayBackground(JSON.stringify(saved.journal), saved.receipt.action.result);
  assert.equal(replay.comparison, 'match');
  assert.deepEqual([replay.result.eligible, current.eligible], [2, 3]);
  const priorIDs = new Set(replay.result.items.map(i => i.facts[0].id));
  const added = current.items.filter(i => !priorIDs.has(i.facts[0].id));
  assert.equal(added.length, 1);
  const point = added[0].facts[0], other = earlier.items.find(i => i.subject.startsWith('usgs:')).facts[0];
  const result = await createToolHost(decodeJournal(world.journal())).call('lalo_calendar',
    { id: point.id, compareToId: other.id, knownAt: later });
  const { occurrence, receipt } = result.data.calendar.comparison;
  assert.deepEqual([occurrence.order, receipt.order], [-1, 1]);
  console.log(JSON.stringify({ synthetic: true, bbox: box, knownByNoon: replay.result.items.map(i => i.subject),
    knownAt1207: current.items.map(i => i.subject), newReceipt: point, replay: replay.comparison,
    janusVsQuake: { occurrence: occurrence.order, receipt: receipt.order } }, null, 2));
} finally { await rm(dir, { recursive: true, force: true }); }
