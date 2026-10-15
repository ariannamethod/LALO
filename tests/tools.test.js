import test from 'node:test';
import assert from 'node:assert/strict';
import { FactLedger } from '../src/ledger.js';
import { createToolHost, listTools } from '../src/tools.js';
import { crossingDemo, START, SUBJECT, PREDICATE } from '../src/crossing-demo.js';
import { hypothesis, RULE } from '../src/hypothesis.js';
import { ingestUSGS } from '../src/sources/usgs.js';
import { quakeView, QUAKE_RULE } from '../src/quake-view.js';
import { quake, collection, QUAKETIME as T } from './fixtures/usgs.js';
const fact = (id, extra = {}) => ({ id, subject: 'thing:1', predicate: 'open', value: true,
  source: 'fixture:a', validFrom: 10, validTo: 20, recordedAt: 100, ...extra });

test('tool reads retain both clocks, sources and historical lineage without future IDs or subjects', () => {
  const world = new FactLedger(); world.add(fact('a1'));
  world.add(fact('a2', { value: false, recordedAt: 200, validFrom: 11, supersedes: 'a1' }));
  world.add(fact('future', { subject: 'thing:future', recordedAt: 300 }));
  const host = createToolHost(world);
  assert.deepEqual(host.call('lalo_facts', { validAt: 10, knownAt: 100 }).data.items.map(f => f.id), ['a1']);
  assert.deepEqual(host.call('lalo_facts', { validAt: 10, knownAt: 200 }).data.items, []);
  assert.deepEqual(host.call('lalo_facts', { validAt: 11, knownAt: 200, source: 'fixture:a' }).data.items.map(f => f.id), ['a2']);
  assert.deepEqual(host.call('lalo_history', { knownAt: 200 }).data.items.map(f => f.id), ['a1', 'a2']);
  assert.deepEqual(host.call('lalo_subjects', { knownAt: 200 }).data.items.map(f => f.subject), ['thing:1']);
  assert.deepEqual(host.call('lalo_lineage', { id: 'a2', knownAt: 200 }).data.items.map(f => f.id), ['a1', 'a2']);
  assert.deepEqual(host.call('lalo_lineage', { id: 'future', knownAt: 200 }), host.call('lalo_lineage', { id: 'absent', knownAt: 200 }));
  assert.equal(host.call('lalo_status').data.latestReceipt, 300);
});

test('fixed snapshots and detached results keep pagination stable as the caller changes its world', () => {
  const world = new FactLedger(); for (let i = 0; i < 80; i++) world.add(fact(`a${i}`));
  const host = createToolHost(world);
  world.add(fact('later', { recordedAt: 200 }));
  const first = host.call('lalo_facts', { validAt: 10, knownAt: 300, limit: 64 });
  assert.equal(first.data.total, 80); assert.equal(first.data.complete, false); assert.equal(first.data.nextOffset, 64);
  first.data.items[0].value = false;
  assert.equal(host.call('lalo_facts', { validAt: 10, knownAt: 300 }).data.items[0].value, true);
  const rest = host.call('lalo_facts', { validAt: 10, knownAt: 300, offset: 64 });
  assert.equal(rest.data.items.length, 16); assert.equal(rest.data.complete, true); assert.equal(rest.data.nextOffset, null);
  assert.equal(host.call('lalo_facts', { validAt: 10, knownAt: 300, offset: 81 }).error.code, 'INVALID_ARGUMENTS');
  const tools = host.list(); tools[0].name = 'mutated'; assert.equal(host.list()[0].name, 'lalo_status');
});

test('byte-limited pages preserve whole UTF-8 facts and eventually return every row', () => {
  const world = new FactLedger(); for (let i = 0; i < 8; i++) world.add(fact(`a${i}`, { value: 'земля'.repeat(200) }));
  const host = createToolHost(world, { maxResultBytes: 5000 });
  const ids = []; let offset = 0;
  do {
    const result = host.call('lalo_history', { knownAt: 100, offset, limit: 64 });
    assert.equal(result.ok, true); assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 5000);
    ids.push(...result.data.items.map(f => f.id)); offset = result.data.nextOffset;
  } while (offset !== null);
  assert.deepEqual(ids, world.entries().map(f => f.id));
  assert.equal(createToolHost(world, { maxResultBytes: 1024 }).call('lalo_history', { knownAt: 100 }).error.code, 'RESULT_BUDGET');
});

