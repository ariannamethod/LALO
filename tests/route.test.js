import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteSession, ROUTE_BUDGET, selectorTools } from '../src/route.js';
import { createToolHost, listTools } from '../src/tools.js';
import { crossingDemo, START, SUBJECT, PREDICATE } from '../src/crossing-demo.js';

const decision = (name = 'lalo_reading', extra = {}) => ({ status: 'call', calls: [{ name, arguments: {} }],
  confidence: 0.99, reasoning: { mode: 'neural', winner: name, arguments: [] }, ...extra });
const setup = () => {
  const world = crossingDemo(); world.receive(); world.receive(); world.receive();
  return { host: createToolHost(world.ledger), request: { text: 'read hypothesis', arguments: {
    subject: SUBJECT, predicate: PREDICATE, rule: 'unanimous-boolean/v1', validAt: START, knownAt: world.latest, limit: 1,
  } } };
};

test('portable action trace preserves explicit clocks, complete inference and paged evidence', async () => {
  const { host, request } = setup();
  const session = createRouteSession(host, { route: async () => decision() });
  const trace = await session.call(request);
  assert.equal(trace.status, 'executed'); assert.equal(trace.format, 'lalo/action');
  assert.equal(trace.route.activation, 0.99); assert.match(trace.route.scoreKind, /not factual reliability/);
  assert.equal(trace.call.argumentSource, 'request.arguments');
  assert.deepEqual(trace.result, host.call('lalo_reading', request.arguments));
  assert.equal(trace.result.data.reading.state, 'contested');
  assert.equal(trace.result.data.reading.premiseCount, 3);
  assert.equal(trace.result.data.complete, false); assert.equal(trace.result.data.nextOffset, 1);
  assert.equal(trace.result.data.items[0].fact.source, 'fixture:station-a');
  assert.ok(Buffer.byteLength(JSON.stringify(trace)) <= ROUTE_BUDGET.maxTraceBytes);
  const before = await session.call({ ...request, arguments: { ...request.arguments, knownAt: START + 120_000 } });
  assert.equal(before.result.data.reading.state, 'supported');
  assert.deepEqual(selectorTools().map(t => t.name), listTools().map(t => t.name));
  assert.ok(selectorTools().every(t => Object.keys(t.parameters.properties).length === 0));
});

test('no-call, ambiguous, missing, invalid and invented router decisions never execute tools', async () => {
  let calls = 0;
  const host = { call() { calls++; throw new Error('must not execute'); } };
  for (const status of ['no_call', 'ambiguous', 'missing_arguments']) {
    const result = await createRouteSession(host, { route: async () => decision('lalo_status', { status, calls: [] }) })
      .call({ text: 'intent', arguments: {} });
    assert.equal(result.status, status); assert.equal(result.call, null); assert.equal(result.result, null);
  }
  const bad = [null, {}, decision('invented'), decision('lalo_status', { confidence: Infinity }),
    decision('lalo_status', { calls: [{ name: 'lalo_status', arguments: {} }, { name: 'lalo_status', arguments: {} }] }),
    decision('lalo_facts', { calls: [{ name: 'lalo_facts', arguments: { knownAt: 123, validAt: 456 } }] }),
    decision('lalo_status', { status: 'no_call' }), decision('lalo_status', { reasoning: { mode: 'keyword' } }),
    decision('lalo_status', { reasoning: { mode: 'neural', winner: 'lalo_facts', arguments: [] } }),
    decision('lalo_status', { padding: 'x'.repeat(ROUTE_BUDGET.maxDecisionBytes) }),
    { status: 'error', calls: [], error: 'input exceeds token budget' }];
  for (const output of bad) {
    const result = await createRouteSession(host, { route: async () => output }).call({ text: 'intent', arguments: {} });
    assert.equal(result.status, 'router_error'); assert.equal(result.result, null);
  }
  assert.equal(calls, 0);
});

test('request validation happens before routing, with no implicit clocks or discarded arguments', async () => {
  const { host } = setup(); let routes = 0;
  const session = createRouteSession(host, { route: async () => { routes++; return decision('lalo_facts'); } });
  for (const input of [null, [], { text: 'x' }, { text: 'x', arguments: {}, unknown: true },
    { text: 'x', arguments: null }, { text: 'x', arguments: { knownAt: NaN } },
    { text: 'x', arguments: { nested: {} } }, { text: '\uD800', arguments: {} },
    { text: 'nul\0byte', arguments: {} }, { text: 'я'.repeat(1024), arguments: {} },
    { text: 'x', arguments: { subject: 'x'.repeat(32768) } }]) {
    assert.equal((await session.call(input)).status, 'invalid_request');
  }
  assert.equal(routes, 0);
  for (const args of [{}, { knownAt: 100 }, { knownAt: '100', validAt: 10 }, { knownAt: 100, validAt: 10, surprise: 1 }]) {
    const trace = await session.call({ text: 'read active facts', arguments: args });
    assert.equal(trace.status, 'tool_error'); assert.equal(trace.result.error.code, 'INVALID_ARGUMENTS');
  }
});

test('caller mutation during asynchronous selection cannot change the executed arguments', async () => {
  const { host, request } = setup(); let release;
  const session = createRouteSession(host, { route: () => new Promise(resolve => { release = resolve; }) });
  const promise = session.call(request);
  const original = structuredClone(request);
  request.arguments.knownAt = 0; request.arguments.subject = 'other'; request.text = 'other';
  release(decision());
  const trace = await promise;
  assert.deepEqual(trace.request, original); assert.deepEqual(trace.call.arguments, original.arguments);
  assert.equal(trace.result.data.reading.state, 'contested');
});
