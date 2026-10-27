// Explicit native gate: build-router.mjs, build-aml.mjs, then this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, mkdir, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { actionMemory, AML_BINARY } from '../scripts/action-memory.mjs';
import { serve } from '../scripts/serve.mjs';
import { FactLedger } from '../src/ledger.js';
import { encodeJournal } from '../src/journal.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createBackground } from '../src/background.js';
import { collection, quake, QUAKETIME } from './fixtures/usgs.js';

const digest = text => createHash('sha256').update(text).digest('hex');
const bundle = (dir, sequence) => join(dir, `${String(sequence).padStart(6, '0')}.action`);
const receiptPath = (dir, sequence) => join(bundle(dir, sequence), 'receipt');
const world = new FactLedger();
world.add({ id: 'a1', subject: 'переправа:север', predicate: 'open', value: true,
  source: 'fixture:свидетель', validFrom: 1792268765001, validTo: null, recordedAt: 1792268765123 });
const journal = encodeJournal(world);
const action = { format: 'lalo/action', version: 1, status: 'executed',
  request: { text: 'read active facts', arguments: { validAt: 1792268765001, knownAt: 1792268765123 } },
  route: { activation: .9 }, call: { name: 'lalo_facts' }, result: { ok: true, data: { items: world.entries() } } };
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'lalo-memory-'));
  t.after(() => rm(path, { recursive: true, force: true })); return path;
}

test('background CLI saves through real AML and replays the selected original world after new arrivals', async t => {
  const dir = await directory(t), memoryDir = join(dir, 'memory'), journalFile = join(dir, 'world.json');
  const requestFile = join(dir, 'request.json'), background = await createBackground();
  await background.receive({ kind: 'usgs', feed: collection(quake()), receivedAt: QUAKETIME + 2000 });
  await background.receive({ kind: 'signal', fact: { id: 'don:attention:1', subject: 'agent:don-eduardo',
    predicate: 'attention_subject', value: 'usgs:synthetic1', source: 'fixture:explicit-action', validFrom: QUAKETIME,
    validTo: null, recordedAt: QUAKETIME + 2500 } });
  const original = background.journal();
  await writeFile(journalFile, original);
  const request = { agent: 'agent:don-eduardo', knownAt: QUAKETIME + 3000,
    stateAt: QUAKETIME + 3000, worldFrom: QUAKETIME, worldTo: QUAKETIME + 100 };
  await writeFile(requestFile, JSON.stringify(request));
  const cli = async (...args) => JSON.parse((await promisify(execFile)(process.execPath,
    [new URL('../scripts/background.mjs', import.meta.url).pathname, ...args])).stdout);
  const first = await cli('select', '--journal', journalFile, '--request', requestFile, '--memory', memoryDir);
  assert.equal(first.memory.state, 'saved');
  assert.equal(first.memory.snapshot.sha256, digest(original));
  await background.receive({ kind: 'usgs', feed: collection(quake({ mag: 3.4, updated: QUAKETIME + 4000 })), receivedAt: QUAKETIME + 5000 });
  await writeFile(journalFile, background.journal());
  await writeFile(requestFile, JSON.stringify({ ...request, knownAt: QUAKETIME + 6000 }));
  const second = await cli('select', '--journal', journalFile, '--request', requestFile, '--memory', memoryDir);
  assert.equal(second.context.items[0].facts[0].value, 3.4);
  const replay = await cli('replay', '--memory', memoryDir, '--sequence', '1', '--head', first.memory.head);
  assert.equal(replay.comparison, 'match');
  assert.deepEqual(replay.result, first.context);
  assert.equal(replay.result.items[0].facts[0].value, 2.9);
  assert.equal(replay.result.state[0].source, 'fixture:explicit-action');
  await writeFile(join(bundle(memoryDir, 1), 'world.json'), original.replace('2.9', '9.9'));
  await assert.rejects(cli('replay', '--memory', memoryDir, '--sequence', '1'), /world|World|snapshot/);
});

