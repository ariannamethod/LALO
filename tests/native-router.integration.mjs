// Explicit native gate: node scripts/build-router.mjs && node --test tests/native-router.integration.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createNativeRouter } from '../scripts/native-router.mjs';
import { createRouteSession } from '../src/route.js';
import { createToolHost } from '../src/tools.js';
import { FactLedger } from '../src/ledger.js';
import { encodeJournal } from '../src/journal.js';
const fixture = () => {
  const world = new FactLedger();
  const base = { subject: 'переправа:север', predicate: 'open', source: 'fixture:a', validFrom: 10, validTo: 20 };
  world.add({ ...base, id: 'a1', value: true, recordedAt: 100 });
  world.add({ ...base, id: 'b1', value: false, source: 'fixture:b', recordedAt: 150 });
  world.add({ ...base, id: 'a2', value: false, recordedAt: 200, supersedes: 'a1' });
  return world;
};

test('real neural body selects all six tools and executes explicit UTF-8 scope with both clocks', async t => {
  const router = await createNativeRouter(); t.after(() => router.close());
  const host = createToolHost(fixture()), session = createRouteSession(host, router);
  // Held-out wording: these complete phrases do not occur in the shipped corpus.
  const cases = [
    ['please inspect the journal limits', 'lalo_status', {}],
    ['show the known subjects please', 'lalo_subjects', { knownAt: 150 }],
    ['get the active observations please', 'lalo_facts', { knownAt: 100, validAt: 10, subject: 'переправа:север' }],
    ['please inspect earlier observations', 'lalo_history', { knownAt: 150, subject: 'переправа:север' }],
    ['follow the correction chain please', 'lalo_lineage', { knownAt: 200, id: 'a2' }],
    ['please check the conflicting evidence', 'lalo_reading', { knownAt: 150, validAt: 10, subject: 'переправа:север',
      predicate: 'open', rule: 'unanimous-boolean/v1', limit: 1 }],
  ];
  for (const [text, name, args] of cases) {
    const trace = await session.call({ text, arguments: args });
    assert.equal(trace.status, 'executed', JSON.stringify(trace));
    assert.equal(trace.call.name, name); assert.deepEqual(trace.call.arguments, args);
    assert.deepEqual(trace.result, host.call(name, args));
  }
  const trace = await session.call({ text: 'read hypothesis', arguments: cases[5][2] });
  assert.equal(trace.result.data.reading.state, 'contested'); assert.equal(trace.result.data.reading.premiseCount, 2);
  assert.equal(trace.result.data.complete, false); assert.equal(trace.result.data.items[0].fact.source, 'fixture:a');
  const newer = await session.call({ text: 'read active facts', arguments: { knownAt: 200, validAt: 10 } });
  assert.deepEqual(newer.result.data.items.map(f => f.id), ['b1', 'a2']);
  const future = await session.call({ text: 'trace revision lineage', arguments: { knownAt: 100, id: 'a2' } });
  assert.equal(future.status, 'tool_error'); assert.equal(future.result.error.code, 'NOT_FOUND');
});

test('native abstention and ambiguity execute nothing; missing structured clocks fail at the host', async t => {
  const router = await createNativeRouter(); t.after(() => router.close());
  let calls = 0; const realHost = createToolHost(fixture());
  const session = createRouteSession({ call(...args) { calls++; return realHost.call(...args); } }, router);
  for (const text of ['hello', 'do not read active facts']) assert.equal((await session.call({ text, arguments: {} })).status, 'no_call');
  assert.equal((await session.call({ text: 'read journal status and list known subjects', arguments: {} })).status, 'ambiguous');
  assert.equal(calls, 0);
  // Full argument extraction previously confused these two numbers and dropped this colon-bearing subject.
  const missing = await session.call({ text: 'read active facts for crossing:north valid at 1000 known at 1300', arguments: {} });
  assert.equal(missing.status, 'tool_error'); assert.equal(missing.result.error.code, 'INVALID_ARGUMENTS');
  assert.equal(calls, 1); assert.deepEqual(missing.call.arguments, {});
  const first = await router.route('read journal status');
  await router.route('read receipt history');
  assert.deepEqual(await router.route('read journal status'), first); // no automatic feedback/training
  const overTokens = await session.call({ text: Array(100).fill('journal').join(' '), arguments: {} });
  assert.equal(overTokens.status, 'router_error'); assert.equal(calls, 1);
});

