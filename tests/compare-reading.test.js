import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolHost } from '../src/tools.js';
import { FactLedger } from '../src/ledger.js';
import { encodeJournal } from '../src/journal.js';
import { RULE, MAGNITUDE_RULE } from '../src/hypothesis.js';
import { lateReports, tuesday, friday, saturday } from './fixtures/late-reports.js';

const query = { subject: 'fixture:crossing', predicate: 'open', rule: RULE, validAt: tuesday, knownAt: friday - 1 };
const head = 'a'.repeat(64);
function ledgerOf(records) {
  const world = new FactLedger();
  for (const fact of records) world.add(fact);
  return world;
}
async function saved(world, args = query) {
  const call = { name: 'lalo_reading', arguments: args };
  const result = await createToolHost(world).call(call.name, args);
  assert.equal(result.ok, true);
  return { journal: JSON.parse(encodeJournal(world)), receipt: { sequence: 2, head, snapshot: { sha256: 'b'.repeat(64) },
    action: { format: 'lalo/action', version: 1, status: 'executed', call, result } } };
}
function comparison(current, restored, options = {}) {
  const host = createToolHost(current, { ...options, recall: async selected => {
    assert.deepEqual(selected, { sequence: 2, head, snapshot: true });
    return restored;
  } });
  return (args = {}) => host.call('lalo_compare_reading', { sequence: 2, head, knownAt: saturday, ...args });
}

test('saved Thursday answer sees Friday reversal and Saturday return on its original world instant', async () => {
  const now = lateReports(), before = ledgerOf(now.entries().slice(0, 1));
  const restored = await saved(before), original = structuredClone(restored), compare = comparison(now, restored);
  const { data } = await compare();
  assert.deepEqual(data.savedReading, restored.receipt.action.result.data.reading);
  assert.equal(data.reading.knownAt, saturday); assert.equal(data.reading.validAt, tuesday);
  assert.deepEqual([data.comparison.sameVerdict, data.comparison.samePremises, data.comparison.verdictChanges], [true, false, 2]);
  assert.deepEqual(data.items.map(r => [r.origin, r.state, r.fact.id, r.fact.supersedes]), [
    ['appended', 'contradicted', 'correction', 'original'], ['appended', 'supported', 'saturday-update', 'correction']]);
  const rewind = (await compare({ knownAt: friday })).data;
  assert.equal(rewind.comparison.sameVerdict, false);
  assert.deepEqual(rewind.items.map(r => r.fact.id), ['correction']);
  assert.deepEqual(restored, original);
  assert.equal((await compare({ knownAt: friday - 2 })).error.code, 'INVALID_ARGUMENTS');
});

test('fixed snapshot distinguishes previously masked receipts from new arrivals and ignores old page offsets', async () => {
  const now = lateReports(), before = ledgerOf(now.entries().slice(0, 3));
  const restored = await saved(before, { ...query, sinceKnownAt: tuesday, offset: 1, limit: 1 });
  assert.deepEqual(restored.receipt.action.result.data.items, []);
  const compare = comparison(now, restored);
  const first = (await compare({ limit: 1 })).data, next = (await compare({ limit: 1, offset: first.nextOffset })).data;
  assert.deepEqual([first.items[0].origin, next.items[0].origin], ['saved_snapshot', 'appended']);
  assert.equal(first.items[0].fact.id, 'correction'); assert.equal(next.items[0].fact.id, 'saturday-update');
  assert.equal(next.nextOffset, null); assert.deepEqual(first.comparison, next.comparison);
});

test('new receipts at or before the saved cutoff retain their actual timestamps and one atomic state per batch', async () => {
  const [base] = lateReports().entries();
  const before = ledgerOf([base]), now = ledgerOf([base]);
  now.add({ ...base, id: 'peer-no', value: false });
  now.add({ ...base, id: 'peer-yes', source: 'fixture:other' });
  for (const knownAt of [base.recordedAt, saturday]) {
    const compare = comparison(now, await saved(before, { ...query, knownAt }));
    const { data } = await compare({ knownAt });
    assert.equal(data.timeline.changeCount, 1); assert.equal(data.comparison.verdictChanges, 1);
    assert.deepEqual(data.items.map(r => [r.step, r.knownAt, r.previousState, r.state, r.fact.id]), [
      [1, base.recordedAt, 'supported', 'contested', 'peer-no'], [1, base.recordedAt, 'supported', 'contested', 'peer-yes']]);
  }
});

