import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { serve } from '../scripts/serve.mjs';
import { crossingDemo, START } from '../src/crossing-demo.js';
import { encodeJournal } from '../src/journal.js';

const decision = name => ({ status: 'call', calls: [{ name, arguments: {} }], confidence: .5,
  reasoning: { mode: 'neural', winner: name, arguments: [] } });
async function fixture(t, options = {}) {
  const server = await serve({ port: 0, ...options });
  t.after(async () => { await server.closeActions(); await new Promise(r => server.close(r)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const model = crossingDemo(); model.receive(); model.receive(); model.receive();
  const journal = JSON.parse(encodeJournal(model.ledger));
  const args = { subject: 'crossing:north', predicate: 'open', rule: 'unanimous-boolean/v1',
    knownAt: model.latest, validAt: START, limit: 1 };
  const payload = { journal, request: { text: 'please check the conflicting evidence', arguments: args } };
  const post = (input = payload, headers = {}) => fetch(`${url}/api/action`, { method: 'POST',
    headers: { Origin: url, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input) });
  return { server, url, model, payload, post };
}

test('action endpoint is opt-in and does not start the native body on page load or invalid input', async t => {
  let starts = 0;
  const routerFactory = async () => { starts++; return { route: async () => decision('lalo_reading'), close: async () => {} }; };
  const disabled = await fixture(t, { routerFactory });
  assert.equal((await disabled.post()).status, 503);
  const { url, post, payload } = await fixture(t, { router: true, routerFactory });
  assert.equal((await fetch(url)).status, 200); assert.equal(starts, 0);
  for (const [input, headers, status] of [
    [payload, { Origin: 'https://elsewhere.invalid' }, 403],
    [payload, { 'Content-Type': 'text/plain' }, 415],
    [{ ...payload, path: '/tmp/journal' }, {}, 400],
    [{ ...payload, request: { text: 'read journal status' } }, {}, 400],
    [{ ...payload, journal: { format: 'lalo/journal', version: 1, records: [{}] } }, {}, 400],
    [{ ...payload, extra: 'x'.repeat(2_100_001) }, {}, 413],
  ]) assert.equal((await post(input, headers)).status, status);
  assert.equal((await fetch(`${url}/api/action`)).status, 405);
  const wrongHost = await new Promise((resolve, reject) => {
    const req = httpRequest(url + '/api/action', { method: 'POST', headers: {
      Host: 'elsewhere.invalid', Origin: url, 'Content-Type': 'application/json' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    }); req.on('error', reject); req.end(JSON.stringify(payload));
  });
  assert.equal(wrongHost, 403); assert.equal(starts, 0);
  await assert.rejects(serve({ port: 0, host: '0.0.0.0', router: true }), /127.0.0.1/);
});

test('HTTP actions preserve the submitted snapshot, explicit clocks, pagination and tool failures', async t => {
  let starts = 0;
  const { model, payload, post } = await fixture(t, { router: true, routerFactory: async () => {
    starts++; return { route: async () => decision('lalo_reading'), close: async () => {} };
  } });
  model.receive(); model.receive();
  const original = JSON.stringify(payload);
  for (const offset of [0, 1, 2]) {
    const response = await post({ ...payload, request: { ...payload.request, arguments: { ...payload.request.arguments, offset } } });
    assert.equal(response.status, 200);
    const trace = await response.json();
    assert.equal(trace.status, 'executed');
    assert.equal(trace.result.data.reading.state, 'contested');
    assert.equal(trace.result.data.reading.premiseCount, 3);
    assert.equal(trace.result.data.items.length, 1);
    assert.equal(trace.result.data.nextOffset, offset === 2 ? null : offset + 1);
  }
  assert.equal(starts, 1); assert.equal(JSON.stringify(payload), original);
  const bad = await (await post({ ...payload, request: { ...payload.request, arguments: {} } })).json();
  assert.equal(bad.status, 'tool_error'); assert.equal(bad.result.error.code, 'INVALID_ARGUMENTS');
  assert.equal(model.ledger.size, 5);
});

test('one HTTP action in flight; a concurrent caller cannot release the first slot', async t => {
  let release, entered;
  const ready = new Promise(r => { entered = r; });
  const { post } = await fixture(t, { router: true, routerFactory: async () => ({
    route: () => { entered(); return new Promise(r => { release = () => r(decision('lalo_reading')); }); }, close: async () => {},
  }) });
  const first = post(); await ready;
  try {
    assert.equal((await post()).status, 429);
    assert.equal((await post()).status, 429);
  } finally { release(); }
  assert.equal((await first).status, 200);
});

test('malformed UTF-8, chunked overflow and interrupted uploads do not poison the endpoint', async t => {
  const { url, post } = await fixture(t, { router: true, routerFactory: async () => ({
    route: async () => decision('lalo_reading'), close: async () => {},
  }) });
  const raw = bytes => new Promise((resolve, reject) => {
    const req = httpRequest(`${url}/api/action`, { method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject); req.write(bytes); req.end();
  });
  assert.equal(await raw(Buffer.from([0xff, 0xfe])), 400);
  assert.equal(await raw('x'.repeat(2_100_001)), 413);
  await new Promise(resolve => {
    const req = httpRequest(`${url}/api/action`, { method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json' } });
    req.on('error', () => {}); req.on('close', resolve); req.write('{'); req.destroy();
  });
  assert.equal((await post()).status, 200);
});