test('real AML persists exact UTF-8 and both integer clocks; a fresh host verifies all receipts', async t => {
  const dir = await directory(t), memory = await actionMemory(dir);
  const large = { ...action, result: { text: 'é😅|строка\n'.repeat(3000), items: world.entries() } };
  const first = await memory.append(large, journal), second = await memory.append(action, journal);
  assert.equal(first.state, 'saved'); assert.equal(second.sequence, 2);
  const restored = await (await actionMemory(dir)).read({ expectedHead: second.head });
  assert.deepEqual(restored.receipts.map(r => r.action), [large, action]);
  assert.equal(restored.receipts[0].snapshot.sha256, digest(journal));
  assert.equal(restored.receipts[0].snapshot.records, 1);
  assert.ok(Number.isSafeInteger(restored.receipts[0].recordedAt));
  assert.equal(restored.head, second.head);
  const lines = await Promise.all([1, 2].map(n => readFile(receiptPath(dir, n), 'utf8')));
  assert.equal(lines[1].split('|')[1], digest(lines[0].slice(0, -1)));
  assert.deepEqual((await memory.recall({ sequence: 1, head: first.head, snapshot: true })).journal, JSON.parse(journal));
  const worlds = await Promise.all([1, 2].map(n => stat(join(bundle(dir, n), 'world.json'))));
  assert.equal(worlds[0].ino, worlds[1].ino); assert.equal(worlds[0].nlink, 2);
  assert.equal(restored.snapshotBytes, Buffer.byteLength(journal));
  assert.equal(restored.bytes, Buffer.byteLength(lines.join('')) + Buffer.byteLength(journal));
});

test('tampering, torn writes, invalid UTF-8 and missing sequence block read and append without repairing history', async t => {
  const dir = await directory(t), memory = await actionMemory(dir), file = receiptPath(dir, 1);
  await memory.append(action, journal); const original = await readFile(file);
  for (const damaged of [Buffer.from(original.toString().replace('read active facts', 'fake active facts')),
    original.subarray(0, -1), Buffer.concat([original.subarray(0, -2), Buffer.from([0xff, 0x0a])])]) {
    await writeFile(file, damaged);
    await assert.rejects(memory.read(), { code: 'MEMORY_AML' });
    await assert.rejects(memory.append(action, journal), { code: 'MEMORY_AML' });
    assert.deepEqual(await readFile(file), damaged);
  }
  await writeFile(file, original); await memory.append(action, journal); await rm(bundle(dir, 1), { recursive: true });
  await assert.rejects(memory.read(), { code: 'MEMORY_CHAIN' });
  assert.deepEqual(await readdir(dir), ['000002.action']);
});

test('an acknowledged head detects lost tail; uncommitted staging never joins the chain', async t => {
  const dir = await directory(t), memory = await actionMemory(dir);
  const first = await memory.append(action, journal), second = await memory.append(action, journal);
  await mkdir(join(dir, '.pending-crashed')); await writeFile(join(dir, '.pending-crashed', 'receipt'), 'torn');
  assert.equal((await memory.read()).receipts.length, 2);
  await rm(bundle(dir, 2), { recursive: true });
  await assert.rejects(memory.read({ expectedHead: second.head }), { code: 'MEMORY_HEAD' });
  assert.equal((await memory.read({ expectedHead: first.head })).receipts.length, 1);
});

test('count and byte exhaustion keep earlier receipts; unsupported or oversized payloads leave no files', async t => {
  const dir = await directory(t), memory = await actionMemory(dir, { capacity: 1 });
  await memory.append(action, journal); const before = await readFile(receiptPath(dir, 1));
  await assert.rejects(memory.append(action, journal), { code: 'MEMORY_FULL' });
  const byteLimited = await actionMemory(dir, { maxBytes: (await memory.read()).bytes });
  await assert.rejects(byteLimited.append(action, journal), { code: 'MEMORY_FULL' });
  assert.deepEqual(await readFile(receiptPath(dir, 1)), before);
  const empty = await directory(t), fresh = await actionMemory(empty);
  await assert.rejects(fresh.append({ ...action, version: 2 }, journal), { code: 'MEMORY_FORMAT' });
  await assert.rejects(fresh.append({ ...action, result: 'x'.repeat(200000) }, journal), { code: 'MEMORY_FORMAT' });
  assert.deepEqual(await readdir(empty), []);
});

test('two writers publish distinct immutable slots and reread one valid chain', async t => {
  const dir = await directory(t), a = await actionMemory(dir), b = await actionMemory(dir);
  const other = { ...action, status: 'no_call', result: null };
  const saved = await Promise.all([a.append(action, journal), b.append(other, journal)]);
  assert.deepEqual(saved.map(r => r.sequence).sort(), [1, 2]);
  const readback = await a.read(); assert.equal(readback.receipts.length, 2);
  assert.deepEqual(readback.receipts.map(r => r.action.status).sort(), ['executed', 'no_call']);
  assert.deepEqual(await readdir(dir), ['000001.action', '000002.action']);
  const worlds = await Promise.all([1, 2].map(n => stat(join(bundle(dir, n), 'world.json'))));
  assert.equal(worlds[0].ino, worlds[1].ino, 'the losing writer reuses the winning snapshot on retry');
});