test('native worker bounds concurrency and closes without leaving a callable process', async () => {
  const router = await createNativeRouter();
  try {
    const first = router.route('read journal status');
    await assert.rejects(router.route('read active facts'), { code: 'ROUTER_BUSY' });
    assert.equal((await first).status, 'call');
  } finally { await router.close(); }
  await assert.rejects(router.route('read journal status'), { code: 'ROUTER_CLOSED' });
  await router.close();
});

test('native process failures, corrupt output and deadlines are bounded and observable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lalo-native-fault-'));
  try {
    const scenarios = [
      ['missing', null, 'ROUTER_START'],
      ['invalid', "process.stdin.once('data',()=>process.stdout.write('not json\\n'));", 'ROUTER_PROTOCOL'],
      ['oversize', "process.stdin.once('data',()=>process.stdout.write('x'.repeat(17000)+'\\n'));", 'ROUTER_PROTOCOL'],
      ['exit', "process.stdin.once('data',()=>process.exit(2));", 'ROUTER_EXIT'],
      ['hang', 'process.stdin.resume();', 'ROUTER_TIMEOUT'],
    ];
    for (const [name, code, expected] of scenarios) {
      const executable = join(directory, name);
      if (code) await writeFile(executable, `#!${process.execPath}\n${code}\n`, { mode: 0o700 });
      const router = await createNativeRouter({ executable, timeoutMs: name === 'hang' ? 150 : 2000 });
      try { await assert.rejects(router.route('read journal status'), { code: expected }); }
      finally { await router.close(); }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('JSONL route CLI recovers after bad frames, reads a fixed journal and shuts its worker on EOF', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lalo-route-cli-'));
  try {
    const file = join(directory, 'world.json'); await writeFile(file, encodeJournal(fixture()));
    const requests = [
      { text: 'read journal status', arguments: {} },
      { text: 'trace revision lineage', arguments: { id: 'a2', knownAt: 200 } },
    ].map(JSON.stringify).join('\n');
    const input = requests + '\n{broken}\n' + 'x'.repeat(33000) + '\n'
      + JSON.stringify({ text: 'read active facts', arguments: { validAt: 10, knownAt: 100, subject: 'переправа:север' } }) + '\n';
    const result = spawnSync(process.execPath, ['scripts/route.mjs', '--journal', file],
      { input, encoding: 'utf8', timeout: 10000, maxBuffer: 1_000_000 });
    assert.equal(result.status, 0, result.stderr); assert.match(result.stderr, /3 receipts, fixed snapshot/);
    const traces = result.stdout.trim().split('\n').map(JSON.parse);
    assert.equal(traces.length, 5); assert.equal(traces[0].status, 'executed');
    assert.deepEqual(traces[1].result.data.items.map(f => f.id), ['a1', 'a2']);
    assert.equal(traces[2].status, 'invalid_request'); assert.equal(traces[3].status, 'invalid_request');
    assert.deepEqual(traces[4].result.data.items.map(f => f.id), ['a1']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('real C action bridge reads a submitted world over HTTP and shuts down cleanly', async t => {
  const { serve } = await import('../scripts/serve.mjs');
  const server = await serve({ port: 0, router: true });
  t.after(async () => { await server.closeActions(); await new Promise(r => server.close(r)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${origin}/api/action`, { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({
      journal: JSON.parse(encodeJournal(fixture())), request: { text: 'please check the conflicting evidence',
        arguments: { knownAt: 150, validAt: 10, subject: 'переправа:север', predicate: 'open', rule: 'unanimous-boolean/v1' } },
    }) });
  assert.equal(response.status, 200);
  const trace = await response.json();
  assert.equal(trace.call.name, 'lalo_reading'); assert.equal(trace.status, 'executed');
  assert.equal(trace.result.data.reading.state, 'contested');
  assert.deepEqual(trace.result.data.items.map(row => row.fact.id), ['a1', 'b1']);
});