test('independent corroboration, no change, and restored original evidence remain distinguishable', async () => {
  const [base] = lateReports().entries(), before = ledgerOf([base]), now = ledgerOf([base]), restored = await saved(before);
  const unchanged = (await comparison(now, restored)()).data;
  assert.equal(unchanged.comparison.samePremises, true); assert.equal(unchanged.timeline.changeCount, 0);
  now.add({ ...base, id: 'other', recordedAt: friday });
  const corroborated = (await comparison(now, restored)()).data;
  assert.equal(corroborated.comparison.samePremises, false); assert.equal(corroborated.comparison.verdictChanges, 0);
  assert.equal(corroborated.items[0].kind, 'evidence');
  now.add({ ...base, id: 'withdrawal', supersedes: 'other', validFrom: saturday, recordedAt: saturday });
  const withdrawn = (await comparison(now, restored)()).data;
  assert.equal(withdrawn.timeline.changeCount, 2); assert.equal(withdrawn.comparison.samePremises, true);
  assert.equal(withdrawn.items[1].role, null); assert.equal(withdrawn.items[1].removedRole, 'supporting');
});

test('magnitude comparison retains the stored threshold and names the displaced unknown premise', async () => {
  const [base] = lateReports().entries(), old = { ...base, predicate: 'magnitude', value: null };
  const original = ledgerOf([old]), now = ledgerOf([old]);
  now.add({ ...old, id: 'measured', value: 3.5, supersedes: old.id, recordedAt: friday });
  const compare = comparison(now, await saved(original, { ...query, predicate: 'magnitude', rule: MAGNITUDE_RULE, threshold: 4 }));
  const { data } = await compare();
  assert.equal(data.savedReading.state, 'unsettled'); assert.equal(data.reading.state, 'contradicted');
  assert.equal(data.reading.threshold, 4); assert.equal(data.items[0].removedRole, 'unknown');
  assert.equal((await compare({ threshold: 3 })).error.code, 'INVALID_ARGUMENTS');
});

test('comparison rejects a shortened world, a rewritten source, an unreproduced answer and unsupported actions', async () => {
  const rows = lateReports().entries(), before = ledgerOf(rows.slice(0, 2)), restored = await saved(before);
  for (const world of [ledgerOf(rows.slice(0, 1)), ledgerOf([rows[0], { ...rows[1], source: 'different' }])])
    assert.equal((await comparison(world, restored)()).error.code, 'WORLD_DIVERGED');
  restored.receipt.action.result.data.reading.state = 'contested';
  assert.equal((await comparison(before, restored)()).error.code, 'SAVED_READING_CHANGED');
  restored.receipt.action.call.name = 'lalo_history';
  assert.equal((await comparison(before, restored)()).error.code, 'NOT_A_READING');
  assert.equal((await createToolHost(before).call('lalo_compare_reading', {})).error.code, 'UNKNOWN_TOOL');
});

test('comparison clips by bytes without dropping peer receipts or changing their shared verdict', async () => {
  const [base] = lateReports().entries(), before = ledgerOf([base]), now = ledgerOf([base]);
  for (let i = 0; i < 12; i++) now.add({ ...base, id: 'peer-' + i, value: false, recordedAt: friday, source: 'x'.repeat(830) });
  const compare = comparison(now, await saved(before), { maxResultBytes: 4096 });
  const ids = [];
  let offset = 0;
  do {
    const result = await compare({ offset });
    assert.ok(result.ok); assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 4096);
    assert.equal(result.data.comparison.verdictChanges, 1);
    assert.ok(result.data.items.every(row => row.step === 1 && row.state === 'contested'));
    ids.push(...result.data.items.map(row => row.fact.id));
    offset = result.data.nextOffset;
  } while (offset !== null);
  assert.deepEqual(ids, now.entries().slice(1).map(f => f.id));
});