test('a completed AML write without confirmed sync is reported once and can be read back', async t => {
  const dir = await directory(t), executable = join(dir, 'aml-unsynced');
  await writeFile(executable, `#!${process.execPath}\nconst {spawnSync}=require('node:child_process');
const fs=require('node:fs');const r=spawnSync(${JSON.stringify(AML_BINARY)},process.argv.slice(2),{input:fs.readFileSync(0),encoding:'utf8'});
process.stdout.write(process.argv[2].endsWith('action-write.aml')?r.stdout.replace(/^1\\|/,'2|'):r.stdout);
process.stderr.write(r.stderr);process.exit(r.status ?? 1);\n`, { mode: 0o700 });
  const memory = await actionMemory(dir, { executable }), receipt = await memory.append(action, journal);
  assert.equal(receipt.state, 'durability_unconfirmed'); assert.equal(receipt.sequence, 1);
  assert.equal((await (await actionMemory(dir)).read()).receipts.length, 1);
});

test('missing and stalled AML fail explicitly and never publish a receipt', async t => {
  const dir = await directory(t);
  await assert.rejects((await actionMemory(dir, { executable: join(dir, 'missing') })).append(action, journal), { code: 'MEMORY_AML' });
  const executable = join(dir, 'stalled');
  await writeFile(executable, `#!${process.execPath}\nprocess.stdin.resume();setInterval(()=>{},1000);\n`, { mode: 0o700 });
  await assert.rejects((await actionMemory(dir, { executable })).append(action, journal), { code: 'MEMORY_AML' });
  assert.deepEqual((await readdir(dir)).filter(name => /\.(receipt|action)$/.test(name) || name.startsWith('.pending-')), []);
});

test('actual C → HTTP → AML survives host restart; recall executes nothing and failed saves preserve the action result', async t => {
  const dir = await directory(t); let server;
  async function stop() { if (server) { await server.closeActions(); await new Promise(r => server.close(r)); server = undefined; } }
  t.after(stop);
  server = await serve({ port: 0, router: true, memoryDirectory: dir });
  const post = async (path, input) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    return fetch(origin + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  };
  assert.equal((await (await post('/api/memory', {})).json()).receipt, null);
  const payload = { journal: JSON.parse(journal), request: { text: 'get the active observations please', arguments: action.request.arguments } };
  const saved = await (await post('/api/action', payload)).json();
  assert.equal(saved.status, 'executed'); assert.equal(saved.memory.state, 'saved');
  assert.deepEqual(saved.result.data.items.map(f => f.id), ['a1']);
  await stop(); let starts = 0;
  server = await serve({ port: 0, router: true, memoryDirectory: dir, routerFactory: () => { starts++; throw new Error('Recall must not route'); } });
  const recalled = await (await post('/api/memory', {})).json();
  const { memory, ...trace } = saved;
  assert.deepEqual(recalled.receipt.action, trace); assert.equal(recalled.receipt.head, memory.head); assert.equal(starts, 0);
  const original = await (await post('/api/memory', { sequence: 1, head: memory.head, snapshot: true })).json();
  assert.deepEqual(original.journal, payload.journal); assert.equal(starts, 0);
  assert.equal((await post('/api/memory', { sequence: 1, head: '0'.repeat(64), snapshot: true })).status, 400);
  assert.equal((await post('/api/memory', { path: '/etc/passwd' })).status, 400);
  await stop(); server = await serve({ port: 0, router: true, memoryDirectory: dir });
  await writeFile(join(dir, '000003.receipt'), 'not a receipt');
  const failedSave = await (await post('/api/action', payload)).json();
  assert.equal(failedSave.status, 'executed'); assert.deepEqual(failedSave.result, trace.result);
  assert.equal(failedSave.memory.state, 'failed'); assert.equal(failedSave.memory.code, 'MEMORY_CHAIN');
  await stop(); await assert.rejects(serve({ port: 0, router: true, memoryDirectory: dir }), { code: 'MEMORY_CHAIN' });
});

