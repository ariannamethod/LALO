import test from 'node:test';
import assert from 'node:assert/strict';
import { FactLedger } from '../src/ledger.js';
import { createToolHost } from '../src/tools.js';
import { createBackground } from '../src/background.js';
import { decodeJournal } from '../src/journal.js';
import { createActionReplay } from '../src/action-replay.js';
import { calendarSummary } from '../web/calendar.js';
import { collection, quake, QUAKETIME } from './fixtures/usgs.js';

const tuesday = Date.UTC(2026, 10, 3, 12), thursday = Date.UTC(2026, 10, 5, 12), friday = Date.UTC(2026, 10, 6, 12);
const fact = { subject: 'agent:don-eduardo', predicate: 'observation', validTo: null, source: 'fixture:observer', value: true };
const pair = (host, id, compareToId, knownAt = friday, extra = {}) => host.call('lalo_calendar', { id, compareToId, knownAt, ...extra });

test('Tuesday arrives on Friday, Thursday arrives on Thursday: each ordering names its exact revisions at one cutoff', async () => {
  const world = new FactLedger();
  world.add({ ...fact, id: 'thursday', validFrom: thursday, recordedAt: thursday });
  world.add({ ...fact, id: 'tuesday', validFrom: tuesday, recordedAt: friday });
  world.add({ ...fact, id: 'corrected', validFrom: friday + 1, recordedAt: friday + 1, supersedes: 'tuesday' });
  const host = createToolHost(world);
  const future = await pair(host, 'thursday', 'tuesday', friday - 1);
  assert.equal(future.error.code, 'NOT_FOUND');
  assert.deepEqual(await pair(host, 'thursday', 'absent', friday - 1), future);
  assert.deepEqual(await pair(host, 'tuesday', 'thursday', friday - 1), future);
  const args = { id: 'tuesday', compareToId: 'thursday', knownAt: friday };
  const result = await host.call('lalo_calendar', args), calendar = result.data.calendar;
  const { assertion, occurrence, receipt } = calendar.comparison;
  assert.deepEqual([calendar.assertion.id, assertion.id, assertion.source, assertion.validFrom, assertion.recordedAt],
    ['tuesday', 'thursday', fact.source, thursday, thursday]);
  assert.deepEqual([occurrence.order, occurrence.delta.sign, occurrence.delta.days], [-1, 1, 2]);
  assert.deepEqual([receipt.order, receipt.delta.sign, receipt.delta.days], [1, -1, 1]);
  assert.match(calendarSummary(calendar), /Occurred first: tuesday · Received first: thursday/);
  const reverse = (await pair(host, 'thursday', 'tuesday')).data.calendar.comparison;
  assert.deepEqual([reverse.occurrence.order, reverse.receipt.order], [1, -1]);
  assert.deepEqual((await pair(host, 'tuesday', 'thursday', friday + 1)).data.calendar, calendar);
  const revised = (await pair(host, 'thursday', 'corrected', friday + 1)).data.calendar.comparison;
  assert.equal(revised.assertion.supersedes, 'tuesday');
  assert.deepEqual([revised.occurrence.order, revised.receipt.order], [-1, -1]);
  assert.equal((await createActionReplay(world, { format: 'lalo/action', version: 1,
    call: { name: 'lalo_calendar', arguments: args }, result }).read()).comparison, 'match');
});

test('millisecond boundaries, independent ties, calendar range, personal origin and result budgets', async () => {
  const world = new FactLedger();
  world.add({ ...fact, id: 'a', validFrom: -1, recordedAt: 0 });
  world.add({ ...fact, id: 'b', validFrom: 0, recordedAt: 0 });
  world.add({ ...fact, id: 'c', validFrom: -1, recordedAt: 1 });
  world.add({ ...fact, id: 'outside', validFrom: Number.MIN_SAFE_INTEGER, recordedAt: 2 });
  const host = createToolHost(world);
  const calendar = (await pair(host, 'a', 'b', 2, { originId: 'a' })).data.calendar;
  assert.equal(calendar.perspective.originId, 'a');
  assert.deepEqual([calendar.comparison.occurrence.order, calendar.comparison.occurrence.delta.milliseconds,
    calendar.comparison.receipt.order, calendar.comparison.receipt.delta.sign], [-1, 1, 0, 0]);
  assert.match(calendarSummary(calendar), /Received at the same instant/);
  const sameEvent = (await pair(host, 'a', 'c', 2)).data.calendar.comparison;
  assert.deepEqual([sameEvent.occurrence.order, sameEvent.receipt.order, sameEvent.receipt.delta.milliseconds], [0, -1, 1]);
  const same = (await pair(host, 'a', 'a', 2)).data.calendar.comparison;
  assert.deepEqual([same.occurrence.order, same.receipt.order], [0, 0]);
  assert.equal((await pair(host, 'a', 'outside', 2)).error.code, 'CALENDAR_RANGE');
  assert.equal((await pair(host, 'outside', 'a', 2)).error.code, 'CALENDAR_RANGE');
  assert.equal((await pair(host, 'a', 'b', 2, { chooseOrigin: true })).error.code, 'INVALID_ARGUMENTS');
  assert.equal((await pair(createToolHost(world, { maxResultBytes: 1024 }), 'a', 'b', 2)).error.code, 'RESULT_BUDGET');
  assert.ok(!Object.hasOwn((await host.call('lalo_calendar', { id: 'a', knownAt: 2 })).data.calendar, 'comparison'));
});

test('ingesting a pair read does not assign attention to either operand', async () => {
  const world = await createBackground();
  await world.receive({ kind: 'usgs', receivedAt: QUAKETIME + 2000, feed: collection(quake(), quake({ id: 'second' })) });
  const snapshot = world.journal(), knownAt = QUAKETIME + 2000, updated = QUAKETIME + 1000;
  const args = { id: `usgs:synthetic1:${updated}:magnitude`, compareToId: `usgs:second:${updated}:magnitude`, knownAt };
  const result = await createToolHost(decodeJournal(snapshot)).call('lalo_calendar', args);
  assert.equal(result.ok, true);
  const trace = { format: 'lalo/action', version: 1, status: 'executed', call: { name: 'lalo_calendar', arguments: args }, result };
  assert.equal((await world.receive({ kind: 'action', id: 'pair', agent: fact.subject, receivedAt: knownAt, trace })).receipts, 0);
  assert.equal(world.journal(), snapshot);
});
