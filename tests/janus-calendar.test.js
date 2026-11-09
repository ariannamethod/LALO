import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FactLedger } from '../src/ledger.js';
import { decodeJournal, encodeJournal } from '../src/journal.js';
import { createToolHost } from '../src/tools.js';
import { createActionReplay } from '../src/action-replay.js';
import { createBackground } from '../src/background.js';
import { selectBackground, replayBackground } from '../src/background-context.js';
import { quake, collection, QUAKETIME } from './fixtures/usgs.js';

const epoch = Date.UTC(2024, 9, 3, 12);
const base = { subject: 'fixture:crossing', predicate: 'open', source: 'fixture:observation', value: true, validTo: null };
const calendarCall = (host, id, knownAt, extra) => host.call('lalo_calendar', { id, knownAt, ...extra });

test('JANUS noon, civil midnight and the two millisecond clocks refer to the named revision', async () => {
  const world = new FactLedger();
  world.add({ ...base, id: 'old', validFrom: epoch - 1, recordedAt: epoch + 2 });
  world.add({ ...base, id: 'new', supersedes: 'old', validFrom: epoch, validTo: epoch + 1, recordedAt: epoch + 3 });
  const snapshot = encodeJournal(world), host = createToolHost(world);
  const old = (await calendarCall(host, 'old', epoch + 2)).data.calendar;
  const revised = (await calendarCall(host, 'new', epoch + 3, { originId: 'old' })).data.calendar;
  assert.deepEqual(old.assertion, { id: 'old', subject: base.subject, predicate: base.predicate, source: base.source, supersedes: null,
    validFrom: epoch - 1, validTo: null, recordedAt: epoch + 2 });
  assert.deepEqual([old.civil.utc_civil_day, old.civil.epoch_day, revised.civil.utc_civil_day, revised.civil.epoch_day], [0, -1, 0, 0]);
  assert.deepEqual([old.civil.hebrew_year, old.civil.hebrew_month, old.civil.hebrew_day], [5785, 7, 1]);
  assert.equal(old.civil.calendar_model, 'hebrew.dr/1');
  assert.equal(old.civil.drift_model, 'metonic.legacy-trunc/1');
  assert.equal(old.perspective, null);
  assert.deepEqual([old.occurred.millisecond, old.known.millisecond, old.lag.milliseconds], [999, 2, 3]);
  assert.match(old.wasmSha256, /^[a-f0-9]{64}$/);
  assert.equal(revised.assertion.supersedes, 'old');
  assert.equal(revised.assertion.validTo, epoch + 1);
  assert.equal(revised.perspective.coordinates.age_days, 0);
  assert.equal(revised.perspective.originId, 'old');
  const future = await calendarCall(host, 'new', epoch + 2);
  assert.equal(future.error.code, 'NOT_FOUND');
  assert.deepEqual(await calendarCall(host, 'old', epoch + 2, { originId: 'new' }), future);
  assert.deepEqual(await calendarCall(host, 'absent', epoch + 2), future);
  assert.equal(encodeJournal(world), snapshot);
});

test('a future occurrence has a signed lag; independent origin receipts give different perspectives', async () => {
  const world = new FactLedger();
  world.add({ ...base, id: 'first', validFrom: -86400000, recordedAt: -2 });
  world.add({ ...base, id: 'second', validFrom: 0, recordedAt: -1 });
  const host = createToolHost(world);
  const [a, b] = await Promise.all(['first', 'second'].map(originId => calendarCall(host, 'second', -1, { originId })));
  const { known, occurred, lag } = a.data.calendar;
  assert.deepEqual([known.unix_day, known.second, known.millisecond], [-1, 86399, 999]);
  assert.deepEqual([occurred.unix_day, occurred.second, occurred.millisecond], [0, 0, 0]);
  assert.deepEqual([lag.sign, lag.days, lag.seconds, lag.milliseconds], [-1, 0, 0, 1]);
  assert.deepEqual([a.data.calendar.perspective.coordinates.age_days, b.data.calendar.perspective.coordinates.age_days], [1, 0]);
  const action = { format: 'lalo/action', version: 1, call: { name: 'lalo_calendar',
    arguments: { id: 'second', knownAt: -1, originId: 'first' } }, result: a };
  assert.equal((await createActionReplay(world, action).read()).comparison, 'match');
  assert.equal((await calendarCall(createToolHost(world, { maxResultBytes: 1024 }), 'second', -1, { originId: 'first' })).error.code, 'RESULT_BUDGET');
});