test('reading uses every premise even when only one fits on the requested page', () => {
  const world = new FactLedger();
  for (let i = 0; i < 80; i++) world.add(fact(`a${i}`, { value: i !== 79 }));
  const host = createToolHost(world), args = { subject: 'thing:1', predicate: 'open', rule: RULE, knownAt: 100, validAt: 10, limit: 1 };
  const result = host.call('lalo_reading', args);
  assert.equal(result.data.reading.state, 'contested'); assert.equal(result.data.reading.premiseCount, 80);
  assert.deepEqual(result.data.reading.counts, { supporting: 79, opposing: 1, unknown: 0 });
  assert.equal(result.data.items[0].role, 'supporting'); assert.equal(result.data.complete, false);
  const last = host.call('lalo_reading', { ...args, offset: 79 });
  assert.equal(last.data.items[0].fact.id, 'a79'); assert.equal(last.data.items[0].role, 'opposing');
  assert.equal(last.data.reading.validFrom, 10); assert.equal(last.data.reading.validTo, 20);
});

test('tool readings match both visual rules through revisions and unknown magnitude', () => {
  const demo = crossingDemo(); for (let i = 0; i < 5; i++) demo.receive();
  const query = { subject: SUBJECT, predicate: PREDICATE, validAt: START, knownAt: demo.latest };
  const host = createToolHost(demo.ledger);
  assert.equal(host.call('lalo_reading', { ...query, rule: RULE }).data.reading.state, hypothesis(demo.ledger, query).state);
  let world = ingestUSGS(new FactLedger(), collection(quake()), { receivedAt: T + 2000 }).ledger;
  world = ingestUSGS(world, collection(quake({ mag: null, updated: T + 3000 })), { receivedAt: T + 4000 }).ledger;
  const quakes = createToolHost(world);
  for (const knownAt of [T + 2000, T + 4000]) {
    const q = { subject: 'usgs:synthetic1', validAt: T, knownAt };
    const expected = quakeView(world, q).current;
    const got = quakes.call('lalo_reading', { ...q, predicate: 'magnitude', rule: QUAKE_RULE }).data;
    assert.equal(got.reading.state, expected.state);
    assert.deepEqual(got.items.map(r => r.fact.id), expected.premises);
  }
  assert.equal(quakes.call('lalo_reading', { subject: 'usgs:synthetic1', predicate: 'magnitude', rule: RULE, knownAt: T + 2000, validAt: T }).error.code, 'INVALID_PREMISES');
});

test('input validation rejects coercion, ignored parameters and unsupported tool names', () => {
  const host = createToolHost(new FactLedger());
  for (const args of [null, [], { knownAt: '100', validAt: 10 }, { knownAt: 100 },
    { knownAt: 100, validAt: 10, limit: 65 }, { knownAt: 100, validAt: 10, offset: -1 },
    { knownAt: Infinity, validAt: 10 }, { knownAt: 100, validAt: 10, surprise: true },
    { knownAt: 100, validAt: 10, subject: '' }, { knownAt: 100, validAt: 10, predicate: undefined },
    JSON.parse('{"knownAt":100,"validAt":10,"__proto__":{}}')]) {
    assert.equal(host.call('lalo_facts', args).error.code, 'INVALID_ARGUMENTS');
  }
  assert.equal(host.call('constructor').error.code, 'UNKNOWN_TOOL');
  assert.equal(host.call('lalo_reading', { subject: 'x', predicate: 'open', rule: RULE, knownAt: 100, validAt: 10, threshold: 3 }).error.code, 'INVALID_ARGUMENTS');
  assert.equal(listTools().length, 6);
  for (const t of listTools()) assert.ok(Object.values(t.parameters.properties).every(p => ['string', 'number', 'integer', 'boolean'].includes(p.type)));
});