test('legacy receipts stay byte-for-byte intact and new worlds extend the same chain', async t => {
  const dir = await directory(t), legacy = join(dir, '000001.receipt');
  const payload = JSON.stringify({ format: 'lalo/action-memory', version: 1, recordedAt: 1792268765123,
    snapshot: { sha256: digest(journal), records: 1 }, action });
  const line = `1|${digest('')}|${digest(payload)}|${payload}`;
  await writeFile(legacy, line + '\n');
  const memory = await actionMemory(dir);
  assert.equal((await memory.recall()).receipt.version, 1);
  await assert.rejects(memory.recall({ snapshot: true }), { code: 'MEMORY_SNAPSHOT' });
  const saved = await memory.append(action, journal); assert.equal(saved.sequence, 2);
  const restored = await memory.read({ expectedHead: saved.head });
  assert.deepEqual(restored.receipts.map(r => r.version), [1, 2]);
  assert.equal(await readFile(legacy, 'utf8'), line + '\n');
  assert.equal((await readFile(receiptPath(dir, 2), 'utf8')).split('|')[1], digest(line));
  assert.deepEqual((await memory.recall({ sequence: 2, snapshot: true })).journal, JSON.parse(journal));
});

test('damaged or missing worlds fail before returning a trace; snapshot bytes consume the shared budget', async t => {
  const dir = await directory(t), memory = await actionMemory(dir);
  await memory.append(action, journal);
  const file = join(bundle(dir, 1), 'world.json'), original = await readFile(file);
  await writeFile(file, original.toString().replace('open', 'shut'));
  await assert.rejects(memory.recall({ snapshot: true }), { code: 'MEMORY_AML' });
  await assert.rejects(memory.append(action, journal), { code: 'MEMORY_AML' });
  await writeFile(file, original); await rm(file);
  await assert.rejects(memory.recall({ snapshot: true }), { code: 'ENOENT' });
  const fresh = await directory(t), limited = await actionMemory(fresh, { maxBytes: Buffer.byteLength(journal) });
  await assert.rejects(limited.append(action, journal), { code: 'MEMORY_FULL' });
  assert.deepEqual(await readdir(fresh), []);
});

test('different source worlds remain selectable by sequence after later actions and a restart', async t => {
  const dir = await directory(t), memory = await actionMemory(dir);
  const first = await memory.append(action, journal), later = new FactLedger();
  for (const fact of world.entries()) later.add(fact);
  later.add({ ...world.entries()[0], id: 'a2', value: false, recordedAt: 1792268765999, supersedes: 'a1' });
  await memory.append(action, encodeJournal(later));
  const restarted = await actionMemory(dir), past = await restarted.recall({ sequence: 1, head: first.head, snapshot: true });
  assert.deepEqual(past.journal, JSON.parse(journal));
  assert.deepEqual((await restarted.recall({ snapshot: true })).journal, JSON.parse(encodeJournal(later)));
  assert.equal((await restarted.read()).snapshotBytes, Buffer.byteLength(journal) + Buffer.byteLength(encodeJournal(later)));
  for (const query of [{ sequence: 0 }, { sequence: 65 }, { sequence: '1' }, { head: '../world' }, { snapshot: 1 }, { path: '/tmp' }])
    await assert.rejects(restarted.recall(query), { code: 'MEMORY_QUERY' });
  await assert.rejects(restarted.recall({ sequence: 3 }), { code: 'MEMORY_NOT_FOUND' });
});

test('streamed AML verification and bounded readback preserve a world larger than one MiB', async t => {
  const dir = await directory(t), memory = await actionMemory(dir), large = new FactLedger();
  for (let i = 0; i < 512; i++) large.add({ ...world.entries()[0], id: `large:${i}`,
    source: 'fixture:' + 'é'.repeat(1020), recordedAt: 1792268765123 + i });
  const text = encodeJournal(large); assert.ok(Buffer.byteLength(text) > 1_048_576);
  const saved = await memory.append(action, text);
  assert.equal(saved.snapshot.bytes, Buffer.byteLength(text));
  assert.deepEqual((await memory.recall({ snapshot: true })).journal, JSON.parse(text));
});

test('competing different worlds cannot exceed the shared byte budget or leave half-published actions', async t => {
  const probeDir = await directory(t), probe = await actionMemory(probeDir);
  const otherWorld = new FactLedger(); otherWorld.add({ ...world.entries()[0], value: false });
  const otherJournal = encodeJournal(otherWorld);
  await probe.append(action, journal); await probe.append(action, otherJournal);
  const maxBytes = (await probe.read()).bytes - 1;
  const dir = await directory(t), a = await actionMemory(dir, { maxBytes }), b = await actionMemory(dir, { maxBytes });
  const results = await Promise.allSettled([a.append(action, journal), b.append(action, otherJournal)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'MEMORY_FULL');
  assert.deepEqual(await readdir(dir), ['000001.action']);
  assert.deepEqual((await a.recall({ snapshot: true })).journal,
    JSON.parse(results[0].status === 'fulfilled' ? journal : otherJournal));
  assert.ok((await a.read()).bytes <= maxBytes);
});
