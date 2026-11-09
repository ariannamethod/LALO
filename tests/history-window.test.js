import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolHost } from '../src/tools.js';
import { FactLedger } from '../src/ledger.js';
import { tuesday, friday, saturday, fridayQuery, lateReports } from './fixtures/late-reports.js';

const history = (host, query) => host.call('lalo_history', query);
const ids = result => result.data.items.map(f => f.id);

test('Friday finds a correction to Tuesday without an ID; Thursday still knows the original', async () => {
  const host = createToolHost(lateReports());
  const full = await history(host, fridayQuery);
  assert.deepEqual(ids(full), ['correction', 'other-report']);
  const correction = full.data.items[0];
  assert.deepEqual([correction.supersedes, correction.validFrom, correction.recordedAt, correction.source, correction.value],
    ['original', tuesday, friday, 'fixture:observer', false]);
  assert.equal(full.data.window.api, 'janus.calendar/1');
  assert.match(full.data.window.wasmSha256, /^[0-9a-f]{64}$/);
  assert.equal(full.data.window.occurredBefore, friday);
  assert.deepEqual(ids(await history(host, { ...fridayQuery, knownAt: friday - 1 })), []);
  assert.deepEqual(ids(await history(host, { knownAt: friday - 1, occurredBefore: friday })), ['original']);
  assert.deepEqual(ids(await history(host, { ...fridayQuery, knownAt: friday })), ['correction']);
  assert.deepEqual(ids(await history(host, { ...fridayQuery, subject: 'fixture:road', source: 'fixture:witness', predicate: 'open' })), ['other-report']);
  assert.deepEqual(ids(await history(host, { ...fridayQuery, predicate: 'different' })), []);
});

test('open bounds, equal endpoints, one-millisecond edges and offset count only matching rows', async () => {
  const host = createToolHost(lateReports());
  const read = args => history(host, { knownAt: saturday, ...args });
  assert.deepEqual(ids(await read({ receivedFrom: saturday })), ['saturday-update']);
  assert.deepEqual(ids(await read({ receivedTo: friday })), ['original']);
  assert.deepEqual(ids(await read({ occurredBefore: tuesday })), []);
  assert.deepEqual(ids(await read({ receivedFrom: friday, receivedTo: friday })), []);
  assert.deepEqual(ids(await read({ receivedFrom: friday, receivedTo: friday + 1 })), ['correction', 'friday-event']);
  const page = await read({ ...fridayQuery, limit: 1 });
  assert.deepEqual([ids(page), page.data.total, page.data.nextOffset, page.data.complete], [['correction'], 2, 1, false]);
  const last = await read({ ...fridayQuery, limit: 1, offset: page.data.nextOffset });
  assert.deepEqual([ids(last), last.data.nextOffset, last.data.complete], [['other-report'], null, true]);
  assert.deepEqual(last.data.window, page.data.window);
  assert.equal((await read({ ...fridayQuery, offset: 3 })).error.code, 'INVALID_ARGUMENTS');
  assert.equal((await read({ receivedFrom: saturday, receivedTo: friday })).error.code, 'INVALID_ARGUMENTS');
  for (const field of ['receivedFrom', 'receivedTo', 'occurredBefore']) {
    assert.equal((await read({ [field]: '0' })).error.code, 'INVALID_ARGUMENTS');
    assert.equal((await read({ [field]: Number.MAX_SAFE_INTEGER, source: 'fixture:missing' })).error.code, 'CALENDAR_RANGE');
  }
});

test('JANUS checks only the relevant clock in known candidate rows; plain history retains its synchronous response', async () => {
  const world = new FactLedger(), fact = { subject: 'fixture:a', predicate: 'note', value: 1, source: 'fixture:good', validTo: null };
  world.add({ ...fact, id: 'zero', validFrom: -1, recordedAt: 0 });
  world.add({ ...fact, id: 'bad-date', source: 'fixture:outside', validFrom: Number.MIN_SAFE_INTEGER, recordedAt: 1 });
  const host = createToolHost(world);
  const plain = history(host, { knownAt: 1 });
  assert.equal(plain instanceof Promise, false);
  assert.equal(Object.hasOwn(plain.data, 'window'), false);
  assert.deepEqual(ids(plain), ['zero', 'bad-date']);
  assert.deepEqual(ids(await history(host, { knownAt: 1, receivedFrom: 0 })), ['zero', 'bad-date']);
  for (const query of [{ knownAt: 0 }, { knownAt: 1, receivedTo: 1 }, { knownAt: 1, source: 'fixture:good' }])
    assert.deepEqual(ids(await history(host, { ...query, occurredBefore: 0 })), ['zero']);
  assert.equal((await history(host, { knownAt: 1, occurredBefore: 0 })).error.code, 'CALENDAR_RANGE');
});

test('byte-limited history advances by whole matching receipts and reports an oversized row', async () => {
  const world = new FactLedger();
  const fact = { subject: 'fixture:a', predicate: 'note', source: 'fixture:good', validFrom: 1, validTo: null, recordedAt: 3 };
  for (const [id, value] of [['a', 'é'.repeat(200)], ['b', 'é'.repeat(200)], ['c', 'é'.repeat(800)]])
    world.add({ ...fact, id, value });
  const host = createToolHost(world, { maxResultBytes: 1024 }), args = { knownAt: 3, occurredBefore: 2 };
  const first = await history(host, args), second = await history(host, { ...args, offset: first.data.nextOffset });
  assert.deepEqual([ids(first), first.data.total, first.data.nextOffset], [['a'], 3, 1]);
  assert.deepEqual([ids(second), second.data.nextOffset], [['b'], 2]);
  assert.equal((await history(host, { ...args, offset: second.data.nextOffset })).error.code, 'RESULT_BUDGET');
});
