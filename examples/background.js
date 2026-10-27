// Reproducible, synthetic observations. Network is never used.
import assert from 'node:assert/strict';
import { createBackground } from '../src/background.js';
import { selectBackground, replayBackground } from '../src/background-context.js';
import { collection, quake, QUAKETIME as t } from '../tests/fixtures/usgs.js';

const frames = [
  { kind: 'usgs', receivedAt: t + 2000, feed: collection(quake()) },
  { kind: 'signal', fact: { id: 'don:attention:1', subject: 'agent:don-eduardo', predicate: 'attention_subject',
    value: 'usgs:synthetic1', source: 'fixture:explicit-agent-action',
    validFrom: t + 2000, validTo: null, recordedAt: t + 3000 } },
  { kind: 'location', id: 'fixture1', receivedAt: t + 3000,
    position: { timestamp: t + 50, coords: { latitude: 12.5, longitude: -34.25, accuracy: 7 } } },
];
const correction = { kind: 'usgs', receivedAt: t + 5000, feed: collection(quake({ mag: 3.4, updated: t + 4000, time: t + 1 })) };
const request = { agent: 'agent:don-eduardo', knownAt: t + 3000, stateAt: t + 3000,
  worldFrom: t, worldTo: t + 100, maxEvents: 1 };
if (process.argv[2] === '--request') {
  console.log(JSON.stringify(request));
  process.exit(0);
}
if (process.argv[2] === '--frames') {
  for (const frame of [...frames, correction]) console.log(JSON.stringify(frame));
  process.exit(0);
}
const background = await createBackground();
for (const frame of frames) await background.receive(frame);
const originalWorld = background.journal();
const original = await selectBackground(originalWorld, request);
await background.receive(correction);
const current = await selectBackground(background.journal(), { ...request, knownAt: t + 5000 });
const replay = await replayBackground(originalWorld, original);
assert.equal(original.items[0].facts[0].value, 2.9);
assert.equal(original.otherInstruments.location, 1);
assert.equal(current.items[0].facts[0].value, 3.4);
assert.equal(replay.comparison, 'match');
console.log(JSON.stringify({ synthetic: true, original, current, replay: replay.comparison }, null, 2));
