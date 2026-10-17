import test from 'node:test';
import assert from 'node:assert/strict';
import { FactLedger } from '../src/ledger.js';
import { createToolHost } from '../src/tools.js';
import { createActionReplay } from '../src/action-replay.js';

function fixture() {
  const world = new FactLedger();
  const base = { subject: 'переправа:север', predicate: 'open', validFrom: 1792268765001, validTo: null, recordedAt: 1792268765123 };
  world.add({ ...base, id: 'a', source: 'fixture:a', value: true });
  world.add({ ...base, id: 'b', source: 'fixture:b', value: false });
  const call = { name: 'lalo_reading', arguments: { subject: base.subject, predicate: 'open',
    rule: 'unanimous-boolean/v1', knownAt: base.recordedAt, validAt: base.validFrom, limit: 1 } };
  const action = { format: 'lalo/action', version: 1, status: 'executed', call,
    result: createToolHost(world).call(call.name, call.arguments) };
  return { world, action };
}

test('replay holds its original world, tool, both clocks and complete inference through paging', () => {
  const { world, action } = fixture(), original = structuredClone(action), replay = createActionReplay(world, action);
  world.add({ ...world.entries()[0], id: 'a2', recordedAt: 1792268765999, supersedes: 'a', value: false });
  action.call.name = 'lalo_status'; action.call.arguments.knownAt = 0;
  const first = replay.read();
  assert.equal(first.comparison, 'match'); assert.deepEqual(first.call, original.call); assert.deepEqual(first.result, original.result);
  const next = replay.read(first.result.data.nextOffset);
  assert.equal(next.comparison, 'page'); assert.equal(next.call.name, 'lalo_reading');
  assert.equal(next.call.arguments.knownAt, 1792268765123); assert.equal(next.call.arguments.validAt, 1792268765001);
  assert.equal(next.result.data.reading.state, 'contested'); assert.equal(next.result.data.reading.premiseCount, 2);
  assert.equal(next.result.data.items[0].fact.id, 'b'); assert.equal(next.result.data.nextOffset, null);
});

test('changed results are visible while the saved trace stays intact; object key order is immaterial', () => {
  const { world, action } = fixture();
  action.result = { data: action.result.data, ok: true };
  assert.equal(createActionReplay(world, action).read().comparison, 'match');
  action.result.data.reading.state = 'supported'; const original = JSON.stringify(action);
  const actual = createActionReplay(world, action).read();
  assert.equal(actual.comparison, 'changed'); assert.equal(actual.result.data.reading.state, 'contested');
  assert.equal(JSON.stringify(action), original);
});

test('abstention has no call to replay; host errors reproduce through the same tool contract', () => {
  const { world } = fixture();
  const action = { format: 'lalo/action', version: 1, call: null, result: null };
  const none = createActionReplay(world, action); assert.equal(none.canReplay, false);
  assert.throws(() => none.read(), /did not select/);
  action.call = { name: 'lalo_facts', arguments: {} };
  action.result = createToolHost(world).call(action.call.name, {});
  assert.equal(createActionReplay(world, action).read().comparison, 'match');
});

test('replay rejects unsupported traces and invalid page offsets', () => {
  const { world, action } = fixture();
  assert.throws(() => createActionReplay(world, { ...action, version: 2 }), /saved LALO action/);
  const replay = createActionReplay(world, action);
  for (const offset of [-1, 1.1, '1', Infinity, 1025]) assert.throws(() => replay.read(offset), /offset/);
});
