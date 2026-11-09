// Repeat the same noon question after a delayed fix arrives and after reopening AML.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBackground } from '../src/background.js';
import { selectBackground, replayBackground } from '../src/background-context.js';
import { actionMemory } from '../scripts/action-memory.mjs';
import { route, request } from '../tests/fixtures/device-route.js';

const frames = route();
if (process.argv[2] === '--frames') {
  for (const frame of frames) console.log(JSON.stringify(frame));
} else if (process.argv[2] === '--request') {
  console.log(JSON.stringify(request));
} else {
  const world = await createBackground();
  for (const frame of frames.slice(0, 4)) await world.receive(frame);
  const noon = await selectBackground(world.journal(), request);
  const dir = await mkdtemp(join(tmpdir(), 'lalo-device-route-'));
  try {
    const ack = await (await actionMemory(dir)).append({ format: 'lalo/action', version: 1, status: 'executed',
      request: { kind: 'background-context', arguments: noon.request }, route: null, call: null, result: noon }, world.journal());
    for (const frame of frames.slice(4)) await world.receive(frame);
    const later = await selectBackground(world.journal(), { ...request, knownAt: frames.at(-1).receivedAt });
    const saved = await (await actionMemory(dir)).recall({ sequence: ack.sequence, head: ack.head, snapshot: true });
    const replay = await replayBackground(JSON.stringify(saved.journal), saved.receipt.action.result);
    assert.equal(replay.comparison, 'match');
    assert.deepEqual(await selectBackground(world.journal(), request), noon);
    assert.deepEqual([noon.items.length, later.items.length], [1, 1]);
    assert.match(noon.items[0].subject, /^firms:/);
    assert.equal(later.items[0].subject, 'usgs:synthetic1');
    assert.equal(noon.locationAnchor.facts[0].id, 'location:stop-a:latitude');
    assert.equal(later.locationAnchor.facts[0].id, 'location:stop-b:latitude');
    assert.equal(noon.state[0].source, 'fixture:model-runtime');
    assert.deepEqual(noon.state, later.state);
    function reading(context) {
      const { facts, calendar, ageMs } = context.locationAnchor;
      const { subject, distanceMeters } = context.items[0];
      return { knownAt: new Date(context.request.knownAt), fix: facts.map(f => f.id),
        observedAt: new Date(facts[0].validFrom), receivedAt: new Date(facts[0].recordedAt),
        ageMs, accuracyMeters: facts[2].value, calendar: calendar.civil.schema, subject, distanceMeters };
    }
    console.log(JSON.stringify({ synthetic: true, stateAt: new Date(request.stateAt),
      first: reading(noon), retrospective: reading(later), runtimeSignal: noon.state[0], amlReplay: replay.comparison }, null, 2));
  } finally { await rm(dir, { recursive: true, force: true }); }
}
