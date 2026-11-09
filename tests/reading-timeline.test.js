import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolHost } from '../src/tools.js';
import { FactLedger } from '../src/ledger.js';
import { RULE, MAGNITUDE_RULE } from '../src/hypothesis.js';
import { lateReports, tuesday, friday, saturday } from './fixtures/late-reports.js';

const query = { subject: 'fixture:crossing', predicate: 'open', rule: RULE, validAt: tuesday,
  sinceKnownAt: friday - 1, knownAt: saturday };
const read = (host, args = {}) => host.call('lalo_reading', { ...query, ...args });
const fixture = { subject: query.subject, predicate: query.predicate, validFrom: tuesday, validTo: null,
  value: true, recordedAt: friday, source: 'fixture:observer' };

test('one Tuesday reading follows Thursday, Friday and Saturday, retaining causes and source clocks', async () => {
  const host = createToolHost(lateReports());
  const { items, timeline, reading } = (await read(host)).data;
  assert.deepEqual(items.map(r => [r.knownAt, r.state, r.fact.id, r.fact.supersedes]), [
    [friday - 1, 'supported', 'original', null], [friday, 'contradicted', 'correction', 'original'],
    [saturday, 'supported', 'saturday-update', 'correction']]);
  assert.deepEqual(items.map(r => [r.kind, r.role, r.removedRole]), [
    ['baseline', 'supporting', undefined], ['verdict', 'opposing', 'supporting'], ['verdict', 'supporting', 'opposing']]);
  assert.equal(timeline.changeCount, 2); assert.equal(timeline.baselineState, 'supported');
  assert.match(timeline.wasmSha256, /^[0-9a-f]{64}$/);
  assert.ok(items.every(r => r.fact.validFrom === tuesday && r.fact.source === 'fixture:observer'));
  const { sinceKnownAt, ...plain } = query;
  assert.deepEqual(host.call('lalo_reading', plain).data.reading, reading);
  const rewind = (await read(host, { knownAt: friday })).data;
  assert.deepEqual(rewind.items.map(r => r.fact.id), ['original', 'correction']);
  assert.equal(rewind.reading.state, 'contradicted');
  assert.deepEqual((await read(host, { expected: false })).data.items.map(r => r.state), ['contradicted', 'supported', 'contradicted']);
});

test('same-millisecond independent arrivals share one verdict even across pages', async () => {
  const world = new FactLedger();
  world.add({ ...fixture, id: 'yes' });
  world.add({ ...fixture, id: 'no', value: false, source: 'fixture:other' });
  world.add({ ...fixture, id: 'another', recordedAt: friday + 1, source: 'fixture:third' });
  const host = createToolHost(world);
  const { items, timeline } = (await read(host)).data;
  assert.equal(timeline.baselineState, 'unsettled'); assert.equal(timeline.changeCount, 2);
  assert.deepEqual(items.map(r => [r.step, r.kind, r.previousState, r.state]), [
    [1, 'verdict', 'unsettled', 'contested'], [1, 'verdict', 'unsettled', 'contested'],
    [2, 'evidence', 'contested', 'contested']]);
  const paged = [];
  let offset = 0;
  do {
    const data = (await read(host, { offset, limit: 1 })).data;
    assert.deepEqual(data.timeline, timeline); paged.push(...data.items); offset = data.nextOffset;
  } while (offset !== null);
  assert.deepEqual(paged, items);
});

test('correction that moves the event off Tuesday identifies the receipt that withdrew its premise', async () => {
  const world = new FactLedger();
  world.add({ ...fixture, id: 'old', recordedAt: friday - 1 });
  world.add({ ...fixture, id: 'move', supersedes: 'old', validFrom: friday });
  world.add({ ...fixture, id: 'outside', validFrom: friday, recordedAt: saturday });
  const { items, timeline, reading } = (await read(createToolHost(world))).data;
  assert.equal(timeline.changeCount, 1); assert.equal(reading.knownAt, saturday);
  assert.equal(reading.state, 'unsettled'); assert.equal(reading.premiseCount, 0);
  assert.deepEqual(items.map(r => r.fact.id), ['old', 'move']);
  assert.equal(items[1].role, null); assert.equal(items[1].removedRole, 'supporting');
  assert.equal(items[1].fact.supersedes, 'old');
});

test('magnitude reading preserves the threshold, unknown role and independent corroboration', async () => {
  const world = new FactLedger(), f = { ...fixture, predicate: 'magnitude' };
  world.add({ ...f, id: 'missing', value: null, recordedAt: friday - 1 });
  world.add({ ...f, id: 'measured', value: 4.5, supersedes: 'missing' });
  world.add({ ...f, id: 'also', value: 5, recordedAt: saturday, source: 'fixture:other' });
  const host = createToolHost(world);
  const { items, reading } = (await read(host, { predicate: 'magnitude', rule: MAGNITUDE_RULE, threshold: 4.5 })).data;
  assert.deepEqual(items.map(r => [r.kind, r.role, r.state]), [
    ['baseline', 'unknown', 'unsettled'], ['verdict', 'supporting', 'supported'], ['evidence', 'supporting', 'supported']]);
  assert.equal(items[1].removedRole, 'unknown'); assert.equal(reading.threshold, 4.5);
  assert.deepEqual(reading.counts, { supporting: 2, opposing: 0, unknown: 0 });
});

test('equal cutoffs, empty baseline, calendar limits and invalid intermediate premises', async () => {
  const host = createToolHost(lateReports());
  const equal = (await read(host, { sinceKnownAt: friday, knownAt: friday })).data;
  assert.equal(equal.timeline.changeCount, 0); assert.deepEqual(equal.items.map(r => r.fact.id), ['correction']);
  const empty = (await read(host, { sinceKnownAt: tuesday, knownAt: tuesday })).data;
  assert.deepEqual(empty.items, []); assert.equal(empty.timeline.baselineState, 'unsettled');
  assert.equal((await read(host, { sinceKnownAt: saturday + 1 })).error.code, 'INVALID_ARGUMENTS');
  for (const args of [{ sinceKnownAt: Number.MIN_SAFE_INTEGER }, { knownAt: Number.MAX_SAFE_INTEGER }])
    assert.equal((await read(host, args)).error.code, 'CALENDAR_RANGE');
  const world = new FactLedger();
  world.add({ ...fixture, id: 'bad', value: 10 }); world.add({ ...fixture, id: 'fixed', supersedes: 'bad', recordedAt: saturday });
  assert.equal((await read(createToolHost(world))).error.code, 'INVALID_PREMISES');
  assert.equal((await read(createToolHost(world), { sinceKnownAt: saturday })).data.reading.state, 'supported');
});

test('byte-limited pages preserve every receipt from one large atomic change', async () => {
  const world = new FactLedger();
  for (let n = 0; n < 90; n++) world.add({ ...fixture, id: 'witness-' + n, source: 'fixture:' + 'x'.repeat(800) });
  const host = createToolHost(world, { maxResultBytes: 4096 });
  const ids = [];
  let offset = 0;
  do {
    const result = await read(host, { offset, limit: 64 });
    assert.ok(result.ok); assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 4096);
    assert.equal(result.data.timeline.changeCount, 1); assert.equal(result.data.reading.premiseCount, 90);
    assert.ok(result.data.items.every(r => r.step === 1 && r.state === 'supported'));
    ids.push(...result.data.items.map(r => r.fact.id)); offset = result.data.nextOffset;
  } while (offset !== null);
  assert.deepEqual(ids, world.entries().map(f => f.id));
  assert.equal((await read(createToolHost(world, { maxResultBytes: 1024 }))).error.code, 'RESULT_BUDGET');
});