test('calendar domain failure preserves a valid ledger receipt and its background evidence', async () => {
  const world = await createBackground();
  const at = Date.UTC(10000, 0, 1);
  await world.receive({ kind: 'usgs', receivedAt: at + 2, feed: collection(quake({ time: at, updated: at + 1 })) });
  const request = { agent: 'agent:don-eduardo', knownAt: at + 2, stateAt: at, worldFrom: at, worldTo: at + 1 };
  const { items } = await selectBackground(world.journal(), request);
  assert.equal(items[0].calendar.error.code, 'CALENDAR_RANGE');
  assert.equal(items[0].calendar.assertion.id, items[0].facts[0].id);
  assert.equal(items[0].facts.length, 8);
});

test('Don rewinds a revised occurrence, and the pre-calendar v2 world still reproduces its saved context', async () => {
  const saved = JSON.parse(await readFile(new URL('./fixtures/background-v2.json', import.meta.url), 'utf8'));
  const world = await createBackground();
  const t = QUAKETIME;
  await world.receive({ kind: 'usgs', receivedAt: t + 2000, feed: collection(quake()) });
  await world.receive({ kind: 'signal', fact: saved.state[0] });
  await world.receive({ kind: 'location', id: 'fixture1', receivedAt: t + 3000,
    position: { timestamp: t + 50, coords: { latitude: 12.5, longitude: -34.25, accuracy: 7 } } });
  assert.equal((await replayBackground(world.journal(), saved)).comparison, 'match');
  await world.receive({ kind: 'usgs', receivedAt: t + 5000, feed: collection(quake({ time: t + 1, updated: t + 4000 })) });
  const request = { ...saved.request, originId: saved.state[0].id };
  const past = await selectBackground(world.journal(), request);
  const current = await selectBackground(world.journal(), { ...request, knownAt: t + 5000 });
  assert.equal(past.version, 6);
  const before = past.items[0].calendar, after = current.items[0].calendar;
  assert.equal(before.assertion.id, past.items[0].facts[0].id);
  assert.equal(after.assertion.supersedes, before.assertion.id);
  assert.deepEqual([before.occurred.millisecond, after.occurred.millisecond], [0, 1]);
  assert.equal(before.perspective.originId, saved.state[0].id);
  assert.equal((await replayBackground(world.journal(), past)).comparison, 'match');
  await assert.rejects(selectBackground(world.journal(), { ...request, knownAt: t + 2000 }), { code: 'NOT_FOUND' });
  const truncated = await selectBackground(world.journal(), { ...request, maxBytes: 1024 });
  assert.equal(truncated.items.length, 0);
  assert.ok(truncated.limitedBy.includes('maxBytes'));
  assert.ok(Buffer.byteLength(JSON.stringify(truncated)) <= 1024);
  const args = { id: after.assertion.id, knownAt: t + 5000 };
  const trace = { format: 'lalo/action', version: 1, status: 'executed', call: { name: 'lalo_calendar', arguments: args },
    result: await createToolHost(decodeJournal(world.journal())).call('lalo_calendar', args) };
  const frame = { kind: 'action', agent: request.agent, id: 'don:calendar:1', receivedAt: t + 6000, trace };
  assert.equal((await world.receive(frame)).signal, frame.id);
  assert.equal(decodeJournal(world.journal()).lineage(frame.id).at(-1).value, after.assertion.subject);
  assert.equal((await world.receive({ ...frame, trace: { ...trace, result: { ok: false } } })).receipts, 0);
});
