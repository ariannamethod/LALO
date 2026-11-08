import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBackground } from '../src/background.js';
import { selectBackground, replayBackground } from '../src/background-context.js';
import { decodeJournal } from '../src/journal.js';
import { calendarSummary } from '../web/calendar.js';
import { createToolHost } from '../src/tools.js';
import { quake, collection } from './fixtures/usgs.js';

const monday = Date.UTC(2026, 10, 2, 12), day = 86_400_000;
const wednesday = monday + 2 * day, thursday = monday + 3 * day, friday = monday + 4 * day;
const don = 'agent:don-eduardo', other = 'agent:other';
const origin = 'fixture:monday', event = `usgs:synthetic1:${wednesday}:magnitude`;
const request = { agent: don, knownAt: friday, stateAt: friday, worldFrom: wednesday, worldTo: wednesday + 1 };
async function fixture() {
  const world = await createBackground();
  await world.receive({ kind: 'signal', fact: { id: origin, value: 'started', subject: don, predicate: 'note',
    source: 'fixture:diary', validFrom: monday, validTo: null, recordedAt: monday } });
  await world.receive({ kind: 'usgs', receivedAt: wednesday, feed: collection(quake({ time: wednesday, updated: wednesday })) });
  return world;
}
const read = (world, args = {}) => createToolHost(decodeJournal(world.journal()))
  .call('lalo_calendar', { id: event, knownAt: friday, ...args });
async function proposal(world, agent = don, anchor = origin, id = 'don:chose') {
  const args = { id: anchor, knownAt: thursday, agent, chooseOrigin: true };
  const result = await read(world, args);
  assert.equal(result.ok, true);
  return { kind: 'action', id, agent, receivedAt: thursday, trace: { format: 'lalo/action', version: 1,
    status: 'executed', call: { name: 'lalo_calendar', arguments: args }, result } };
}

test('Thursday’s choice survives restart; Wednesday cannot see it; another agent and a one-read override stay independent', async () => {
  const world = await fixture(), before = world.journal();
  const action = await proposal(world);
  assert.equal(world.journal(), before);
  assert.equal((await read(world)).data.calendar.perspective, null);
  await world.receive(action);
  const restored = await createBackground(world.journal());
  const calendar = (await read(restored)).data.calendar;
  assert.equal(calendar.perspective.originId, origin);
  assert.equal(calendar.perspective.coordinates.age_days, 2);
  assert.match(calendarSummary(calendar), /2 calendar days from fixture:monday · chosen by agent:don-eduardo/);
  assert.deepEqual(calendar.originChoice, decodeJournal(restored.journal()).lineage(action.id)[0]);
  const compared = (await read(restored, { compareToId: origin })).data.calendar;
  assert.deepEqual(compared.originChoice, calendar.originChoice);
  assert.equal(compared.comparison.occurrence.order, 1);
  assert.equal(calendar.originChoice.validFrom, thursday);
  assert.equal(calendar.originChoice.recordedAt, thursday);
  assert.equal((await read(restored, { knownAt: thursday - 1 })).data.calendar.perspective, null);
  assert.deepEqual((await read(restored, { knownAt: thursday })).data.calendar, calendar);
  assert.equal((await read(restored, { agent: other })).data.calendar.perspective, null);
  assert.equal((await read(restored, { originId: event })).data.calendar.perspective.coordinates.age_days, 0);
  assert.equal((await read(restored, { id: origin, chooseOrigin: true })).error.code, 'ORIGIN_ALREADY_SET');
  assert.equal((await read(restored, { chooseOrigin: true, originId: event })).error.code, 'INVALID_ARGUMENTS');

  const project = async extra => (await selectBackground(restored.journal(), { ...request, ...extra })).items[0].calendar;
  assert.deepEqual(await project({ maxSignals: 0 }), calendar);
  const withChoice = await selectBackground(restored.journal(), { ...request, maxSignals: 0 });
  const maxBytes = Buffer.byteLength(JSON.stringify(withChoice)) - 64;
  const limited = await selectBackground(restored.journal(), { ...request, maxBytes, maxSignals: 0 });
  assert.equal(limited.items.length, 0);
  assert.ok(limited.limitedBy.includes('maxBytes'));
  assert.ok(Buffer.byteLength(JSON.stringify(limited)) <= maxBytes);
  for (const cutoff of [{ stateAt: wednesday }, { knownAt: wednesday }, { agent: other }])
    assert.equal((await project(cutoff)).perspective, null);
  await restored.receive(await proposal(restored, other, event, 'other:chose'));
  assert.equal((await read(restored, { agent: other })).data.calendar.perspective.coordinates.age_days, 0);
  assert.deepEqual((await read(restored)).data.calendar, calendar);
  // A later correction changes the original assertion's lineage, not the recorded anchor revision.
  const anchor = decodeJournal(restored.journal()).lineage(origin)[0];
  await restored.receive({ kind: 'signal', fact: { ...anchor, id: 'fixture:revised', validFrom: wednesday,
    recordedAt: friday, supersedes: origin } });
  assert.deepEqual((await read(restored)).data.calendar, calendar);
  assert.equal((await restored.receive(action)).receipts, 0);
});

test('one concurrent choice wins; wrong agent, future cutoff, forged result and malformed imported history are rejected', async () => {
  const world = await fixture(), before = world.journal();
  const a = await proposal(world), b = await proposal(world, don, event, 'don:other-choice');
  for (const edit of [f => { f.agent = other; }, f => { f.receivedAt--; }, f => { f.trace.result.data.originProposal.originId = event; },
    f => { f.trace.result.data.calendar.assertion.source = 'fixture:other'; }, f => { f.trace.result.data.calendar.perspective.coordinates.age_days = 5; }]) {
    const bad = structuredClone(a); edit(bad);
    await assert.rejects(world.receive(bad), /differs/);
    assert.equal(world.journal(), before);
  }
  const attempts = await Promise.allSettled([world.receive(a), world.receive(b)]);
  assert.deepEqual(attempts.map(r => r.status), ['fulfilled', 'rejected']);
  const saved = world.journal(), data = JSON.parse(saved), choice = data.records.at(-1);
  await assert.rejects(world.receive({ kind: 'signal', fact: choice }), /executed calendar action/);
  assert.equal(world.journal(), saved);
  for (const change of [records => { records.at(-1).value = 'unknown'; }, records => { records.at(-1).validFrom = monday; },
    records => { records[0].validFrom = Date.UTC(10000, 0, 1); },
    records => { records.push({ ...choice, id: 'again' }); },
    records => { records.push({ ...choice, id: 'undo', source: 'fixture:other', supersedes: choice.id, recordedAt: friday }); }]) {
    const copy = structuredClone(data); change(copy.records);
    await assert.rejects(createBackground(JSON.stringify(copy)), /calendar origin/);
  }
});

test('saved v3 and v4 contexts replay under the policy that produced them', async () => {
  const world = await fixture();
  // Captured from the v3 selector at f79272a on the same synthetic world.
  const v3 = JSON.parse(await readFile(new URL('./fixtures/background-v3.json', import.meta.url), 'utf8'));
  const archived = await replayBackground(world.journal(), v3);
  const originalDigest = v3.items[0].calendar.wasmSha256;
  const currentDigest = archived.result.items[0].calendar.wasmSha256;
  assert.match(currentDigest, /^[a-f0-9]{64}$/);
  assert.equal(archived.comparison, currentDigest === originalDigest ? 'match' : 'changed');
  const expected = structuredClone(v3);
  expected.items[0].calendar.wasmSha256 = currentDigest;
  assert.deepEqual(archived.result, expected);
  await world.receive(await proposal(world));
  const legacy = await replayBackground(world.journal(), v3);
  assert.equal(legacy.result.items[0].calendar.perspective, null);
  const v4 = await selectBackground(world.journal(), request);
  assert.equal(v4.items[0].calendar.perspective.coordinates.age_days, 2);
  assert.equal((await replayBackground(world.journal(), v4)).comparison, 'match');
});
